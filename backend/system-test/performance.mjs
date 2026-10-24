// Phase 6 performance test: how long ledger reads and writes, the main API calls and the AI service take, and how
// many ledger transactions per second the two-organisation network commits. Writes docs/phase6/performance.md.
//
// Ledger writes go straight to the chaincode through the Fabric gateway (as officer1), so the test tenders exist only
// on the ledger and never appear in the portal, search or reports, which are built from the database.
// Needs the whole stack running. Run from backend/: node system-test/performance.mjs
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as ledger from '../src/fabric.js';
import { actors } from '../src/config.js';

const API = process.env.API_URL ?? 'http://localhost:3000';
const AI = process.env.AI_API_URL ?? 'http://127.0.0.1:8000';
const OUT = fileURLToPath(new URL('../../docs/phase6/performance.md', import.meta.url));
const token = fs.readFileSync(new URL('../data/live/reg.token', import.meta.url), 'utf8').trim(); // a regulator session
const run = Date.now().toString(36).toUpperCase();

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const r0 = (x) => Math.round(x);

/** Runs `task(i)` n times with `concurrency` in flight; returns per-call latencies (ms) and the wall time. */
async function load(n, concurrency, task) {
  const times = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < n) {
      const i = next++;
      const t = performance.now();
      await task(i);
      times.push(performance.now() - t);
    }
  }));
  return { times, wall: performance.now() - started };
}

const rows = [];
function record(name, n, concurrency, { times, wall }) {
  const row = { name, n, concurrency, p50: r0(pct(times, 50)), p95: r0(pct(times, 95)), max: r0(Math.max(...times)), tps: (n / (wall / 1000)).toFixed(1) };
  rows.push(row);
  console.log(`${name.padEnd(48)} n=${String(n).padEnd(4)} c=${String(concurrency).padEnd(3)} p50=${row.p50} ms  p95=${row.p95} ms  ${row.tps}/s`);
}

// A tender that exists on the ledger, to read
const [{ reference }] = await (await fetch(`${API}/api/tenders`)).json();

// ---- Ledger reads (query a peer; no ordering) -------------------------------------------------------------------
record('Ledger read: ReadTender', 200, 1, await load(200, 1, () => ledger.evaluate(actors.officer, 'TenderContract:ReadTender', reference)));
record('Ledger read: ReadTender', 500, 20, await load(500, 20, () => ledger.evaluate(actors.officer, 'TenderContract:ReadTender', reference)));
record('Ledger read: GetTenderHistory', 100, 10, await load(100, 10, () => ledger.evaluate(actors.officer, 'TenderContract:GetTenderHistory', reference)));

// ---- Ledger writes (endorsed by ZPPA and OAG, ordered, committed) -----------------------------------------------
const closing = new Date(Date.now() + 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const publish = (tag) => (i) => ledger.submit(actors.officer, 'TenderContract:PublishTender', `PERF/${run}/${tag}/${i}`,
  1_000_000, closing, JSON.stringify([crypto.randomBytes(32).toString('hex')]), 2);
record('Ledger write: PublishTender, one at a time', 10, 1, await load(10, 1, publish('seq')));
record('Ledger write: PublishTender, concurrent', 50, 10, await load(50, 10, publish('c10')));
record('Ledger write: PublishTender, concurrent', 100, 25, await load(100, 25, publish('c25')));

// ---- API (what the screens call) ----------------------------------------------------------------------------------
const api = (path, auth) => async () => {
  const res = await fetch(API + path, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  await res.arrayBuffer();
};
record('API: tender list (database)', 100, 10, await load(100, 10, api('/api/tenders')));
record('API: one tender with ledger history and bids', 100, 10, await load(100, 10, api(`/api/tender?id=${encodeURIComponent(reference)}`)));
record('API: public search', 100, 10, await load(100, 10, api('/api/public/search?q=supply')));
record('API: regulator alerts (ledger + database)', 100, 10, await load(100, 10, api('/api/oversight/alerts', true)));
record('API: procurement report (PDF)', 20, 2, await load(20, 2, api('/api/reports/procurement?format=pdf', true)));
record('API: OCDS download, all procurements', 20, 2, await load(20, 2, api('/api/public/ocds')));

// ---- AI risk service ----------------------------------------------------------------------------------------------
const features = { est_value: 150000, n_bidders: 1, period_days: 7, end_weekday: 5, award_value: 149000, buyer_n_awards: 30,
  supplier_wins: 6, buyer_supplier_share: 0.6, pair_awards_same_month: 3, method: 'open', category: 'goods' };
const ai = (path) => async () => {
  const res = await fetch(AI + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tender', features }) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  await res.json();
};
record('AI: /score', 200, 10, await load(200, 10, ai('/score')));
record('AI: /explain (with SHAP)', 100, 10, await load(100, 10, ai('/explain')));
ledger.close();

// ---- Report -------------------------------------------------------------------------------------------------------
const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
fs.writeFileSync(OUT, [
  '# Phase 6 performance test', '',
  `Run \`${run}\` on ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lusaka' })}. Script: \`backend/system-test/performance.mjs\`.`, '',
  `Everything runs on one laptop: ${cpu}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, macOS; Docker in Colima. The Fabric network has`,
  'one peer each for ZPPA and OAG and one Raft orderer; every write is endorsed by both organisations (majority policy).',
  'The orderer cuts a block every 2 seconds or every 10 transactions, whichever comes first (`BatchTimeout: 2s`, `MaxMessageCount: 10`).', '',
  '| Operation | Calls | In flight | p50 (ms) | p95 (ms) | Max (ms) | Throughput (per s) |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.n} | ${r.concurrency} | ${r.p50} | ${r.p95} | ${r.max} | ${r.tps} |`), '',
  'p50 and p95: half and 95% of calls finished within this time. "In flight": calls running at the same time.', '',
].join('\n'));
console.log('\nWritten to docs/phase6/performance.md');
