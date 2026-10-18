// Shared test set-up: a Prisma client on the test schema, emptied before each test, and session tokens.
import jwt from 'jsonwebtoken';
import '../src/config.js';
import { PrismaClient } from '@prisma/client';
import { createAuth } from '../src/auth.js';

process.env.BCRYPT_ROUNDS = '4';

export const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters';
export const APP_KEY = 'ab'.repeat(32);

export const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

export async function resetDb() {
  await db.$executeRawUnsafe('TRUNCATE "AuditLog", "User", "Supplier", "ProcuringEntity" CASCADE');
}

export function makeAuth(now) {
  return createAuth({ db, jwtSecret: JWT_SECRET, appKey: APP_KEY, ...(now ? { now } : {}) });
}

let n = 0;
/** A verified supplier company (keyed to its PACRA number), as registration would create it. */
export async function verifiedSupplier(overrides = {}) {
  n += 1;
  const id = String(n).padStart(4, '0');
  return db.supplier.create({ data: {
    pacraNumber: `12026000${id}`, tpin: `100000${id}`, companyName: `Test Company ${n} Limited`,
    supplierRef: `SUP-TEST${id}`, pacraStatus: 'ACTIVE', taxClearanceNumber: `TCC-${id}`,
    taxClearanceExpiry: new Date(Date.now() + 365 * 86_400_000), verifiedAt: new Date(), ...overrides,
  } });
}

/** A user who has finished authenticator set-up, plus a session token for them. Bidders get a verified company. */
export async function signedIn(role, extra = {}) {
  const supplier = role === 'SUPPLIER' && !extra.supplierId ? await verifiedSupplier() : null;
  n += 1;
  const user = await db.user.create({ data: {
    email: `${role.toLowerCase()}${n}@test.zm`, name: `${role} ${n}`, role, passwordHash: 'unused',
    totpEnabled: true, supplierId: supplier?.pacraNumber ?? null, ...extra,
  } });
  const token = jwt.sign({ sub: user.id, purpose: 'session', role }, JWT_SECRET, { expiresIn: '1h' });
  return { user, supplier, token, header: `Bearer ${token}` };
}
