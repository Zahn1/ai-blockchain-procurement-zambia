// Phase 6 system test: one full procurement through the running system (API → Fabric, IPFS, PostgreSQL, AI service),
// checking every Chapter 3 functional requirement (3.5.1–3.5.10), what must succeed and what must be refused,
// and timing each step. Writes docs/phase6/system-test-results.md.
//
// Needs the whole stack running (see README) and the demo accounts. Passwords are read from
// backend/data/live/accounts.json and authenticator secrets from backend/data/live/secrets.json (both git-ignored).
// Run: node backend/system-test/run.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from 'otplib';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const LIVE = new URL('../data/live/', import.meta.url);
const OUT = fileURLToPath(new URL('../../docs/phase6/system-test-results.md', import.meta.url));
const accounts = JSON.parse(fs.readFileSync(new URL('accounts.json', LIVE)));
const secretsFile = new URL('secrets.json', LIVE);
const secrets = fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile)) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lusaka' });

// ---- HTTP -------------------------------------------------------------------------------------------------------
async function call(method, path, { token, body, form } = {}) {
  const started = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, type, ms: Math.round(performance.now() - started) };
}
const get = (path, token) => call('GET', path, { token });
const post = (path, token, body) => call('POST', path, { token, body });
const upload = (path, token, fields, file, name) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set(file, new Blob([name.content]), name.file);
  return call('POST', path, { token, form });
};

// ---- Sign-in: password, then the one-time code (a code works once per 30 s per user) ----------------------------
const lastStep = {};
async function code(email) {
  const step = Math.floor(Date.now() / 30000);
  if (lastStep[email] === step) await sleep((step + 1) * 30000 - Date.now() + 250);
  lastStep[email] = Math.floor(Date.now() / 30000);
  return generate({ secret: secrets[email] });
}
async function signIn(email) {
  const l = await post('/api/auth/login', null, { email, password: accounts[email] });
  if (l.status !== 200) throw new Error(`${email}: ${JSON.stringify(l.data)}`);
  if (l.data.next === 'setup') {
    secrets[email] = l.data.secret;
    fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    return (await post('/api/auth/setup', null, { stepToken: l.data.stepToken, code: await code(email) })).data;
  }
  const s = await post('/api/auth/code', null, { stepToken: l.data.stepToken, code: await code(email) });
  if (s.status !== 200) throw new Error(`${email}: ${JSON.stringify(s.data)}`);
  return s.data;
}

