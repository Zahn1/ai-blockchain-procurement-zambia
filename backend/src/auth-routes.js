// Routes for sign-in (3.5.1) and the administrator's user and procuring-entity management.
import express from 'express';
import { hashPassword, publicUser, MIN_PASSWORD, AuthError } from './auth.js';

// Chapter 3 roles: 3.5.1 (administrator, officer, bidder, regulator), 3.5.5 (committee), 3.5.6 (inspector).
// Bidders (SUPPLIER) are not created here: they register themselves and are verified against PACRA and ZRA (3.5.2).
const ROLES = ['ADMIN', 'OFFICER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR'];
const STATUSES = ['ACTIVE', 'SUSPENDED'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[A-Z0-9]{2,12}$/;

const bad = (message) => new AuthError(400, message);
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export function authRoutes({ db, auth }) {
  const r = express.Router();

  // Sign-in
  r.post('/auth/login', wrap(async (req, res) => {
    res.json(await auth.login(req.body.email, req.body.password, req.ip));
  }));
  r.post('/auth/setup', wrap(async (req, res) => {
    res.json(await auth.confirmSetup(req.body.stepToken, req.body.code, req.ip));
  }));
  r.post('/auth/code', wrap(async (req, res) => {
    res.json(await auth.verifyCode(req.body.stepToken, req.body.code, req.ip));
  }));
  r.get('/auth/me', auth.requireAuth, (req, res) => res.json(publicUser(req.user)));

  // Administrator only from here
  const admin = [auth.requireAuth, auth.requireRole('ADMIN')];

  r.get('/admin/users', admin, wrap(async (_req, res) => {
    const users = await db.user.findMany({ orderBy: { createdAt: 'desc' }, include: { entity: true, supplier: true } });
    res.json(users.map((u) => ({ ...publicUser(u), entity: u.entity?.code ?? null })));
  }));

  r.post('/admin/users', admin, wrap(async (req, res) => {
    const { email, name, role, password, entityId } = req.body;
    const clean = String(email ?? '').trim().toLowerCase();
    if (!EMAIL.test(clean)) throw bad('Enter a valid email address.');
    if (!String(name ?? '').trim()) throw bad('Enter the person\'s name.');
    if (role === 'SUPPLIER') throw bad('Bidders register themselves so PACRA and ZRA can verify their company.');
    if (!ROLES.includes(role)) throw bad('Choose a role.');
    if (String(password ?? '').length < MIN_PASSWORD) throw bad(`The starting password must be at least ${MIN_PASSWORD} characters.`);
    if (role === 'OFFICER' && !entityId) throw bad('A procurement officer must belong to a procuring entity.');
    if (entityId && !(await db.procuringEntity.findUnique({ where: { id: entityId } }))) throw bad('Unknown procuring entity.');
    if (await db.user.findUnique({ where: { email: clean } })) throw new AuthError(409, 'A user with that email already exists.');

    const user = await db.user.create({ data: {
      email: clean, name: String(name).trim(), role, passwordHash: await hashPassword(password),
      entityId: entityId || null,
    } });
    await auth.audit(req.user.id, 'user.created', { userId: user.id, email: clean, role }, req.ip);
    res.status(201).json(publicUser(user));
  }));

  // Change role, suspend or reactivate, or move to another procuring entity
  r.patch('/admin/users/:id', admin, wrap(async (req, res) => {
    const target = await db.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new AuthError(404, 'User not found.');
    const { role, status, entityId } = req.body;
    if (role !== undefined && (role === 'SUPPLIER') !== (target.role === 'SUPPLIER')) {
      throw bad('Bidder accounts belong to a registered supplier, so they cannot be changed to or from another role.');
    }
    if (role !== undefined && role !== 'SUPPLIER' && !ROLES.includes(role)) throw bad('Unknown role.');
    if (status !== undefined && !STATUSES.includes(status)) throw bad('Status must be ACTIVE or SUSPENDED.');
    if (target.id === req.user.id && (status === 'SUSPENDED' || (role && role !== 'ADMIN'))) {
      throw bad('You cannot suspend yourself or remove your own administrator role.');
    }
    const data = {};
    if (role !== undefined) data.role = role;
    if (status !== undefined) data.status = status;
    if (entityId !== undefined) data.entityId = entityId || null;
    const user = await db.user.update({ where: { id: target.id }, data, include: { supplier: true } });
    await auth.audit(req.user.id, 'user.updated', { userId: user.id, ...data }, req.ip);
    res.json(publicUser(user));
  }));

  // Lost phone: the user sets up the authenticator again at their next sign-in
  r.post('/admin/users/:id/reset-code', admin, wrap(async (req, res) => {
    const user = await db.user.update({ where: { id: req.params.id },
      data: { totpEnabled: false, totpSecret: null, totpLastStep: null } }).catch(() => null);
    if (!user) throw new AuthError(404, 'User not found.');
    await auth.audit(req.user.id, 'user.code_reset', { userId: user.id }, req.ip);
    res.json(publicUser(user));
  }));

  r.get('/admin/entities', admin, wrap(async (_req, res) => {
    res.json(await db.procuringEntity.findMany({ orderBy: { code: 'asc' } }));
  }));

  r.post('/admin/entities', admin, wrap(async (req, res) => {
    const code = String(req.body.code ?? '').trim().toUpperCase();
    const name = String(req.body.name ?? '').trim();
    if (!CODE.test(code)) throw bad('Code must be 2–12 letters or digits, e.g. MOH.');
    if (!name) throw bad('Enter the entity\'s name.');
    if (await db.procuringEntity.findUnique({ where: { code } })) throw new AuthError(409, 'That code is already used.');
    const entity = await db.procuringEntity.create({ data: { code, name } });
    await auth.audit(req.user.id, 'entity.created', { entityId: entity.id, code }, req.ip);
    res.status(201).json(entity);
  }));

  r.patch('/admin/entities/:id', admin, wrap(async (req, res) => {
    const { status, name } = req.body;
    if (status !== undefined && !STATUSES.includes(status)) throw bad('Status must be ACTIVE or SUSPENDED.');
    const entity = await db.procuringEntity.update({ where: { id: req.params.id },
      data: { ...(status ? { status } : {}), ...(name ? { name: String(name).trim() } : {}) } }).catch(() => null);
    if (!entity) throw new AuthError(404, 'Procuring entity not found.');
    await auth.audit(req.user.id, 'entity.updated', { entityId: entity.id, status, name }, req.ip);
    res.json(entity);
  }));

  r.get('/admin/audit', admin, wrap(async (_req, res) => {
    const rows = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { user: true } });
    res.json(rows.map((a) => ({ at: a.createdAt, action: a.action, user: a.user?.email ?? null, detail: a.detail, ip: a.ip })));
  }));

  return r;
}
