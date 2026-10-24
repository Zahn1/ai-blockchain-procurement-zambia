// Phase 6 privacy scan (NFR-03): reads every record the ledger holds for every procurement (tenders with their full
// history, bids, awards, milestones, payments and alerts) and searches it for personal or confidential data: e-mail
// addresses, people's names, phone numbers, company names, PACRA numbers, TPINs and bid contents.
// Writes docs/phase6/privacy-scan.md. Run from backend/: node system-test/privacy-scan.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ledger from '../src/fabric.js';
import { actors } from '../src/config.js';

const OUT = fileURLToPath(new URL('../../docs/phase6/privacy-scan.md', import.meta.url));
const psql = (sql) => execFileSync('docker', ['exec', 'procurement-postgres-1', 'psql', '-U', 'procurement', '-d', 'procurement', '-tAF', '\t', '-c', sql])
  .toString().trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
const ev = (fn, ...args) => ledger.evaluate(actors.officer, fn, ...args);

// What must never appear on the ledger, taken from the off-chain database
const people = psql('select email, name, coalesce(phone, \'\') from "User"');
const companies = psql('select "companyName", "pacraNumber", tpin from "Supplier"');
const bidFiles = psql('select "fileName" from "Bid"').flat();
const titles = psql('select title from "Tender" where title <> \'\'').flat();
const forbidden = [
  ...people.flatMap(([email, name, phone]) => [['e-mail', email], ['person', name], ...(phone ? [['phone', phone]] : [])]),
  ...companies.flatMap(([name, pacra, tpin]) => [['company', name], ['PACRA number', pacra], ['TPIN', tpin]]),
  ...bidFiles.map((f) => ['bid file name', f]),
  ...titles.map((t) => ['tender title (kept off-chain)', t]),
];
const patterns = [['e-mail address', /[\w.+-]+@[\w-]+\.[\w.]+/], ['phone number', /\+?260\d{9}/], ['bid contents', /total price|per unit|warranty/i]];

// Every procurement the system knows, read back from the ledger
const records = [];
const refs = psql('select reference from "Tender"').flat();
for (const ref of refs) {
  records.push(['tender', await ev('TenderContract:ReadTender', ref)]);
  for (const h of await ev('TenderContract:GetTenderHistory', ref)) records.push(['tender version', h]);
  for (const b of await ev('BidContract:GetBidsForTender', ref)) records.push(['bid', b]);
}
for (const [awardId] of psql('select "awardId" from "Contract"')) {
  records.push(['award', await ev('AwardContract:ReadAward', awardId)]);
  for (const m of await ev('MilestoneContract:GetMilestones', awardId)) {
    records.push(['milestone', m]);
    for (const pid of m.paymentIds) records.push(['payment', await ev('MilestoneContract:ReadPayment', pid)]);
  }
}
for (const a of await ev('AlertContract:GetAllAlerts')) records.push(['alert', a]);
ledger.close();

// Search every record
const hits = [];
const fields = new Map();
const walk = (value, path, collect) => {
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, Array.isArray(value) ? path : `${path}.${k}`, collect);
  else collect(path, value);
};
for (const [kind, record] of records) {
  const text = JSON.stringify(record);
  for (const [what, value] of forbidden) if (value && value.length >= 4 && text.includes(value)) hits.push(`${kind} ${record.id ?? ''}: ${what} "${value}"`);
  for (const [what, re] of patterns) if (re.test(text)) hits.push(`${kind} ${record.id ?? ''}: ${what} ${text.match(re)[0]}`);
  walk(record, kind, (path, v) => {
    if (!fields.has(path)) fields.set(path, new Set());
    fields.get(path).add(typeof v);
  });
}

const byKind = Object.entries(records.reduce((n, [k]) => ({ ...n, [k]: (n[k] ?? 0) + 1 }), {}));
const report = [
  '# Phase 6 privacy scan (NFR-03)', '',
  `Run on ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lusaka' })}. Script: \`backend/system-test/privacy-scan.mjs\`.`, '',
  `Read back from the ledger: ${records.length} records for ${refs.length} procurements (${byKind.map(([k, n]) => `${n} ${k}`).join(', ')}).`,
  `Searched for ${forbidden.length} known personal or confidential values from the database (${people.length} users' e-mails, names and phones;`,
  `${companies.length} companies' names, PACRA numbers and TPINs; bid file names; tender titles) and for e-mail addresses, phone numbers and bid wording.`, '',
  hits.length ? `**Result: ${hits.length} finding(s)**` : '**Result: nothing personal or confidential found on the ledger.**', '',
  ...(hits.length ? ['| Finding |', '|---|', ...hits.map((h) => `| ${h} |`), ''] : []),
  '## Every field the ledger holds', '',
  'The ledger keeps references, hashes, amounts (in ngwee), times, statuses, organisation IDs (MSP) and pseudonymous',
  'codes. Names, contact details and documents stay off-chain. Fields that identify who acted (`approvals`,',
  '`certifiedBy`, `reviewerRef`) hold the SHA-256 fingerprint of the signer\'s certificate, not a name: only the issuing',
  'organisation can link a fingerprint to a person. Bidders appear only as their `SUP-…` code.', '',
  '| Field | Type |', '|---|---|',
  ...[...fields].sort(([a], [b]) => a.localeCompare(b)).map(([f, t]) => `| \`${f}\` | ${[...t].join(', ')} |`), '',
];
fs.writeFileSync(OUT, report.join('\n'));
console.log(`${records.length} ledger records scanned; ${hits.length} finding(s). Written to docs/phase6/privacy-scan.md`);
for (const h of hits.slice(0, 20)) console.log('  ' + h);
