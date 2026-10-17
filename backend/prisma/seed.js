// Creates the first administrator and a demo procuring entity, so the system can be set up from the admin screen.
// Credentials come from backend/.env (SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD). Safe to run more than once.
import '../src/config.js';
import { PrismaClient } from '@prisma/client';
import { hashPassword, MIN_PASSWORD } from '../src/auth.js';

const db = new PrismaClient();
const email = (process.env.SEED_ADMIN_EMAIL ?? '').toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
if (!email || password.length < MIN_PASSWORD) {
  console.error(`Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least ${MIN_PASSWORD} characters) in backend/.env`);
  process.exit(1);
}

const entity = await db.procuringEntity.upsert({
  where: { code: 'MOH' }, update: {}, create: { code: 'MOH', name: 'Ministry of Health' },
});
const admin = await db.user.upsert({
  where: { email }, update: {},
  create: { email, name: 'System Administrator', role: 'ADMIN', passwordHash: await hashPassword(password) },
});
console.log(`Administrator: ${admin.email} (password in backend/.env). Procuring entity: ${entity.code}.`);
await db.$disconnect();
