// Tests for Chapter 3, 3.5.9 Public Verification Portal and Open Data. No test here signs in.
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbStore } from '../src/store.js';
import { sha256 } from '../src/sealed.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

const REF = 'ZPPA/MOH/2026/0901';
const AWARD = 'AWD-0901';
const TENDER_DOC = Buffer.from('Tender document v1');
const ADDENDUM = Buffer.from('Addendum 1');
const CONTRACT = Buffer.from('Signed contract');
const CERTIFICATE = Buffer.from('Completion certificate, signed by the inspector');
const t = (min) => new Date(Date.UTC(2026, 9, 1, 8, min)).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fakeLedger() {
  const tender = (v, status, docs) => ({ id: REF, version: v, status, approvals: [], quorum: 2, estValue: 15_000_000,
    closingTime: v === 1 ? t(20) : t(40), docHashes: docs });
  return {
    async submit() { throw new Error('the public portal must not write to the ledger'); },
    async evaluate(_identity, fn, ...args) {
      switch (fn) {
        case 'TenderContract:ReadTender': return tender(2, 'AWARDED', [sha256(TENDER_DOC), sha256(ADDENDUM)]);
        case 'TenderContract:GetTenderHistory': return [
          { txId: 'tx-publish-0001', timestamp: t(0), tender: tender(1, 'PUBLISHED', [sha256(TENDER_DOC)]) },
          { txId: 'tx-amend-00002', timestamp: t(5), tender: tender(2, 'PUBLISHED', [sha256(TENDER_DOC), sha256(ADDENDUM)]) },
          { txId: 'tx-award-00003', timestamp: t(50), tender: tender(3, 'AWARDED', [sha256(TENDER_DOC), sha256(ADDENDUM)]) },
        ];
        case 'AwardContract:ReadAward': return { id: AWARD, status: 'SIGNED', amount: 14_000_000, contractValue: 14_000_000,
          awardedAt: t(50), signedAt: t(51), contractHash: sha256(CONTRACT), supplierRef: 'SUP-ALPHA1' };
        case 'MilestoneContract:GetMilestones': return [
          { id: 'MS-1', amount: 6_000_000, dueDate: t(500), status: 'COMPLETED', completedAt: t(60), evidenceHash: sha256(CERTIFICATE), paymentIds: ['PAY-AWD-0901-MS-1'] },
          { id: 'MS-2', amount: 8_000_000, dueDate: t(900), status: 'PENDING', completedAt: '', evidenceHash: '', paymentIds: [] },
        ];
        case 'MilestoneContract:ReadPayment': return { id: args[0], amount: 6_000_000, paidAt: t(61), ifmisRef: 'IFMIS-2026-000042', txId: 'tx-pay' };
        default: throw new Error(`unexpected ${fn}`);
      }
    },
  };
}

let officer;
let inspector;
let bidder;
let app;
const peopleFields = () => [officer, inspector, bidder].flatMap((p) => [p.user.email, p.user.name]);

