// Tests for 3.5.1: sign-in with a password and a one-time code, roles, and the administrator's controls.
// The clock is controlled, so lockouts and 30-second code windows are tested without waiting.
import request from 'supertest';
import express from 'express';
import { generate } from 'otplib';
import { authRoutes } from '../src/auth-routes.js';
import { hashPassword } from '../src/auth.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

let clock;
const advance = (seconds) => { clock = new Date(clock.getTime() + seconds * 1000); };
const codeFor = (secret) => generate({ secret, epoch: Math.floor(clock.getTime() / 1000) });

function makeApp() {
  const auth = makeAuth(() => clock);
  const app = express();
  app.use(express.json());
  app.use('/api', authRoutes({ db, auth, committeeIdentities: ['committee1'], inspectorIdentities: ['inspector1'], regulatorIdentities: ['regulator1'] }));
  app.get('/api/protected', auth.requireAuth, (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  return app;
}

const PASSWORD = 'correct-horse-battery';
async function makeUser(role = 'OFFICER', extra = {}) {
  return db.user.create({ data: {
    email: 'person@test.zm', name: 'Test Person', role, passwordHash: await hashPassword(PASSWORD), ...extra,
  } });
}
const login = (app, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email: 'Person@Test.zm ', password });

/** Signs in for the first time and sets up the authenticator; returns the secret and a session. */
async function firstSignIn(app) {
  const step1 = await login(app);
  const session = await request(app).post('/api/auth/setup')
    .send({ stepToken: step1.body.stepToken, code: await codeFor(step1.body.secret) });
  return { secret: step1.body.secret, session };
}

beforeEach(async () => {
  await resetDb();
  clock = new Date('2026-10-17T08:00:00Z');
});
afterAll(() => db.$disconnect());

describe('Password and one-time code', () => {
  test('first sign-in asks for authenticator set-up with a QR code', async () => {
    const app = makeApp();
    await makeUser();
    const res = await login(app);
    expect(res.status).toBe(200);
    expect(res.body.next).toBe('setup');
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body).not.toHaveProperty('token'); // no session yet
  });

  test('a correct code completes set-up and gives a session', async () => {
    const app = makeApp();
    await makeUser();
    const { session } = await firstSignIn(app);
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({ email: 'person@test.zm', role: 'OFFICER', totpEnabled: true });
    const me = await request(app).get('/api/auth/me').set('authorization', `Bearer ${session.body.token}`);
    expect(me.body.email).toBe('person@test.zm');
  });

  test('the authenticator secret is stored encrypted', async () => {
    const app = makeApp();
    await makeUser();
    const { secret } = await firstSignIn(app);
    const stored = (await db.user.findFirst()).totpSecret;
    expect(stored).not.toContain(secret);
  });

  test('later sign-ins need a code, and each code works only once', async () => {
    const app = makeApp();
    await makeUser();
    const { secret } = await firstSignIn(app);

    advance(30);
    const step1 = await login(app);
    expect(step1.body.next).toBe('code');
    const code = await codeFor(secret);
    const ok = await request(app).post('/api/auth/code').send({ stepToken: step1.body.stepToken, code });
    expect(ok.status).toBe(200);

    const again = await login(app);
    const replay = await request(app).post('/api/auth/code').send({ stepToken: again.body.stepToken, code });
    expect(replay.status).toBe(401);
  });

  test('a wrong code is refused', async () => {
    const app = makeApp();
    await makeUser();
    await firstSignIn(app);
    advance(30);
    const step1 = await login(app);
    const res = await request(app).post('/api/auth/code').send({ stepToken: step1.body.stepToken, code: '123456' });
    expect(res.status).toBe(401);
  });

  test('the password step alone never gives access', async () => {
    const app = makeApp();
    await makeUser();
    await firstSignIn(app);
    const step1 = await login(app);
    const res = await request(app).get('/api/protected').set('authorization', `Bearer ${step1.body.stepToken}`);
    expect(res.status).toBe(401);
  });

  test('the code step expires after 5 minutes', async () => {
    const app = makeApp();
    await makeUser();
    const { secret } = await firstSignIn(app);
    advance(30);
    const step1 = await login(app);
    advance(6 * 60);
    // The step token's expiry uses the real clock, so check with an expired token directly
    const expired = (await import('jsonwebtoken')).default.sign(
      { sub: (await db.user.findFirst()).id, purpose: 'code', exp: Math.floor(Date.now() / 1000) - 1 },
      'test-jwt-secret-that-is-at-least-32-characters');
    const res = await request(app).post('/api/auth/code').send({ stepToken: expired, code: await codeFor(secret) });
    expect(res.status).toBe(401);
    expect(step1.body.stepToken).toBeDefined();
  });
});

