// Tests for Chapter 3, 3.5.8 Alert Review and Audit Trail.
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbStore } from '../src/store.js';
import { reportHash } from '../src/evaluation.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

class LedgerError extends Error {}
const REF = 'ZPPA/MOH/2026/0801';
const AWARD = 'AWD-0801';
const t = (min) => new Date(Date.UTC(2026, 9, 1, 8, min)).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fakeLedger() {
  const alerts = [
    { id: 'ALT-1', subjectType: 'contract', subjectId: AWARD, score: 82, status: 'OPEN', modelVersion: 'rf-0.1.0', raisedAt: t(50) },
    { id: 'ALT-2', subjectType: 'tender', subjectId: REF, score: 40, status: 'CLEARED', modelVersion: 'rf-0.1.0', raisedAt: t(5) },
    { id: 'ALT-3', subjectType: 'tender', subjectId: 'OTHER/1', score: 95, status: 'MONITOR', modelVersion: 'rf-0.1.0', raisedAt: t(1) },
  ];
  const calls = [];
  const allowed = { OPEN: ['CLEARED', 'MONITOR', 'REFERRED'], MONITOR: ['CLEARED', 'REFERRED'], REFERRED: ['CLEARED'] };
  const tender = (v, status, approvals) => ({ id: REF, version: v, status, approvals, quorum: 2, estValue: 15_000_000,
    closingTime: t(20), docHashes: ['a'.repeat(64)] });
  return {
    calls, alerts,
    async submit(identity, fn, ...args) {
      calls.push({ identity, fn, args });
      if (fn === 'AlertContract:ReviewAlert') {
        const [subject, id, decision] = args;
        const a = alerts.find((x) => x.id === id && x.subjectId === subject);
        if (!(allowed[a.status] ?? []).includes(decision)) throw new LedgerError(`an alert that is ${a.status} cannot become "${decision}"`);
        a.status = decision;
        return { result: null, txId: `tx-${id}-${decision}`, block: 9 };
      }
      throw new Error(`unexpected ${fn}`);
    },
    async evaluate(_identity, fn, ...args) {
      switch (fn) {
        case 'AlertContract:GetAllAlerts': return alerts;
        case 'AlertContract:GetAlertsForSubject': return alerts.filter((a) => a.subjectId === args[0]);
        case 'TenderContract:GetTenderHistory': return [
          { txId: 'tx-pub', timestamp: t(0), tender: tender(1, 'PUBLISHED', []) },
          { txId: 'tx-ap1', timestamp: t(21), tender: tender(1, 'PUBLISHED', ['b'.repeat(64)]) },
          { txId: 'tx-ap2', timestamp: t(22), tender: tender(1, 'PUBLISHED', ['b'.repeat(64), 'c'.repeat(64)]) },
          { txId: 'tx-awd', timestamp: t(30), tender: tender(2, 'AWARDED', ['b'.repeat(64), 'c'.repeat(64)]) },
        ];
        case 'BidContract:GetBidsForTender': return [
          { id: 'BID-A', supplierRef: 'SUP-A', cipherHash: 'd'.repeat(64), submittedAt: t(10), txId: 'tx-bid', opened: true, openedAt: t(23), plainHash: 'e'.repeat(64) },
        ];
        case 'AwardContract:ReadAward': return { id: AWARD, supplierRef: 'SUP-A', amount: 6_000_000, evalHash: 'f'.repeat(64),
          awardedAt: t(30), signedAt: t(31), contractHash: '1'.repeat(64), paidTotal: 6_000_000, contractValue: 6_000_000 };
        case 'MilestoneContract:GetMilestones': return [{ id: 'MS-1', amount: 6_000_000, completedAt: t(40), evidenceHash: '2'.repeat(64), paymentIds: ['PAY-1'] }];
        case 'MilestoneContract:ReadPayment': return { id: 'PAY-1', amount: 6_000_000, paidAt: t(60), txId: 'tx-pay', ifmisRef: 'IFMIS-2026-000001' };
        default: throw new Error(`unexpected ${fn}`);
      }
    },
  };
}

function makeApp() {
  const ledger = fakeLedger();
  const app = createApp({ ledger, ipfs: {}, store: dbStore(db), keys: {}, receiptSigner: async () => [], db, auth: makeAuth(),
    regulatorIdentities: ['regulator1', 'regulator2'] });
  return { app, ledger };
}

let regulator;
let officer;
const as = (who) => ({ authorization: who.header });
const decide = (app, who, body) => request(app).post('/api/oversight/alerts/decide').set(as(who))
  .send({ alertId: 'ALT-1', subjectId: AWARD, decision: 'MONITOR', reason: 'Prices are within 5% of the market; keep watching deliveries.', ...body });

beforeEach(async () => {
  await resetDb();
  regulator = await signedIn('REGULATOR', { fabricIdentity: 'regulator2' });
  officer = await signedIn('OFFICER');
});
afterAll(() => db.$disconnect());

describe('Regulators review each alert', () => {
  test('lists every alert on the ledger, unreviewed first', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/oversight/alerts').set(as(regulator));
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.id)).toEqual(['ALT-1', 'ALT-3', 'ALT-2']);
  });

  test('only regulators can see or decide alerts', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/oversight/alerts').set(as(officer))).status).toBe(403);
    expect((await decide(app, officer)).status).toBe(403);
  });
});