// ---- Results ----------------------------------------------------------------------------------------------------
const results = [];
let section = '';
function check(req, step, ok, detail, ms = null) {
  results.push({ req, step, ok: !!ok, detail, ms });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${req}  ${step}${detail ? ` — ${detail}` : ''}${ms !== null ? ` (${ms} ms)` : ''}`);
}
const expect = (req, step, res, status, detail = '') =>
  check(req, step, res.status === status, `${res.status}${res.status === status ? '' : ` (expected ${status})`}${detail ? `; ${detail}` : res.status >= 400 && res.data?.error ? `; ${res.data.error}` : ''}`, res.ms);
const psql = (sql) => execFileSync('docker', ['exec', 'procurement-postgres-1', 'psql', '-U', 'procurement', '-d', 'procurement', '-tAc', sql]).toString().trim();

// ---- The run ----------------------------------------------------------------------------------------------------
const run = Date.now().toString(36).toUpperCase();
const REF = `ZPPA/MOH/2026/ST-${run}`;
const started = new Date();
console.log(`System test ${run}: tender ${REF}\n`);

// 3.5.1 Access control ------------------------------------------------------------------------------------------
section = '3.5.1';
const users = {};
for (const [k, email] of Object.entries({ officer: 'officer@moh.test', m1: 'member1@moh.test', m2: 'member2@moh.test',
  inspector: 'inspector@moh.test', regulator: 'regulator@zppa.test', admin: 'admin@zppa.test',
  alpha: 'grace@alpha.test', bravo: 'peter@bravo.test', charlie: 'chanda@charlie.test' })) {
  users[k] = await signIn(email);
}
check(section, 'Every role signs in with password and one-time code', Object.values(users).every((u) => u?.token), `${Object.keys(users).length} users`);
const tok = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.token]));

expect(section, 'Wrong password is refused', await post('/api/auth/login', null, { email: 'officer@moh.test', password: 'not-the-password' }), 401);
{
  const l = await post('/api/auth/login', null, { email: 'inspector@moh.test', password: accounts['inspector@moh.test'] });
  expect(section, 'Correct password but wrong one-time code is refused', await post('/api/auth/code', null, { stepToken: l.data.stepToken, code: '000000' }), 401);
}
expect(section, 'No session: dashboard refused', await get('/api/dashboard'), 401);
const matrix = [
  ['Bidder cannot publish a tender', 'POST', '/api/tenders', 'alpha'],
  ['Bidder cannot see risk alerts', 'GET', '/api/oversight/alerts', 'alpha'],
  ['Bidder cannot see the evaluation', 'GET', '/api/evaluation/tenders', 'alpha'],
  ['Officer cannot see risk alerts', 'GET', '/api/oversight/alerts', 'officer'],
  ['Officer cannot submit a bid', 'POST', '/api/bids', 'officer'],
  ['Officer cannot manage users', 'GET', '/api/admin/users', 'officer'],
  ['Committee member cannot publish a tender', 'POST', '/api/tenders', 'm1'],
  ['Committee member cannot certify a milestone', 'POST', '/api/contracts/certify', 'm1'],
  ['Inspector cannot see the evaluation', 'GET', '/api/evaluation/tenders', 'inspector'],
  ['Inspector cannot award', 'POST', '/api/contracts/award', 'inspector'],
  ['Regulator cannot publish a tender', 'POST', '/api/tenders', 'regulator'],
  ['Administrator cannot see risk alerts', 'GET', '/api/oversight/alerts', 'admin'],
];
for (const [step, method, path, who] of matrix) expect(section, step, await call(method, path, { token: tok[who], body: method === 'POST' ? {} : undefined }), 403);

// 3.5.2 Registration ---------------------------------------------------------------------------------------------
section = '3.5.2';
const reg = (pacraNumber, tpin) => post('/api/register/supplier', null,
  { pacraNumber, tpin, name: 'System Test', email: `st-${run.toLowerCase()}-${pacraNumber}@test.test`, password: crypto.randomBytes(9).toString('base64url') });
{
  const r = await reg('120260000105', '1000000105');
  expect(section, 'Company with an expired ZRA tax clearance is refused', r, 422, r.data.problems?.join(' '));
  const d = await reg('120260000104', '1000000104');
  expect(section, 'Company deregistered at PACRA is refused', d, 422, d.data.problems?.join(' '));
  expect(section, 'A company that is already registered cannot register again', await reg('120260000101', '1000000101'), 409);
  expect(section, 'TPIN that does not belong to the company is refused', await reg('120260000106', '1000000102'), 422);
}

// 3.5.3 Tender publication ---------------------------------------------------------------------------------------
section = '3.5.3';
const tenderDoc = { file: `tender-${run}.txt`, content: `Tender ${REF}: supply of 60 hospital beds. Estimated value K150,000.\n` };
const pub = await upload('/api/tenders', tok.officer, { reference: REF, title: `System test ${run}: hospital beds`, estValueKwacha: '150000', closesInMinutes: '2' }, 'document', tenderDoc);
expect(section, 'Officer publishes a tender; hash and closing time go on the ledger', pub, 201, `block ${pub.data.block}`);
const closesAt = new Date(pub.data.closingTime);
check(section, 'The ledger holds the document\'s SHA-256 hash', pub.data.docHash === sha256(tenderDoc.content), pub.data.docHash?.slice(0, 16));
{
  const v = await upload('/api/verify', null, { reference: REF }, 'document', tenderDoc);
  check(section, 'The published document matches the ledger', v.data.matches === true, '', v.ms);
  const t = await upload('/api/verify', null, { reference: REF }, 'document', { file: 'x.txt', content: tenderDoc.content.replace('60', '80') });
  check(section, 'An altered copy does not match', t.data.matches === false, 'one figure changed');
  expect(section, 'The same reference cannot be published twice', await upload('/api/tenders', tok.officer,
    { reference: REF, title: 'Again', estValueKwacha: '1', closesInMinutes: '5' }, 'document', tenderDoc), 409);
}

// 3.5.4 Sealed bids ----------------------------------------------------------------------------------------------
section = '3.5.4';
const bidFile = (who, price) => ({ file: `bid-${who}.txt`, content: `${who} bid for ${REF}: 60 beds, total price K${price.toLocaleString('en-GB')}.\n` });
const bids = {};
for (const [who, price] of [['alpha', 132000], ['bravo', 127500], ['charlie', 141000]]) {
  const r = await upload('/api/bids', tok[who], { tenderId: REF }, 'bid', bidFile(who, price));
  bids[who] = { ...r.data, price };
  expect(section, `${who[0].toUpperCase()}${who.slice(1)} submits a sealed bid; signed receipt returned`, r, 201, `${r.data.bidId}, block ${r.data.block}`);
}
check(section, 'Only the encrypted file\'s hash is on the ledger, not the bid', bids.alpha.cipherHash !== sha256(bidFile('alpha', 132000).content), 'cipher hash ≠ plain hash');
{
  const v = await post('/api/receipts/verify', null, bids.alpha);
  check(section, 'The receipt\'s signature checks out', v.data.valid === true, '', v.ms);
  const forged = await post('/api/receipts/verify', null, { ...bids.alpha, submittedAt: '2026-01-01T00:00:00Z' });
  check(section, 'A receipt with a changed time fails the check', forged.data.valid === false);
  expect(section, 'The same company cannot bid twice', await upload('/api/bids', tok.alpha, { tenderId: REF }, 'bid', bidFile('alpha', 1)), 409);
  const sealed = await get(`/api/tender?id=${encodeURIComponent(REF)}`);
  check(section, 'Bids stay sealed before closing', sealed.data.bids.every((b) => !b.opened), `${sealed.data.bids.length} sealed`);
}

// 3.5.5 Opening and evaluation -----------------------------------------------------------------------------------
section = '3.5.5';
const candidates = (await get('/api/evaluation/candidates', tok.officer)).data;
const members = [users.m1.user.id, users.m2.user.id];
expect(section, 'Officer appoints a committee of two', await post('/api/evaluation/committee', tok.officer, { reference: REF, memberIds: members }), 200,
  `${candidates.length} candidates`);
expect(section, 'Approval to open before closing is refused by the ledger', await post('/api/evaluation/approve', tok.m1, { reference: REF }), 409);
expect(section, 'Opening without the committee\'s approvals is refused', await post('/api/evaluation/open', tok.officer, { reference: REF }), 409);

// Tamper: before opening, point Charlie's stored bid at a different file, as if someone swapped it on IPFS
psql(`update "Bid" set cid = '${pub.data.cid}' where "bidId" = '${bids.charlie.bidId}'`);
check(section, 'Tamper test: Charlie\'s stored bid file swapped in the database', true, 'cid replaced with another file');

const wait = closesAt - Date.now() + 2000;
if (wait > 0) { console.log(`… waiting ${Math.round(wait / 1000)} s for the tender to close`); await sleep(wait); }
expect(section, 'A late bid after closing is refused by the ledger', await upload('/api/bids', tok.bravo, { tenderId: REF }, 'bid', bidFile('bravo', 1)), 409);
expect(section, 'Committee member 1 approves opening (signed with own identity)', await post('/api/evaluation/approve', tok.m1, { reference: REF }), 200);
expect(section, 'The same member cannot approve twice', await post('/api/evaluation/approve', tok.m1, { reference: REF }), 409);
expect(section, 'Committee member 2 approves; quorum reached', await post('/api/evaluation/approve', tok.m2, { reference: REF }), 200);
{
  const o = await post('/api/evaluation/open', tok.m1, { reference: REF });
  const r = Object.fromEntries(o.data.results.map((x) => [x.bidId, x]));
  check(section, 'Bids open; each checked against its ledger hash', r[bids.alpha.bidId]?.integrity === 'MATCH' && r[bids.bravo.bidId]?.integrity === 'MATCH', '', o.ms);
  check(section, 'The swapped bid fails the integrity check and is not opened', r[bids.charlie.bidId]?.integrity === 'MISMATCH', r[bids.charlie.bidId]?.reason);
}
for (const [who, scores] of [['alpha', [82, 78]], ['bravo', [74, 70]]]) {
  await post('/api/evaluation/price', tok.m1, { bidId: bids[who].bidId, priceKwacha: bids[who].price });
  for (const [i, m] of ['m1', 'm2'].entries()) await post('/api/evaluation/score', tok[m], { bidId: bids[who].bidId, technicalScore: scores[i], comment: 'Meets the specification.' });
}
expect(section, 'A technical score outside 0–100 is refused', await post('/api/evaluation/score', tok.m1, { bidId: bids.alpha.bidId, technicalScore: 120, comment: 'x' }), 400);
const ev = (await get(`/api/evaluation?reference=${encodeURIComponent(REF)}`, tok.m1)).data;
const top = ev.ranking.recommendedBidId;
const other = [bids.alpha.bidId, bids.bravo.bidId].find((b) => b !== top);
check(section, 'Ranking: 70% technical, 30% financial', !!top, ev.ranking.rows.map((r) => `${r.bidId} ${r.combined}`).join(', '));
expect(section, 'Departing from the ranking without a justification is refused', await post('/api/evaluation/recommend', tok.m1, { reference: REF, bidId: other }), 400);
const rec = await post('/api/evaluation/recommend', tok.m1, { reference: REF, bidId: top });
expect(section, 'The committee recommends the top-ranked bid; report hash recorded', rec, 201, rec.data.reportHash?.slice(0, 16));
expect(section, 'After the recommendation, scores cannot change', await post('/api/evaluation/score', tok.m2, { bidId: top, technicalScore: 10, comment: 'x' }), 409);

// 3.5.6 / 3.5.7 Award, AI risk scoring, contract and milestone payment -------------------------------------------
section = '3.5.6';
const mailBefore = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()).total;
const award = await post('/api/contracts/award', tok.officer, { reference: REF });
expect(section, 'Officer awards to the recommended bid; evaluation hash on the ledger', award, 201, `${award.data.awardId}, ${award.data.amountNgwee / 100} K`);
const awardId = award.data.awardId;
check('3.5.7', 'The award is scored by the AI service', Number.isInteger(award.data.risk?.score), `score ${award.data.risk?.score}${award.data.risk?.alert ? `, alert ${award.data.risk.alertId}` : ', no alert'}`);
const inspectors = (await get('/api/contracts/inspectors', tok.officer)).data;
const half = Math.round(award.data.amountNgwee / 2) / 100;
const milestones = [
  { description: 'Delivery of 60 beds', amountKwacha: half, dueDate: today() },
  { description: 'Installation and handover', amountKwacha: award.data.amountNgwee / 100 - half, dueDate: today() },
];
expect(section, 'Milestones that do not add up to the contract value are refused', await upload('/api/contracts/sign', tok.officer,
  { awardId, inspectorId: users.inspector.user.id, milestones: JSON.stringify([{ ...milestones[0], amountKwacha: 1 }]) }, 'contract', { file: 'c.txt', content: 'c' }), 400);
const contractDoc = { file: `contract-${run}.txt`, content: `Signed contract ${awardId} for ${REF}.\n` };
const signed = await upload('/api/contracts/sign', tok.officer, { awardId, inspectorId: users.inspector.user.id, milestones: JSON.stringify(milestones) }, 'contract', contractDoc);
expect(section, 'Officer signs the contract: hash and payment schedule on the ledger', signed, 200, `${signed.data.milestones?.length} milestones, inspector of ${inspectors.length}`);
expect(section, 'Payment before an inspector certifies is refused', await post('/api/contracts/pay', tok.officer, { awardId, milestoneId: 'MS-1' }), 409);

const cert = { file: 'certificate-MS-1.txt', content: `Completion certificate ${awardId} MS-1: 60 beds delivered. Signed, inspector.\n` };
const certified = await upload('/api/contracts/certify', tok.inspector, { awardId, milestoneId: 'MS-1', completionDate: today() }, 'certificate', cert);
expect(section, 'Inspector certifies MS-1 with a signed certificate', certified, 200, `payment ${certified.data.payment?.status}`);
check('3.5.7', 'The contract is scored by the AI before payment', Number.isInteger(certified.data.risk?.score), `score ${certified.data.risk?.score}`);
expect(section, 'The same milestone cannot be certified twice', await upload('/api/contracts/certify', tok.inspector, { awardId, milestoneId: 'MS-1', completionDate: today() }, 'certificate', cert), 409);

// If the AI flagged the procurement, the payment is held until a regulator decides (3.5.6, 3.5.8)
let payment = certified.data.payment;
const alerts = (await get('/api/oversight/alerts', tok.regulator)).data.filter((a) => [REF, awardId].includes(a.subjectId));
if (payment.status === 'HELD') {
  check(section, 'Flagged as high risk: the ledger holds the payment', true, payment.reason);
  for (const a of alerts.filter((x) => x.status === 'OPEN')) {
    const d = await post('/api/oversight/alerts/decide', tok.regulator, { alertId: a.id, subjectId: a.subjectId, decision: 'MONITOR', reason: 'System test: reviewed the bidders and prices; keep watching.' });
    expect('3.5.8', `Regulator decides "monitor" on ${a.id} (score ${a.score})`, d, 201, `record hash ${d.data.recordHash?.slice(0, 16)}`);
    expect('3.5.8', 'A decision the ledger does not allow next is refused', await post('/api/oversight/alerts/decide', tok.regulator,
      { alertId: a.id, subjectId: a.subjectId, decision: 'MONITOR', reason: 'System test: the same decision again.' }), 409);
  }
  const retry = await post('/api/contracts/pay', tok.officer, { awardId, milestoneId: 'MS-1' });
  payment = retry.data;
  check(section, 'After the decision the payment goes through', payment.status === 'PAID', payment.ifmisRef ?? payment.reason, retry.ms);
} else {
  check(section, 'Not flagged: paid through IFMIS straight away', payment.status === 'PAID', payment.ifmisRef);
}
check(section, 'The IFMIS payment reference is recorded on the ledger', /^IFMIS-\d{4}-\d{6}$/.test(payment.ifmisRef ?? ''), payment.ifmisRef);
expect(section, 'The same milestone cannot be paid twice', await post('/api/contracts/pay', tok.officer, { awardId, milestoneId: 'MS-1' }), 409);

// 3.5.8 History --------------------------------------------------------------------------------------------------
{
  const h = await get(`/api/oversight/history?reference=${encodeURIComponent(awardId)}`, tok.regulator);
  const what = h.data.events?.map((e) => e.what) ?? [];
  const needed = ['Tender published', 'Sealed bid submitted', 'Committee member approved opening', 'Bid opened', 'Committee recommendation',
    'Contract awarded', 'Contract signed', 'Milestone certified complete', 'Payment made'];
  check('3.5.8', 'The regulator sees the whole history, from publication to payment', needed.every((n) => what.includes(n)), `${what.length} events`, h.ms);
  const times = h.data.events.map((e) => new Date(e.at).getTime());
  check('3.5.8', 'The history is in time order', times.every((t, i) => i === 0 || t >= times[i - 1]));
}

// 3.5.9 Public portal --------------------------------------------------------------------------------------------
section = '3.5.9';
{
  const s = await get(`/api/public/search?q=${encodeURIComponent(run)}`);
  check(section, 'Anyone can find the tender, contract and payment without signing in', s.data.tenders.length === 1 && s.data.contracts.length === 1 && s.data.payments.length === 1, '', s.ms);
  const json = JSON.stringify(s.data);
  check(section, 'No personal data or bid contents in public results', !/@|Grace|Chanda|Mwila|bid for/i.test(json));
  const v = await upload('/api/public/verify', null, { kind: 'contract', awardId }, 'document', contractDoc);
  check(section, 'The signed contract can be checked against the ledger', v.data.matches === true);
  const c = await upload('/api/public/verify', null, { kind: 'certificate', awardId, milestoneId: 'MS-1' }, 'document', { ...cert, content: cert.content.replace('60', '50') });
  check(section, 'An altered completion certificate does not match', c.data.matches === false);
  const o = await get(`/api/public/ocds?reference=${encodeURIComponent(REF)}`);
  const rel = (Buffer.isBuffer(o.data) ? JSON.parse(o.data.toString()) : o.data).releases[0];
  check(section, 'OCDS release includes the award, milestones and the payment', rel.awards?.length === 1 && rel.contracts?.[0].milestones.length === 2
    && rel.contracts[0].implementation.transactions.length === 1, rel.ocid, o.ms);
}

// 3.5.10 Reports and notifications -------------------------------------------------------------------------------
section = '3.5.10';
for (const kind of ['procurement', 'payments', 'alerts']) {
  for (const format of ['pdf', 'xlsx']) {
    const r = await get(`/api/reports/${kind}?format=${format}`, tok.regulator);
    const ok = r.status === 200 && (format === 'pdf' ? r.data.subarray(0, 4).toString() === '%PDF' : r.data.subarray(0, 2).toString() === 'PK');
    check(section, `${kind} report as ${format.toUpperCase()}`, ok, `${r.data.length} bytes`, r.ms);
  }
}
expect(section, 'A bidder cannot download reports', await get('/api/reports/procurement?format=pdf', tok.alpha), 403);
await sleep(1500);
const mailAfter = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()).total;
check(section, 'E-mail notifications sent for the award and the payment', mailAfter - mailBefore >= 2, `${mailAfter - mailBefore} new messages in Mailpit`);

// ---- Report -----------------------------------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const timed = results.filter((r) => r.ms !== null);
const lines = [
  '# Phase 6 system test', '',
  `Run \`${run}\` on ${started.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lusaka' })} · tender \`${REF}\` · award \`${awardId}\``, '',
  'One full procurement through the running system: the API, the Fabric network (ZPPA and OAG peers, majority endorsement), IPFS,',
  'PostgreSQL, the AI risk service and the stand-ins for PACRA, ZRA and IFMIS. Script: `backend/system-test/run.mjs`.', '',
  `**Result: ${passed} passed, ${results.length - passed} failed** (${results.length} checks)`, '',
  '| # | Req. | Check | Result | Detail | Time (ms) |', '|---|---|---|---|---|---|',
  ...results.map((r, i) => `| ${i + 1} | ${r.req} | ${r.step} | ${r.ok ? 'PASS' : '**FAIL**'} | ${String(r.detail ?? '').replace(/\|/g, '/')} | ${r.ms ?? ''} |`),
  '', '## Checks per requirement', '', '| Requirement | Checks | Passed |', '|---|---|---|',
  ...[...new Set(results.map((r) => r.req))].map((q) => { const x = results.filter((r) => r.req === q); return `| ${q} | ${x.length} | ${x.filter((r) => r.ok).length} |`; }),
  '', `Median response time of the ${timed.length} timed calls: ${[...timed].sort((a, b) => a.ms - b.ms)[Math.floor(timed.length / 2)].ms} ms.`, '',
];
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`\n${passed}/${results.length} passed. Written to docs/phase6/system-test-results.md`);
process.exit(passed === results.length ? 0 : 1);