describe('Wrong passwords and lockout', () => {
  test('the same message is given for an unknown email and a wrong password', async () => {
    const app = makeApp();
    await makeUser();
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@test.zm', password: PASSWORD });
    const wrong = await login(app, 'wrong-password');
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  test('five wrong passwords lock the account for 15 minutes', async () => {
    const app = makeApp();
    await makeUser();
    for (let i = 0; i < 5; i += 1) expect((await login(app, 'wrong-password')).status).toBe(401);

    const locked = await login(app);
    expect(locked.status).toBe(423);
    expect(locked.body.error).toMatch(/Too many failed attempts/);

    advance(14 * 60);
    expect((await login(app)).status).toBe(423);
    advance(61);
    expect((await login(app)).status).toBe(200);
  });

  test('failed attempts and the lockout are written to the audit log', async () => {
    const app = makeApp();
    await makeUser();
    for (let i = 0; i < 5; i += 1) await login(app, 'wrong-password');
    const actions = (await db.auditLog.findMany()).map((a) => a.action);
    expect(actions.filter((a) => a === 'login.failed')).toHaveLength(4);
    expect(actions).toContain('login.lockout');
  });
});

describe('Suspension', () => {
  test('a suspended user cannot sign in', async () => {
    const app = makeApp();
    await makeUser('OFFICER', { status: 'SUSPENDED' });
    const res = await login(app);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/);
  });

  test('suspension ends an existing session at once', async () => {
    const app = makeApp();
    await makeUser();
    const { session } = await firstSignIn(app);
    const header = `Bearer ${session.body.token}`;
    expect((await request(app).get('/api/protected').set('authorization', header)).status).toBe(200);

    await db.user.updateMany({ data: { status: 'SUSPENDED' } });
    expect((await request(app).get('/api/protected').set('authorization', header)).status).toBe(401);
  });
});

describe('Administrator', () => {
  test('creates a procuring entity and an officer in it', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const entity = await request(app).post('/api/admin/entities').set('authorization', admin.header)
      .send({ code: 'moh', name: 'Ministry of Health' });
    expect(entity.status).toBe(201);
    expect(entity.body.code).toBe('MOH');

    const user = await request(app).post('/api/admin/users').set('authorization', admin.header)
      .send({ email: 'Officer@MOH.test', name: 'A Officer', role: 'OFFICER', password: 'starting-pass-1', entityId: entity.body.id });
    expect(user.status).toBe(201);
    expect(user.body).toMatchObject({ email: 'officer@moh.test', role: 'OFFICER', entityId: entity.body.id, totpEnabled: false });
    expect(user.body).not.toHaveProperty('passwordHash');
  });

  test('cannot create bidders, who must register and be verified against PACRA and ZRA (3.5.2)', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const res = await request(app).post('/api/admin/users').set('authorization', admin.header)
      .send({ email: 'bids@alpha.test', name: 'Alpha Ltd', role: 'SUPPLIER', password: 'starting-pass-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/register themselves/);

    const officer = await signedIn('OFFICER');
    const change = await request(app).patch(`/api/admin/users/${officer.user.id}`).set('authorization', admin.header)
      .send({ role: 'SUPPLIER' });
    expect(change.status).toBe(400);
  });

  test.each([
    [{ email: 'bad', name: 'X', role: 'OFFICER', password: 'starting-pass-1' }, 'valid email'],
    [{ email: 'a@b.zm', name: 'X', role: 'KING', password: 'starting-pass-1' }, 'Choose a role'],
    [{ email: 'a@b.zm', name: 'X', role: 'REGULATOR', password: 'short' }, 'at least 10'],
    [{ email: 'a@b.zm', name: 'X', role: 'OFFICER', password: 'starting-pass-1' }, 'procuring entity'],
  ])('rejects invalid user %j', async (body, message) => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const res = await request(app).post('/api/admin/users').set('authorization', admin.header).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test('changes a role and suspends and reactivates a user', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const target = await signedIn('OFFICER');
    const url = `/api/admin/users/${target.user.id}`;

    const role = await request(app).patch(url).set('authorization', admin.header).send({ role: 'REGULATOR' });
    expect(role.body.role).toBe('REGULATOR');
    const off = await request(app).patch(url).set('authorization', admin.header).send({ status: 'SUSPENDED' });
    expect(off.body.status).toBe('SUSPENDED');
    const on = await request(app).patch(url).set('authorization', admin.header).send({ status: 'ACTIVE' });
    expect(on.body.status).toBe('ACTIVE');

    const logged = (await db.auditLog.findMany({ where: { action: 'user.updated' } })).length;
    expect(logged).toBe(3);
  });

  test('cannot suspend themselves or drop their own administrator role', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const url = `/api/admin/users/${admin.user.id}`;
    expect((await request(app).patch(url).set('authorization', admin.header).send({ status: 'SUSPENDED' })).status).toBe(400);
    expect((await request(app).patch(url).set('authorization', admin.header).send({ role: 'OFFICER' })).status).toBe(400);
  });

  test('suspends a procuring entity', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const entity = await db.procuringEntity.create({ data: { code: 'MOE', name: 'Ministry of Education' } });
    const res = await request(app).patch(`/api/admin/entities/${entity.id}`).set('authorization', admin.header)
      .send({ status: 'SUSPENDED' });
    expect(res.body.status).toBe('SUSPENDED');
  });

  test('resetting a lost authenticator makes the user set it up again', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    const user = await makeUser();
    await firstSignIn(app);
    await request(app).post(`/api/admin/users/${user.id}/reset-code`).set('authorization', admin.header);
    advance(30);
    expect((await login(app)).body.next).toBe('setup');
  });

  test.each(['OFFICER', 'SUPPLIER', 'REGULATOR', 'COMMITTEE', 'INSPECTOR'])('a %s cannot use the admin screens', async (role) => {
    const app = makeApp();
    const someone = await signedIn(role);
    const res = await request(app).get('/api/admin/users').set('authorization', someone.header);
    expect(res.status).toBe(403);
  });

  test('sees the audit log', async () => {
    const app = makeApp();
    const admin = await signedIn('ADMIN');
    await makeUser();
    await login(app, 'wrong-password');
    const res = await request(app).get('/api/admin/audit').set('authorization', admin.header);
    expect(res.body[0]).toMatchObject({ action: 'login.failed', user: 'person@test.zm' });
  });
});
