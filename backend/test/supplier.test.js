// Tests for Chapter 3, 3.5.2: supplier registration verified against PACRA and ZRA, keyed to the PACRA number.
// The PACRA and ZRA stand-ins run on a spare port and are called over HTTP, as the real services would be.
import express from 'express';
import request from 'supertest';
import { pacraStandIn, zraStandIn } from '../src/standins/services.js';
import { registryClients } from '../src/registries.js';
import { supplierRoutes, bidBlocker } from '../src/supplier-routes.js';
import { db, resetDb, makeAuth, signedIn, verifiedSupplier } from './helpers.js';

let standIns;
let registries;
const today = new Date('2026-10-18T09:00:00Z');

beforeAll(async () => {
  const s = express();
  s.use('/pacra', pacraStandIn());
  s.use('/zra', zraStandIn());
  standIns = s.listen(0);
  const base = `http://127.0.0.1:${standIns.address().port}`;
  registries = registryClients({ pacraUrl: `${base}/pacra`, zraUrl: `${base}/zra` });
});
afterAll(async () => { standIns.close(); await db.$disconnect(); });
beforeEach(resetDb);

function makeApp(regs = registries) {
  const app = express();
  app.use(express.json());
  app.use('/api', supplierRoutes({ db, auth: makeAuth(() => today), registries: regs, now: () => today }));
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  return app;
}

const form = (overrides = {}) => ({
  pacraNumber: '120260000101', tpin: '1000000101', name: 'Grace Mulenga',
  email: 'grace@alpha.test', password: 'alpha-bids-2026', ...overrides,
});
const register = (app, overrides) => request(app).post('/api/register/supplier').send(form(overrides));

describe('Registration with PACRA and ZRA checks', () => {
  test('a company that PACRA and ZRA both confirm is registered and can sign in as a bidder', async () => {
    const res = await register(makeApp(), { pacraNumber: '1202 6000 0101' });
    expect(res.status).toBe(201);
    expect(res.body.companyName).toBe('Alpha Computers Limited'); // from PACRA, not typed by the user
    expect(res.body.supplierRef).toMatch(/^SUP-[A-HJ-NP-Z2-9]{6}$/);

    const supplier = await db.supplier.findUnique({ where: { pacraNumber: '120260000101' }, include: { users: true } });
    expect(supplier).toMatchObject({ tpin: '1000000101', status: 'VERIFIED', pacraStatus: 'ACTIVE', taxClearanceNumber: 'TCC-2026-0101' });
    expect(supplier.users).toHaveLength(1);
    expect(supplier.users[0]).toMatchObject({ email: 'grace@alpha.test', role: 'SUPPLIER', totpEnabled: false });
  });

  test('the supplier record is keyed to its PACRA registration number', async () => {
    await register(makeApp());
    const byKey = await db.supplier.findUnique({ where: { pacraNumber: '120260000101' } });
    expect(byKey).not.toBeNull();
  });

  test.each([
    ['unknown company', { pacraNumber: '120260009999' }, 'PACRA has no company'],
    ['company deregistered at PACRA', { pacraNumber: '120260000104', tpin: '1000000104' }, 'deregistered'],
    ['tax clearance expired', { pacraNumber: '120260000105', tpin: '1000000105' }, 'tax clearance expired on 30 June 2026'],
    ['no tax clearance', { pacraNumber: '120260000106', tpin: '1000000106' }, 'no tax clearance'],
    ['unknown TPIN', { tpin: '1000009999' }, 'ZRA has no taxpayer'],
    ['TPIN of another company', { tpin: '1000000102' }, 'belongs to a different company'],
  ])('refused: %s, and nothing is created', async (_case, overrides, problem) => {
    const res = await register(makeApp(), overrides);
    expect(res.status).toBe(422);
    expect(res.body.problems.join(' ')).toContain(problem);
    expect(await db.supplier.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    const audit = await db.auditLog.findFirst();
    expect(audit.action).toBe('supplier.registration_refused');
  });

  test('a company can register only once', async () => {
    const app = makeApp();
    await register(app);
    const again = await register(app, { email: 'someone.else@alpha.test' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already registered/);
  });

  test.each([
    [{ pacraNumber: '1234' }, '12 digits'],
    [{ tpin: '12' }, '10 digits'],
    [{ email: 'not-an-email' }, 'valid email'],
    [{ password: 'short' }, 'at least 10'],
  ])('checks the form %j', async (overrides, message) => {
    const res = await register(makeApp(), overrides);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test('if PACRA or ZRA cannot be reached, nothing is created and the supplier is told to retry', async () => {
    const down = registryClients({ pacraUrl: 'http://127.0.0.1:9/pacra', zraUrl: 'http://127.0.0.1:9/zra' });
    const res = await register(makeApp(down));
    expect(res.status).toBe(503);
    expect(res.body.problems[0]).toMatch(/could not be reached/);
    expect(await db.supplier.count()).toBe(0);
  });
});

describe('Dates follow Zambian time', () => {
  test('a clearance valid until 30 June lasts until 23:59 that day in Lusaka', async () => {
    const { endOfDayInZambia, zambianDate } = await import('../src/registries.js');
    const end = endOfDayInZambia('2026-06-30');
    expect(end.toISOString()).toBe('2026-06-30T21:59:59.000Z');
    expect(zambianDate(end)).toBe('30 June 2026');
  });
});

describe('Staying verified', () => {
  test('a verified company with tax clearance in date may bid', () => {
    expect(bidBlocker({ status: 'VERIFIED', taxClearanceExpiry: new Date('2027-01-01'), companyName: 'X' }, today)).toBeNull();
  });

  test('a company whose tax clearance has since expired may not bid', () => {
    const reason = bidBlocker({ status: 'VERIFIED', taxClearanceExpiry: new Date('2026-09-30T23:59:59+02:00'), companyName: 'X' }, today);
    expect(reason).toMatch(/expired on 30 September 2026/);
  });

  test('a suspended company may not bid', () => {
    expect(bidBlocker({ status: 'SUSPENDED', companyName: 'Alpha' }, today)).toMatch(/Alpha is suspended/);
  });

  test('the administrator re-verifies a company and suspends it if ZRA no longer confirms it', async () => {
    const supplier = await verifiedSupplier({ pacraNumber: '120260000105', tpin: '1000000105' });
    const admin = await signedIn('ADMIN');
    const res = await request(makeApp()).post(`/api/admin/suppliers/${supplier.pacraNumber}/reverify`)
      .set('authorization', admin.header);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUSPENDED');
    expect(res.body.problems[0]).toMatch(/expired/);
  });

  test('re-verification restores a company once it checks out again', async () => {
    const supplier = await verifiedSupplier({ pacraNumber: '120260000102', tpin: '1000000102', status: 'SUSPENDED' });
    const admin = await signedIn('ADMIN');
    const res = await request(makeApp()).post(`/api/admin/suppliers/${supplier.pacraNumber}/reverify`)
      .set('authorization', admin.header);
    expect(res.body.status).toBe('VERIFIED');
  });

  test('only the administrator sees the supplier list', async () => {
    const officer = await signedIn('OFFICER');
    expect((await request(makeApp()).get('/api/admin/suppliers').set('authorization', officer.header)).status).toBe(403);
  });
});
