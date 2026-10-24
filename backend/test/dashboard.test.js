// Tests for the dashboard figures and a bidder's own bids (Phase 5).
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbStore } from '../src/store.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

const ledger = { async evaluate(_id, fn) {
  if (fn === 'AlertContract:GetAllAlerts') return [
    { id: 'A1', score: 92, status: 'OPEN' }, { id: 'A2', score: 75, status: 'REFERRED' }, { id: 'A3', score: 40, status: 'OPEN' },
    { id: 'A4', score: 90, status: 'CLEARED' }];
  throw new Error(fn);
} };
const app = () => createApp({ ledger, ipfs: {}, store: dbStore(db), keys: {}, receiptSigner: async () => [], db, auth: makeAuth() });
const as = (w) => ({ authorization: w.header });
let officer;
let alpha;
let bravo;

beforeEach(async () => {
  await resetDb();
  officer = await signedIn('OFFICER');
  alpha = await signedIn('SUPPLIER');
  bravo = await signedIn('SUPPLIER');
  const t = (ref, closing) => db.tender.create({ data: { reference: ref, title: `T ${ref}`, fileName: 'f', docHash: 'a'.repeat(64), cid: 'c',
    closingTime: closing, txId: 'tx', block: 1, publishedById: officer.user.id } });
  await t('OPEN-1', new Date(Date.now() + 86_400_000));
  await t('CLOSED-1', new Date(Date.now() - 86_400_000));
  await t('DONE-1', new Date(Date.now() - 2 * 86_400_000));
  for (const [id, ref, who] of [['B1', 'CLOSED-1', alpha], ['B2', 'DONE-1', alpha], ['B3', 'DONE-1', bravo], ['B4', 'OPEN-1', alpha]]) {
    await db.bid.create({ data: { bidId: id, tenderRef: ref, supplierId: who.supplier.pacraNumber, supplierRef: who.supplier.supplierRef,
      fileName: 'b', cid: 'c', cipherHash: 'h'.repeat(64), txId: `tx-${id}`, submittedAt: new Date() } });
  }
  await db.recommendation.create({ data: { tenderRef: 'DONE-1', bidId: 'B2', recommendedBidId: 'B2', report: {}, reportHash: 'r', decidedById: officer.user.id } });
  await db.contract.create({ data: { awardId: 'AWD-1', tenderRef: 'DONE-1', bidId: 'B2', supplierRef: alpha.supplier.supplierRef, amountNgwee: 14_000_000n,
    evalHash: 'e', awardTxId: 'tx', awardedAt: new Date(), standstillEnds: new Date(), status: 'SIGNED' } });
  await db.milestone.create({ data: { awardId: 'AWD-1', milestoneId: 'MS-1', description: 'd', amountNgwee: 6_000_000n, dueDate: new Date(), paymentStatus: 'PAID' } });
  await db.milestone.create({ data: { awardId: 'AWD-1', milestoneId: 'MS-2', description: 'd', amountNgwee: 8_000_000n, dueDate: new Date(), paymentStatus: 'HELD' } });
});
afterAll(() => db.$disconnect());

test('an officer sees open tenders, tenders awaiting evaluation, contracts, held payments and value awarded', async () => {
  const res = await request(app()).get('/api/dashboard').set(as(officer));
  expect(res.body).toEqual({ role: 'OFFICER', figures: { openTenders: 1, awaitingEvaluation: 1, activeContracts: 1, paymentsHeld: 1, valueAwardedNgwee: 14_000_000 } });
});

test('a bidder sees only their own bids, wins and payments', async () => {
  const res = await request(app()).get('/api/dashboard').set(as(alpha));
  expect(res.body.figures).toEqual({ openTenders: 1, myBids: 3, contractsWon: 1, valueWonNgwee: 14_000_000, paidNgwee: 6_000_000 });
  const other = await request(app()).get('/api/dashboard').set(as(bravo));
  expect(other.body.figures).toMatchObject({ myBids: 1, contractsWon: 0, paidNgwee: 0 });
});

test('a regulator sees unreviewed, high-risk and referred alerts from the ledger', async () => {
  const reg = await signedIn('REGULATOR');
  const res = await request(app()).get('/api/dashboard').set(as(reg));
  expect(res.body.figures).toEqual({ unreviewedAlerts: 2, highRiskAlerts: 2, referred: 1, paymentsHeld: 1, contractValueNgwee: 14_000_000 });
});

test('a bidder\'s bid list shows where each bid stands, and only their own', async () => {
  const res = await request(app()).get('/api/bids/mine').set(as(alpha));
  const outcome = Object.fromEntries(res.body.map((b) => [b.bidId, b.outcome]));
  expect(outcome).toEqual({ B1: 'Under evaluation', B2: 'Won', B4: 'Open' });
  const bravoBids = await request(app()).get('/api/bids/mine').set(as(bravo));
  expect(bravoBids.body.map((b) => [b.bidId, b.outcome])).toEqual([['B3', 'Not successful']]);
  expect((await request(app()).get('/api/bids/mine').set(as(officer))).status).toBe(403);
});

test('the dashboard needs signing in', async () => {
  expect((await request(app()).get('/api/dashboard')).status).toBe(401);
});
