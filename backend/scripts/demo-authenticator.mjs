// Makes a page of authenticator QR codes for the demo accounts, so the presenter can add them all to Google or
// Microsoft Authenticator once and sign in with real codes during a demonstration.
// Reads backend/data/live/secrets.json and accounts.json and writes backend/data/live/demo-accounts.html.
// All three are git-ignored: they hold test passwords and authenticator secrets for the demo accounts only.
// Run from backend/: node scripts/demo-authenticator.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { generateURI } from 'otplib';

const live = new URL('../data/live/', import.meta.url);
const secrets = JSON.parse(fs.readFileSync(new URL('secrets.json', live)));
const accounts = JSON.parse(fs.readFileSync(new URL('accounts.json', live)));
const ROLES = {
  'officer@moh.test': 'Procurement officer', 'member1@moh.test': 'Evaluation committee', 'member2@moh.test': 'Evaluation committee',
  'inspector@moh.test': 'Inspector', 'regulator@zppa.test': 'Regulator', 'admin@zppa.test': 'Administrator',
  'grace@alpha.test': 'Bidder: Alpha Computers', 'peter@bravo.test': 'Bidder: Bravo Tech', 'chanda@charlie.test': 'Bidder: Charlie General Supplies',
};
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const cards = [];
for (const [email, role] of Object.entries(ROLES)) {
  if (!secrets[email]) continue;
  const uri = generateURI({ issuer: 'ZPPA Transparent Procurement', label: email, secret: secrets[email] });
  cards.push(`<div class="card"><img src="${await QRCode.toDataURL(uri, { margin: 1, width: 180 })}" alt="QR code for ${escape(email)}">
    <div><p class="role">${escape(role)}</p><p class="email">${escape(email)}</p><p class="pw">Password: <code>${escape(accounts[email] ?? '(not stored)')}</code></p></div></div>`);
}

const out = fileURLToPath(new URL('demo-accounts.html', live));
fs.writeFileSync(out, `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Demo Accounts</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#0f172a}h1{font-size:20px}.warn{background:#fffbeb;border-left:4px solid #b45309;padding:8px 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;margin-top:16px}
.card{display:flex;gap:12px;align-items:center;border:1px solid #cbd5e1;border-radius:6px;padding:10px}.role{font-weight:600;margin:0}.email{margin:2px 0;font-family:monospace}.pw{margin:0;color:#475569}</style></head>
<body><h1>Demo accounts: scan each code once with your authenticator app</h1>
<p class="warn">Local test accounts only. Do not share or print this page; it holds the demo passwords and authenticator secrets.</p>
<div class="grid">${cards.join('')}</div></body></html>`, { mode: 0o600 });
console.log(`${cards.length} accounts written to ${out}`);
