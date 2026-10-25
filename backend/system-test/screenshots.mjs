// Screenshots of every screen of the front end, for Chapter 4. Signs in as each role (password and one-time code,
// through the API), opens each screen in Chrome at 1440 x 900 and saves a full-page PNG, plus a few phone-sized ones.
// Uses the most recent awarded procurement, so the screens show real data at every stage.
// Needs the whole stack running, Google Chrome, and the demo accounts in backend/data/live (git-ignored).
// Run from backend/: node system-test/screenshots.mjs   → docs/phase5/screenshots/
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { generate } from 'otplib';

const API = process.env.API_URL ?? 'http://localhost:3000';
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('../../docs/phase5/screenshots/', import.meta.url));
const live = new URL('../data/live/', import.meta.url);
const accounts = JSON.parse(fs.readFileSync(new URL('accounts.json', live)));
const secrets = JSON.parse(fs.readFileSync(new URL('secrets.json', live)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lastStep = {};
async function signIn(email) {
  const post = async (path, body) => (await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const step = Math.floor(Date.now() / 30000);
  if (lastStep[email] === step) await sleep((step + 1) * 30000 - Date.now() + 250); // a code works once per 30 s
  lastStep[email] = Math.floor(Date.now() / 30000);
  const l = await post('/api/auth/login', { email, password: accounts[email] });
  const s = await post('/api/auth/code', { stepToken: l.stepToken, code: await generate({ secret: secrets[email] }) });
  if (!s.token) throw new Error(`${email}: ${JSON.stringify(s)}`);
  return s.token;
}

// The most recent awarded procurement and its alert
const officer = await signIn('officer@moh.test');
const [contract] = await (await fetch(`${API}/api/contracts`, { headers: { authorization: `Bearer ${officer}` } })).json();
const { awardId, tenderRef } = contract;
const ref = encodeURIComponent(tenderRef);
const search = tenderRef.split('/').at(-1);
console.log(`Using ${tenderRef} / ${awardId}`);

const SHOTS = {
  public: [null, [
    ['01-sign-in', '/', 'Sign-in: password, then the code from an authenticator app'],
    ['02-register', '/register', 'Bidder registration, checked against PACRA and ZRA'],
    ['03-public-search', `/public?q=${search}`, 'Public portal: tenders, contracts and payments, without signing in'],
    ['04-public-verify', '/public?tab=verify', 'Public portal: checking a document against its hash on the ledger'],
    ['05-public-open-data', '/public?tab=data', 'Public portal: open data in OCDS'],
  ]],
  officer: ['officer@moh.test', [
    ['10-officer-dashboard', '/', 'Procurement officer: dashboard'],
    ['11-officer-tenders', '/tenders', 'Tender register'],
    ['12-officer-publish-tender', '/tenders/new', 'Publishing a tender'],
    ['13-tender-record', `/tender?id=${ref}`, 'Tender record: ledger fields, sealed bids, version history and document check'],
    ['14-officer-evaluation', '/evaluation', 'Tenders to evaluate, with the next step for each'],
    ['15-evaluation', `/evaluation/tender?ref=${ref}`, 'Evaluation: approvals signed on the ledger, opening, 70/30 ranking and recommendation'],
    ['16-officer-contracts', '/contracts', 'Contracts and awards'],
    ['17-contract', `/contracts/detail?id=${awardId}`, 'Contract: payment schedule, certificates, IFMIS payments and risk alerts'],
  ]],
  bidder: ['grace@alpha.test', [
    ['20-bidder-dashboard', '/', 'Bidder: dashboard'],
    ['21-bidder-bids', '/bids', 'Bidder: open tenders and bids submitted'],
    ['22-bidder-tender', `/tender?id=${ref}`, 'Bidder: a tender, with their own sealed bid marked'],
  ]],
  committee: ['member1@moh.test', [
    ['30-committee-dashboard', '/', 'Evaluation committee member: dashboard'],
    ['31-committee-evaluation', `/evaluation/tender?ref=${ref}`, 'Evaluation as a committee member'],
  ]],
  inspector: ['inspector@moh.test', [
    ['40-inspector-dashboard', '/', 'Inspector: dashboard with the contracts to certify'],
    ['41-inspector-contract', `/contracts/detail?id=${awardId}`, 'Inspector: certifying milestones'],
  ]],
  regulator: ['regulator@zppa.test', [
    ['50-regulator-dashboard', '/', 'Regulator: dashboard'],
    ['51-risk-alerts', '/oversight', 'Risk alerts: the AI\'s reasons in plain words and the regulator\'s decision'],
    ['52-procurement-history', `/oversight/history?ref=${awardId}`, 'Procurement history from publication to payment, read from the ledger'],
    ['53-reports', '/reports', 'Reports in PDF and spreadsheet formats'],
  ]],
  admin: ['admin@zppa.test', [
    ['60-admin-dashboard', '/', 'Administrator: dashboard'],
    ['61-admin-users', '/admin/users', 'Users and roles'],
    ['62-admin-bidders', '/admin/bidders', 'Registered bidders and procuring entities'],
    ['63-audit-log', '/admin/audit', 'Audit log'],
  ]],
};
const PHONE = [['public', '70-phone-public', `/public?q=${search}`, 'Public portal on a phone'], ['officer', '71-phone-contract', `/contracts/detail?id=${awardId}`, 'Contract on a phone']];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const index = [];
async function shoot(token, file, path, caption, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  if (token) await page.evaluateOnNewDocument((t) => sessionStorage.setItem('procurement.token', t), token);
  await page.goto(APP + path, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('h1, h2', { timeout: 10000 });
  await sleep(600);
  await page.screenshot({ path: `${OUT}${file}.png`, fullPage: true });
  await context.close();
  index.push([file, caption]);
  console.log(`  ${file}.png`);
}

const tokens = { officer };
for (const [role, [email, shots]] of Object.entries(SHOTS)) {
  const token = email ? (tokens[role] ??= await signIn(email)) : null;
  for (const [file, path, caption] of shots) await shoot(token, file, path, caption, { width: 1440, height: 900 });
}
for (const [role, file, path, caption] of PHONE) await shoot(tokens[role] ?? null, file, path, caption, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
await browser.close();

fs.writeFileSync(`${OUT}README.md`, [
  '# Front-end screenshots', '',
  `Taken ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lusaka' })} from the running system,`,
  `showing procurement \`${tenderRef}\` (award \`${awardId}\`). Desktop at 1440 × 900; phone at 390 × 844.`,
  'Regenerate with `node backend/system-test/screenshots.mjs`.', '',
  '| File | Shows |', '|---|---|',
  ...index.map(([f, c]) => `| [${f}.png](${f}.png) | ${c} |`), '',
].join('\n'));
console.log(`\n${index.length} screenshots in docs/phase5/screenshots/`);
