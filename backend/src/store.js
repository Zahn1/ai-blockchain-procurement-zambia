// Off-chain records the UI needs (tender titles, file names, IPFS CIDs). A JSON file for today's prototype;
// Phase 3 moves this to PostgreSQL with Prisma.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const file = () => path.join(config.dataDir, 'records.json');

async function read() {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8'));
  } catch {
    return { tenders: [], bids: [] };
  }
}

async function write(data) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(file(), JSON.stringify(data, null, 2));
}

export const fileStore = {
  async addTender(t) { const d = await read(); d.tenders.unshift(t); await write(d); },
  async listTenders() { return (await read()).tenders; },
  async getTender(ref) { return (await read()).tenders.find((t) => t.reference === ref) ?? null; },
  async addBid(b) { const d = await read(); d.bids.unshift(b); await write(d); },
};
