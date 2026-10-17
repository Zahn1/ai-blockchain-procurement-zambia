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
  await db.$executeRawUnsafe('TRUNCATE "AuditLog", "User", "ProcuringEntity" CASCADE');
}

export function makeAuth(now) {
  return createAuth({ db, jwtSecret: JWT_SECRET, appKey: APP_KEY, ...(now ? { now } : {}) });
}

let n = 0;
/** A user who has finished authenticator set-up, plus a session token for them. */
export async function signedIn(role, extra = {}) {
  n += 1;
  const user = await db.user.create({ data: {
    email: `${role.toLowerCase()}${n}@test.zm`, name: `${role} ${n}`, role, passwordHash: 'unused',
    totpEnabled: true, supplierRef: role === 'SUPPLIER' ? `SUP-TEST${n}` : null, ...extra,
  } });
  const token = jwt.sign({ sub: user.id, purpose: 'session', role }, JWT_SECRET, { expiresIn: '1h' });
  return { user, token, header: `Bearer ${token}` };
}