beforeEach(async () => {
  await resetDb();
  const entity = await db.procuringEntity.create({ data: { code: 'MOH', name: 'Ministry of Health' } });
  officer = await signedIn('OFFICER', { entityId: entity.id, name: 'Mwila Banda' });
  inspector = await signedIn('INSPECTOR', { fabricIdentity: 'inspector1', name: 'Bwalya Kunda' });
  bidder = await signedIn('SUPPLIER');
  await db.supplier.update({ where: { pacraNumber: bidder.supplier.pacraNumber }, data: { companyName: 'Alpha Computers Limited', supplierRef: 'SUP-ALPHA1' } });
  await db.tender.create({ data: { reference: REF, title: 'Supply of 40 laptops', fileName: 'tender.pdf', docHash: sha256(TENDER_DOC),
    cid: 'bafytenderdoc0000000001', closingTime: new Date(t(40)), txId: 'tx-publish-0001', block: 1, publishedById: officer.user.id } });
  await db.bid.create({ data: { bidId: 'BID-A', tenderRef: REF, supplierId: bidder.supplier.pacraNumber, supplierRef: 'SUP-ALPHA1',
    fileName: 'secret-bid.pdf', cid: 'bafyencryptedbid000000001', cipherHash: 'c'.repeat(64), txId: 'tx-bid', submittedAt: new Date(t(10)),
    integrity: 'MATCH', plainHash: 'p'.repeat(64), priceNgwee: 14_000_000n } });
  await db.contract.create({ data: { awardId: AWARD, tenderRef: REF, bidId: 'BID-A', supplierRef: 'SUP-ALPHA1', amountNgwee: 14_000_000n,
    evalHash: 'e'.repeat(64), awardTxId: 'tx-award-00003', awardedAt: new Date(t(50)), standstillEnds: new Date(t(50)), status: 'SIGNED',
    contractCid: 'bafysignedcontract0000001', contractHash: sha256(CONTRACT), signedAt: new Date(t(51)), inspectorId: inspector.user.id } });
  await db.milestone.create({ data: { awardId: AWARD, milestoneId: 'MS-1', description: 'Delivery of 20 laptops', amountNgwee: 6_000_000n,
    dueDate: new Date(t(500)), certificateCid: 'bafycertificate000000001', certificateHash: sha256(CERTIFICATE), certifiedById: inspector.user.id,
    paymentStatus: 'PAID', paymentId: 'PAY-AWD-0901-MS-1', ifmisRef: 'IFMIS-2026-000042', paidAt: new Date(t(61)) } });
  await db.milestone.create({ data: { awardId: AWARD, milestoneId: 'MS-2', description: 'Installation', amountNgwee: 8_000_000n, dueDate: new Date(t(900)) } });
  const files = new Map([['bafytenderdoc0000000001', TENDER_DOC], ['bafyencryptedbid000000001', Buffer.from('ciphertext')],
    ['bafysignedcontract0000001', CONTRACT], ['bafycertificate000000001', CERTIFICATE]]);
  app = createApp({ ledger: fakeLedger(), ipfs: { async cat(c) { return files.get(c); } }, store: dbStore(db), keys: {},
    receiptSigner: async () => [], db, auth: makeAuth() });
});
afterAll(() => db.$disconnect());

const expectNoPersonalData = (text) => {
  for (const p of peopleFields()) expect(text).not.toContain(p);
  expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]/i); // no email addresses at all
};

describe('Search without signing in', () => {
  test('finds tenders, contracts and payments', async () => {
    const res = await request(app).get('/api/public/search');
    expect(res.status).toBe(200);
    expect(res.body.tenders[0]).toMatchObject({ reference: REF, buyer: 'Ministry of Health', awarded: true });
    expect(res.body.contracts[0]).toMatchObject({ awardId: AWARD, supplier: 'Alpha Computers Limited', value: 14_000_000, paid: 1, milestones: 2 });
    expect(res.body.payments).toEqual([expect.objectContaining({ milestoneId: 'MS-1', amount: 6_000_000, ifmisRef: 'IFMIS-2026-000042' })]);
  });

  test.each([['laptops', 1, 1, 1], ['Alpha Computers', 0, 1, 1], ['IFMIS-2026-000042', 0, 0, 1], ['nothing like this', 0, 0, 0]])(
    'searching "%s" finds %i tender(s), %i contract(s), %i payment(s)', async (q, tenders, contracts, payments) => {
      const res = await request(app).get('/api/public/search').query({ q });
      expect([res.body.tenders.length, res.body.contracts.length, res.body.payments.length]).toEqual([tenders, contracts, payments]);
    });

  test('a company that only bid is not matched to a contract it did not win', async () => {
    const loser = await signedIn('SUPPLIER');
    await db.supplier.update({ where: { pacraNumber: loser.supplier.pacraNumber }, data: { companyName: 'Bravo Tech Solutions Limited' } });
    await db.bid.create({ data: { bidId: 'BID-B', tenderRef: REF, supplierId: loser.supplier.pacraNumber, supplierRef: loser.supplier.supplierRef,
      fileName: 'b.pdf', cid: 'bafyencryptedbid000000002', cipherHash: 'd'.repeat(64), txId: 'tx-bid-b', submittedAt: new Date(t(11)) } });
    const res = await request(app).get('/api/public/search').query({ q: 'Bravo' });
    expect(res.body.contracts).toEqual([]);
    expect(res.body.payments).toEqual([]);
  });

  test('shows no personal data', async () => {
    expectNoPersonalData(JSON.stringify((await request(app).get('/api/public/search')).body));
  });
});

