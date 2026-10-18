// Chapter 3, 3.5.2: supplier self-registration, verified against PACRA and ZRA, keyed to the PACRA number.
import express from 'express';
import crypto from 'node:crypto';
import { hashPassword, MIN_PASSWORD, AuthError } from './auth.js';
import { verifySupplier, endOfDayInZambia, zambianDate } from './registries.js';

const PACRA = /^\d{12}$/;
const TPIN = /^\d{10}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

/** A random ledger code name for a supplier company, e.g. SUP-7K2Q9F. */
export function newSupplierRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so it reads clearly
  return `SUP-${[...crypto.randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

const supplierView = (s) => ({
  pacraNumber: s.pacraNumber, companyName: s.companyName, tpin: s.tpin, supplierRef: s.supplierRef,
  status: s.status, pacraStatus: s.pacraStatus, taxClearanceNumber: s.taxClearanceNumber,
  taxClearanceExpiry: s.taxClearanceExpiry, verifiedAt: s.verifiedAt,
  users: s.users?.map((u) => u.email),
});

export function supplierRoutes({ db, auth, registries, now = () => new Date() }) {
  const r = express.Router();

  // Public: a supplier registers. Nothing is created unless PACRA and ZRA both confirm the company.
  r.post('/register/supplier', wrap(async (req, res) => {
    const pacraNumber = String(req.body.pacraNumber ?? '').replace(/\s/g, '');
    const tpin = String(req.body.tpin ?? '').replace(/\s/g, '');
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const name = String(req.body.name ?? '').trim();
    const password = String(req.body.password ?? '');
    if (!PACRA.test(pacraNumber)) throw new AuthError(400, 'The PACRA registration number has 12 digits.');
    if (!TPIN.test(tpin)) throw new AuthError(400, 'The ZRA TPIN has 10 digits.');
    if (!name) throw new AuthError(400, 'Enter the name of the person registering.');
    if (!EMAIL.test(email)) throw new AuthError(400, 'Enter a valid email address.');
    if (password.length < MIN_PASSWORD) throw new AuthError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
    if (await db.user.findUnique({ where: { email } })) throw new AuthError(409, 'An account with that email already exists. Sign in instead.');

    const existing = await db.supplier.findUnique({ where: { pacraNumber } });
    if (existing) {
      throw new AuthError(409, `${existing.companyName} is already registered. Ask your company's existing user to contact the system administrator for another account.`);
    }

    const check = await verifySupplier(registries, pacraNumber, tpin, now());
    if (!check.ok) {
      await auth.audit(null, 'supplier.registration_refused', { pacraNumber, tpin, problems: check.problems }, req.ip);
      return res.status(check.unavailable ? 503 : 422).json({ error: 'Registration could not be verified.', problems: check.problems });
    }

    const supplier = await db.supplier.create({ data: {
      pacraNumber, tpin, companyName: check.company.name, supplierRef: newSupplierRef(),
      pacraStatus: check.company.status, taxClearanceNumber: check.clearance.number,
      taxClearanceExpiry: endOfDayInZambia(check.clearance.expiry), verifiedAt: now(),
      users: { create: { email, name, role: 'SUPPLIER', passwordHash: await hashPassword(password) } },
    }, include: { users: true } });
    await auth.audit(supplier.users[0].id, 'supplier.registered', { pacraNumber, tpin, supplierRef: supplier.supplierRef }, req.ip);
    res.status(201).json({ companyName: supplier.companyName, supplierRef: supplier.supplierRef, email });
  }));

  const admin = [auth.requireAuth, auth.requireRole('ADMIN')];

  r.get('/admin/suppliers', admin, wrap(async (_req, res) => {
    const suppliers = await db.supplier.findMany({ orderBy: { companyName: 'asc' }, include: { users: true } });
    res.json(suppliers.map(supplierView));
  }));

  // Ask PACRA and ZRA again, e.g. after a tax clearance is renewed. A company that fails is suspended.
  r.post('/admin/suppliers/:pacraNumber/reverify', admin, wrap(async (req, res) => {
    const supplier = await db.supplier.findUnique({ where: { pacraNumber: req.params.pacraNumber } });
    if (!supplier) throw new AuthError(404, 'Supplier not found.');
    const check = await verifySupplier(registries, supplier.pacraNumber, supplier.tpin, now());
    if (check.unavailable) return res.status(503).json({ error: check.problems[0] });
    const updated = await db.supplier.update({
      where: { pacraNumber: supplier.pacraNumber },
      data: {
        status: check.ok ? 'VERIFIED' : 'SUSPENDED',
        pacraStatus: check.company?.status ?? 'NOT FOUND',
        ...(check.clearance ? { taxClearanceNumber: check.clearance.number,
          taxClearanceExpiry: endOfDayInZambia(check.clearance.expiry) } : {}),
        verifiedAt: now(),
      },
      include: { users: true },
    });
    await auth.audit(req.user.id, 'supplier.reverified', { pacraNumber: supplier.pacraNumber, ok: check.ok, problems: check.problems }, req.ip);
    res.json({ ...supplierView(updated), problems: check.problems });
  }));

  return r;
}

/**
 * Before a bid: the bidder's company must still be verified and its tax clearance in date.
 * Returns a reason the bidder can act on, or null if they may bid.
 */
export function bidBlocker(supplier, now = new Date()) {
  if (!supplier) return 'Your account is not linked to a registered supplier. Contact the system administrator.';
  if (supplier.status !== 'VERIFIED') return `${supplier.companyName} is suspended from bidding. Contact the system administrator.`;
  if (supplier.taxClearanceExpiry < now) {
    return `Your tax clearance expired on ${zambianDate(supplier.taxClearanceExpiry)}. Renew it with ZRA, then ask the administrator to re-verify your company.`;
  }
  return null;
}