describe('A decision with its reason, and its hash on the ledger', () => {
  test('records the decision and reason, and puts the decision record\'s hash on the ledger, signed by the regulator', async () => {
    const { app, ledger } = makeApp();
    const res = await decide(app, regulator);
    expect(res.status).toBe(201);

    const call = ledger.calls.find((c) => c.fn === 'AlertContract:ReviewAlert');
    expect(call.identity).toBe('regulator2');
    expect(call.args.slice(0, 3)).toEqual([AWARD, 'ALT-1', 'MONITOR']);
    const saved = await db.alertDecision.findFirst();
    expect(saved).toMatchObject({ decision: 'MONITOR', reason: 'Prices are within 5% of the market; keep watching deliveries.', txId: 'tx-ALT-1-MONITOR' });
    expect(call.args[3]).toBe(saved.recordHash);
    expect(reportHash(saved.record)).toBe(saved.recordHash); // the stored record is exactly what was hashed
    expect(saved.record).toMatchObject({ decision: 'MONITOR', reason: saved.reason, decidedBy: regulator.user.email, score: 82 });
  });

  test('a changed reason would no longer match the hash on the ledger', async () => {
    const { app, ledger } = makeApp();
    await decide(app, regulator);
    const saved = await db.alertDecision.findFirst();
    const onLedger = ledger.calls.find((c) => c.fn === 'AlertContract:ReviewAlert').args[3];
    expect(reportHash({ ...saved.record, reason: 'Something else entirely, written later.' })).not.toBe(onLedger);
  });

  test.each([
    [{ decision: 'IGNORE' }, 'cleared, monitor or refer'],
    [{ reason: 'Fine.' }, 'at least 20'],
  ])('rejects %j', async (body, message) => {
    const { app } = makeApp();
    const res = await decide(app, regulator, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test('the ledger decides which decisions may follow: cleared is final', async () => {
    const { app } = makeApp();
    await decide(app, regulator, { decision: 'CLEARED', reason: 'Checked the supplier history: no links to the officer.' });
    const again = await decide(app, regulator, { decision: 'REFERRED', reason: 'Trying to change a final decision afterwards.' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/CLEARED cannot become/);
    expect(await db.alertDecision.count()).toBe(1);
  });
});

describe('The complete history of a procurement', () => {
  async function seedProcurement() {
    await db.tender.create({ data: { reference: REF, title: 'Laptops', fileName: 't', docHash: 'a'.repeat(64), cid: 'c',
      closingTime: new Date(t(20)), txId: 'tx-pub', block: 1, publishedById: officer.user.id } });
    const supplier = await signedIn('SUPPLIER');
    await db.bid.create({ data: { bidId: 'BID-A', tenderRef: REF, supplierId: supplier.supplier.pacraNumber, supplierRef: 'SUP-A',
      fileName: 'b', cid: 'c', cipherHash: 'd'.repeat(64), txId: 'tx-bid', submittedAt: new Date(t(10)) } });
    await db.recommendation.create({ data: { tenderRef: REF, bidId: 'BID-A', recommendedBidId: 'BID-A', report: {},
      reportHash: 'f'.repeat(64), decidedById: officer.user.id, createdAt: new Date(t(25)) } });
    await db.contract.create({ data: { awardId: AWARD, tenderRef: REF, bidId: 'BID-A', supplierRef: 'SUP-A', amountNgwee: 6_000_000n,
      evalHash: 'f'.repeat(64), awardTxId: 'tx-awd', awardedAt: new Date(t(30)), standstillEnds: new Date(t(30)), status: 'SIGNED', signTxId: 'tx-sign' } });
    await db.milestone.create({ data: { awardId: AWARD, milestoneId: 'MS-1', description: 'All', amountNgwee: 6_000_000n,
      dueDate: new Date(t(90)), certifyTxId: 'tx-cert' } });
  }

  test('runs from tender publication to final payment, in time order, with ledger transactions', async () => {
    const { app } = makeApp();
    await seedProcurement();
    await decide(app, regulator);
    const res = await request(app).get('/api/oversight/history').query({ reference: REF }).set(as(regulator));
    expect(res.status).toBe(200);
    const what = res.body.events.map((e) => e.what);
    expect(what[0]).toBe('Tender published');
    expect(what).toEqual(expect.arrayContaining(['Sealed bid submitted', 'Committee member approved opening', 'Bid opened',
      'Committee recommendation', 'Contract awarded', 'Contract signed', 'Milestone certified complete', 'Risk alert raised',
      'Regulator decision: monitor', 'Payment made']));
    expect(what.filter((w) => w === 'Committee member approved opening')).toHaveLength(2);
    expect(res.body.events.at(-1).what).toBe('Regulator decision: monitor'); // made now, after the payment in the seeded data
    const times = res.body.events.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const payment = res.body.events.find((e) => e.what === 'Payment made');
    expect(payment).toMatchObject({ txId: 'tx-pay', detail: expect.stringContaining('IFMIS-2026-000001') });
    expect(res.body.fullyPaid).toBe(true);
  });

  test('only regulators can see the history', async () => {
    const { app } = makeApp();
    await seedProcurement();
    expect((await request(app).get('/api/oversight/history').query({ reference: REF }).set(as(officer))).status).toBe(403);
  });
});

describe('Regulator ledger identities', () => {
  test('each regulator gets their own enrolled ledger identity', async () => {
    const { app } = makeApp();
    await resetDb();
    const admin = await signedIn('ADMIN');
    const create = (n) => request(app).post('/api/admin/users').set(as(admin))
      .send({ email: `reg${n}@zppa.test`, name: `Regulator ${n}`, role: 'REGULATOR', password: 'starting-pass-1' });
    expect((await create(1)).body.fabricIdentity).toBe('regulator1');
    expect((await create(2)).body.fabricIdentity).toBe('regulator2');
    expect((await create(3)).status).toBe(400);
  });
});
