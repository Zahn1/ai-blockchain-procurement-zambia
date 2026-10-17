// Before any test file runs: bring the separate test schema up to the latest migration.
import { execSync } from 'node:child_process';
import '../src/config.js';

export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL (see backend/.env.example)');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
