// Live test of Shamir key splitting (FR-BID-07) on the running network. The back end must be started with
// SHAMIR_OPENING=on. Writes docs/phase6/shamir-live.md. Run from backend/: node system-test/shamir-live.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from 'otplib';
import { config } from '../src/config.js';

const API = 'http://localhost:3000';
const live = new URL('../data/live/', import.meta.url);
const accounts = JSON.parse(fs.readFileSync(new URL('accounts.json', live)));
const secrets = JSON.parse(fs.readFileSync(new URL('secrets.json', live)));
const OUT = fileURLToPath(new URL('../../docs/phase6/shamir-live.md', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, token, body, form) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}
const upload = (path, token, fields, name, file, content) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set(name, new Blob([content]), file);
  return call('POST', path, token, null, form);
};
const lastStep = {};
async function signIn(email) {
  const step = Math.floor(Date.now() / 30000);
  if (lastStep[email] === step) await sleep((step + 1) * 30000 - Date.now() + 250);
  lastStep[email] = Math.floor(Date.now() / 30000);
  const l = await call('POST', '/api/auth/login', null, { email, password: accounts[email] });
  const s = await call('POST', '/api/auth/code', null, { stepToken: l.data.stepToken, code: await generate({ secret: secrets[email] }) });
  return s.data;
}
const bidKeysOnServer = () => {
  try { return JSON.parse(fs.readFileSync(`${config.dataDir}/bid-keys.json`, 'utf8')); } catch { return {}; }
};

const results = [];
const check = (step, ok, detail = '') => { results.push([step, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`); };

const run = Date.now().toString(36).toUpperCase();
const REF = `ZPPA/MOH/2026/SH-${run}`;
const u = {};
for (const [k, e] of Object.entries({ officer: 'officer@moh.test', m1: 'member1@moh.test', m2: 'member2@moh.test', alpha: 'grace@alpha.test', bravo: 'peter@bravo.test' })) u[k] = await signIn(e);
const t = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.token]));

const pub = await upload('/api/tenders', t.officer, { reference: REF, title: `Key splitting test ${run}: office printers`, estValueKwacha: '60000', closesInMinutes: '2' },
  'document', 'tender.txt', `Tender ${REF}: 12 office printers.\n`);
check('Officer publishes a tender', pub.status === 201, `block ${pub.data.block}`);
const closesAt = new Date(pub.data.closingTime);
const bids = {};
for (const [who, price] of [['alpha', '54,000'], ['bravo', '57,500']]) {
  const r = await upload('/api/bids', t[who], { tenderId: REF }, 'bid', `bid-${who}.txt`, `${who} bid for ${REF}: total K${price}.\n`);
  bids[who] = r.data.bidId;
  check(`${who} submits a sealed bid`, r.status === 201, r.data.bidId);
}
check('Before the split, the back end holds both bid keys', Object.keys(bidKeysOnServer()).filter((k) => Object.values(bids).includes(k)).length === 2);

const appointed = await call('POST', '/api/evaluation/committee', t.officer, { reference: REF, memberIds: [u.m1.user.id, u.m2.user.id] });
check('Appointing the committee splits the opening key', appointed.data.keySplit?.threshold === 2 && appointed.data.keySplit?.shares === 2, JSON.stringify(appointed.data.keySplit));
check('The back end no longer holds the bid keys', Object.keys(bidKeysOnServer()).every((k) => !Object.values(bids).includes(k)), 'removed from data/bid-keys.json');
check('The committee can no longer be changed', (await call('POST', '/api/evaluation/committee', t.officer, { reference: REF, memberIds: [u.m1.user.id, u.m2.user.id] })).status === 409);

const share1 = (await call('GET', `/api/evaluation/share?reference=${encodeURIComponent(REF)}`, t.m1)).data.share;
const share2 = (await call('GET', `/api/evaluation/share?reference=${encodeURIComponent(REF)}`, t.m2)).data.share;
check('Each member collects their share', /^ZPPA-SHARE:/.test(share1) && /^ZPPA-SHARE:/.test(share2), 'share 1 and share 2 of 2');
check('A share cannot be collected twice', (await call('GET', `/api/evaluation/share?reference=${encodeURIComponent(REF)}`, t.m1)).status === 409);

const wait = closesAt - Date.now() + 2000;
if (wait > 0) { console.log(`… waiting ${Math.round(wait / 1000)} s for closing`); await sleep(wait); }
for (const m of ['m1', 'm2']) check(`Committee member ${m.slice(1)} approves opening on the ledger`, (await call('POST', '/api/evaluation/approve', t[m], { reference: REF })).status === 200);

const noShares = await call('POST', '/api/evaluation/open', t.officer, { reference: REF });
check('With both ledger approvals but no shares, opening is refused', noShares.status === 409, noShares.data.error);
check('A member cannot hand in another member\'s share', (await call('POST', '/api/evaluation/share', t.m1, { reference: REF, share: share2 })).status === 400);
await call('POST', '/api/evaluation/share', t.m1, { reference: REF, share: share1 });
const oneShare = await call('POST', '/api/evaluation/open', t.officer, { reference: REF });
check('With one share of the two needed, opening is refused', oneShare.status === 409, oneShare.data.error);
await call('POST', '/api/evaluation/share', t.m2, { reference: REF, share: share2 });
const opened = await call('POST', '/api/evaluation/open', t.m1, { reference: REF });
check('With the quorum\'s shares, the bids open and match their ledger hashes', opened.status === 200 && opened.data.results.every((r) => r.integrity === 'MATCH'),
  opened.data.results?.map((r) => `${r.bidId} ${r.integrity}`).join(', '));
const file = await call('GET', `/api/evaluation/bid-file?bidId=${bids.alpha}`, t.m2);
check('The committee can read an opened bid', /total K54,000/.test(file.data), file.data.trim());

const passed = results.filter((r) => r[1]).length;
fs.writeFileSync(OUT, ['# Live test: Shamir key splitting (FR-BID-07)', '',
  `Run \`${run}\` on ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lusaka' })}, back end started with \`SHAMIR_OPENING=on\`, tender \`${REF}\`.`,
  'Script: `backend/system-test/shamir-live.mjs`.', '', `**Result: ${passed} of ${results.length} checks passed**`, '',
  '| # | Check | Result | Detail |', '|---|---|---|---|',
  ...results.map(([s, ok, d], i) => `| ${i + 1} | ${s} | ${ok ? 'PASS' : '**FAIL**'} | ${String(d).replace(/\|/g, '/')} |`), ''].join('\n'));
console.log(`\n${passed}/${results.length} passed. Written to docs/phase6/shamir-live.md`);