describe('Check any published record against its hash on the ledger', () => {
  const check = (fields, file) => {
    let req = request(app).post('/api/public/verify');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('document', file, 'file.pdf');
  };

  test.each([
    ['tender document', { kind: 'tender', reference: REF }, TENDER_DOC],
    ['tender addendum', { kind: 'tender', reference: REF }, ADDENDUM],
    ['signed contract', { kind: 'contract', awardId: AWARD }, CONTRACT],
    ['completion certificate', { kind: 'certificate', awardId: AWARD, milestoneId: 'MS-1' }, CERTIFICATE],
  ])('a genuine %s matches', async (_name, fields, file) => {
    const res = await check(fields, file);
    expect(res.status).toBe(200);
    expect(res.body.matches).toBe(true);
  });

  test('an altered document does not match', async () => {
    const res = await check({ kind: 'contract', awardId: AWARD }, Buffer.from('Signed contract.'));
    expect(res.body).toMatchObject({ matches: false, onLedger: [sha256(CONTRACT)] });
  });

  test('a milestone without a certificate cannot be checked', async () => {
    const res = await check({ kind: 'certificate', awardId: AWARD, milestoneId: 'MS-2' }, CERTIFICATE);
    expect(res.status).toBe(409);
  });
});

describe('Open data in OCDS', () => {
  async function ocds(query = { reference: REF }) {
    const res = await request(app).get('/api/public/ocds').query(query);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    return { res, pkg: JSON.parse(res.text) };
  }

  test('is a release package with the tender, award, contract, milestones and payments', async () => {
    const { pkg } = await ocds();
    expect(pkg).toMatchObject({ version: '1.1', license: expect.stringContaining('creativecommons') });
    const r = pkg.releases[0];
    expect(r.ocid).toBe('ocds-zmproc-ZPPA-MOH-2026-0901');
    expect(r.tender).toMatchObject({ id: REF, status: 'complete', value: { amount: 150000, currency: 'ZMW' }, numberOfTenderers: 1 });
    expect(r.awards[0]).toMatchObject({ id: AWARD, value: { amount: 140000 }, suppliers: [{ name: 'Alpha Computers Limited' }] });
    expect(r.contracts[0].milestones.map((m) => [m.id, m.title, m.status])).toEqual([['MS-1', 'Delivery of 20 laptops', 'met'], ['MS-2', 'Installation', 'scheduled']]);
    expect(r.contracts[0].implementation.transactions).toEqual([expect.objectContaining({
      id: 'PAY-AWD-0901-MS-1', value: { amount: 60000, currency: 'ZMW' }, uri: 'ifmis:IFMIS-2026-000042', payee: expect.objectContaining({ name: 'Alpha Computers Limited' }) })]);
    expect(r.parties.map((p) => p.roles[0]).sort()).toEqual(['buyer', 'supplier']);
  });

  test('includes amendments from the tender\'s ledger history', async () => {
    const { pkg } = await ocds();
    expect(pkg.releases[0].tender.amendments).toEqual([expect.objectContaining({ id: `${REF}-v2`, rationale: expect.stringContaining('extended') })]);
  });

  test('publishes document hashes so anyone can check them', async () => {
    const { pkg } = await ocds();
    const r = pkg.releases[0];
    expect(r.tender.documents.map((d) => d.hash.value)).toEqual([sha256(TENDER_DOC), sha256(ADDENDUM)]);
    expect(r.contracts[0].documents[0].hash.value).toBe(sha256(CONTRACT));
  });

  test('contains no bid contents or personal data', async () => {
    const { res } = await ocds();
    expectNoPersonalData(res.text);
    expect(res.text).not.toContain('secret-bid.pdf');
    expect(res.text).not.toContain('p'.repeat(64)); // nothing about the opened bid
    expect(res.text).not.toContain('bafyencryptedbid');
  });

  test('the full download includes every procurement', async () => {
    const { pkg, res } = await ocds({});
    expect(pkg.releases).toHaveLength(1);
    expect(res.headers['content-disposition']).toMatch(/procurement-ocds\.json/);
  });
});

describe('Files the public can fetch', () => {
  test.each([['the tender document', 'bafytenderdoc0000000001', 200], ['a bid, only as its encrypted file', 'bafyencryptedbid000000001', 200],
    ['a signed contract', 'bafysignedcontract0000001', 404], ['a completion certificate', 'bafycertificate000000001', 404]])(
    '%s', async (_name, cid, status) => {
      expect((await request(app).get(`/api/ipfs/${cid}`)).status).toBe(status);
    });
});
