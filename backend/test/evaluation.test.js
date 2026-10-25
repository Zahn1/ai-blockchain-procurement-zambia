// Tests for Chapter 3, 3.5.5 Bid Opening and Evaluation.
// The fake ledger applies the chaincode's rules (closing time, quorum of distinct signers, no opening without approval);
// the live chaincode itself is tested in chaincode/contracts and by the end-to-end scenario.
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbStore } from '../src/store.js';
import { rankBids, reportHash } from '../src/evaluation.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

class LedgerError extends Error {}

function fakeLedger() {
  const tenders = new Map();
  const bids = new Map(); // tender -> [bid]
  const calls = [];
  let block = 0;
  const tx = (result = null) => ({ result, txId: `tx${++block}`, block });
  return {
    calls, tenders,
    async submit(identity, fn, ...args) {
      calls.push({ identity, fn, args });
      const [ref] = args;
      if (fn === 'TenderContract:PublishTender') {
        tenders.set(ref, { id: ref, closingTime: args[2], docHashes: JSON.parse(args[3]), quorum: args[4], approvals: [], openingApproved: false, status: 'PUBLISHED' });
        bids.set(ref, []);
        return tx();
      }
      const t = tenders.get(ref);
      const closed = new Date() >= new Date(t.closingTime);
      if (fn === 'BidContract:SubmitBid') {
        if (closed) throw new LedgerError(`bidding for tender ${ref} closed at ${t.closingTime}`);
        bids.get(ref).push({ id: args[1], supplierRef: args[2], cipherHash: args[3], opened: false });
        return tx({ submittedAt: new Date().toISOString() });
      }
      if (fn === 'BidContract:ApproveOpening') {
        if (!closed) throw new LedgerError(`bids for tender ${ref} cannot be approved for opening before closing`);
        if (t.approvals.includes(identity)) throw new LedgerError('this committee member has already approved opening');
        t.approvals.push(identity);
        t.openingApproved = t.approvals.length >= t.quorum;
        return tx();
      }
      if (fn === 'BidContract:OpenBid') {
        if (!t.openingApproved) throw new LedgerError(`opening for tender ${ref} needs ${t.quorum} committee approvals`);
        const b = bids.get(ref).find((x) => x.id === args[1]);
        b.opened = true;
        b.plainHash = args[2];
        return tx();
      }
      throw new Error(`unexpected ${fn}`);
    },
    async evaluate(_identity, fn, ref) {
      if (fn === 'TenderContract:ReadTender') return tenders.get(ref);
      if (fn === 'BidContract:GetBidsForTender') return bids.get(ref);
      throw new Error(`unexpected ${fn}`);
    },
    closeTender(ref) { tenders.get(ref).closingTime = new Date(Date.now() - 1000).toISOString(); },
  };
}

function makeApp({ shamirOpening = false } = {}) {
  const ledger = fakeLedger();
  const files = new Map();
  const bidKeys = new Map();
  const ipfs = {
    async add(bytes) { const cid = `bafy${files.size}x${Date.now()}`; files.set(cid, Buffer.from(bytes)); return cid; },
    async cat(cid) { return files.get(cid); },
  };
  const keys = {
    async storeBidKey(id, key) { bidKeys.set(id, key); },
    async loadBidKey(id) { return bidKeys.get(id); },
    async deleteBidKey(id) { bidKeys.delete(id); },
    async sealWithMaster(bytes) { return Buffer.from(bytes).toString('base64'); },
    async unsealWithMaster(text) { return Buffer.from(text, 'base64'); },
  };
  const receiptSigner = async () => {
    const crypto = await import('node:crypto');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    return [privateKey, publicKey.export({ type: 'spki', format: 'pem' })];
  };
  const app = createApp({ ledger, ipfs, store: dbStore(db), keys, receiptSigner, db, auth: makeAuth(),
    committeeIdentities: ['committee1', 'committee2', 'committee3'], shamirOpening });
  return { app, ledger, files, bidKeys };
}

const REF = 'ZPPA/MOH/2026/0501';
let officer;
let members;
let bidders;

beforeEach(async () => {
  await resetDb();
  officer = await signedIn('OFFICER');
  members = [await signedIn('COMMITTEE', { fabricIdentity: 'committee1' }), await signedIn('COMMITTEE', { fabricIdentity: 'committee2' })];
  bidders = [await signedIn('SUPPLIER'), await signedIn('SUPPLIER'), await signedIn('SUPPLIER')];
});
afterAll(() => db.$disconnect());

const as = (who) => ({ authorization: who.header });

async function publishAndBid(app) {
  await request(app).post('/api/tenders').set(as(officer)).field('reference', REF).field('title', 'Laptops')
    .field('estValueKwacha', '150000').field('closesInMinutes', '5').attach('document', Buffer.from('tender doc'), 't.txt');
  const ids = [];
  for (const [i, b] of bidders.entries()) {
    const res = await request(app).post('/api/bids').set(as(b)).field('tenderId', REF)
      .attach('bid', Buffer.from(`Bid ${i}: price K${130 + i * 5},000`), `bid${i}.txt`);
    ids.push(res.body.bidId);
  }
  return ids;
}

async function toOpened(app, ledger) {
  const ids = await publishAndBid(app);
  await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
  ledger.closeTender(REF);
  for (const m of members) await request(app).post('/api/evaluation/approve').set(as(m)).send({ reference: REF });
  await request(app).post('/api/evaluation/open').set(as(members[0])).send({ reference: REF });
  return ids;
}

/** Prices K130,000 / K135,000 / K140,000; technical scores chosen per test. */
async function scoreAll(app, ids, technical) {
  for (const [i, id] of ids.entries()) {
    await request(app).post('/api/evaluation/price').set(as(members[0])).send({ bidId: id, priceKwacha: 130000 + i * 5000 });
    for (const [j, m] of members.entries()) {
      await request(app).post('/api/evaluation/score').set(as(m)).send({ bidId: id, technicalScore: technical[i][j], comment: 'Meets the specification' });
    }
  }
}

describe('Scoring method', () => {
  test('averages technical scores, scores price against the lowest, and combines 70/30', () => {
    const { rows, recommendedBidId } = rankBids([
      { bidId: 'A', supplierRef: 'SUP-A', priceNgwee: 13_000_000, technicalScores: [70, 80] },
      { bidId: 'B', supplierRef: 'SUP-B', priceNgwee: 10_000_000, technicalScores: [90, 90] },
      { bidId: 'C', supplierRef: 'SUP-C', priceNgwee: 9_000_000, technicalScores: [50, 55] },
    ]);
    expect(recommendedBidId).toBe('B');
    expect(rows.map((r) => r.bidId)).toEqual(['B', 'A', 'C']);
    expect(rows[0]).toMatchObject({ technical: 90, financial: 100, combined: 93, eligible: true });
    expect(rows[1]).toMatchObject({ technical: 75, financial: 76.92, combined: 75.58 });
    expect(rows[2]).toMatchObject({ technical: 52.5, eligible: false, financial: null, combined: null });
  });

  test('a cheap bid below the pass mark does not set the financial benchmark', () => {
    const { rows } = rankBids([
      { bidId: 'A', priceNgwee: 100, technicalScores: [80] },
      { bidId: 'B', priceNgwee: 1, technicalScores: [10] },
    ]);
    expect(rows.find((r) => r.bidId === 'A').financial).toBe(100);
  });

  test('a bid exactly at the pass mark is eligible', () => {
    expect(rankBids([{ bidId: 'A', priceNgwee: 100, technicalScores: [60] }]).recommendedBidId).toBe('A');
  });

  test('no eligible bid means no recommendation', () => {
    expect(rankBids([{ bidId: 'A', priceNgwee: 100, technicalScores: [40] }]).recommendedBidId).toBeNull();
  });

  test('the report hash does not depend on key order', () => {
    expect(reportHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(reportHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(reportHash({ a: 1 })).not.toBe(reportHash({ a: 2 }));
  });
});

describe('Committee', () => {
  test('each committee user gets their own ledger identity, and no identity is shared', async () => {
    const { app } = makeApp();
    await resetDb();
    const admin = await signedIn('ADMIN');
    const create = (n) => request(app).post('/api/admin/users').set(as(admin))
      .send({ email: `member${n}@moh.test`, name: `Member ${n}`, role: 'COMMITTEE', password: 'starting-pass-1' });
    const got = [(await create(1)).body.fabricIdentity, (await create(2)).body.fabricIdentity, (await create(3)).body.fabricIdentity];
    expect(new Set(got).size).toBe(3);
    const fourth = await create(4);
    expect(fourth.status).toBe(400);
    expect(fourth.body.error).toMatch(/Enrol another/);
  });

  test('the officer must appoint at least the quorum of committee users', async () => {
    const { app } = makeApp();
    await publishAndBid(app);
    const one = await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: [members[0].user.id] });
    expect(one.status).toBe(400);
    const wrongRole = await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: [members[0].user.id, bidders[0].user.id] });
    expect(wrongRole.status).toBe(400);
  });

  test('only appointed members can see or act on the evaluation', async () => {
    const { app } = makeApp();
    await publishAndBid(app);
    await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
    const outsider = await signedIn('COMMITTEE', { fabricIdentity: 'committee3' });
    expect((await request(app).get('/api/evaluation').query({ reference: REF }).set(as(outsider))).status).toBe(403);
    expect((await request(app).get('/api/evaluation').query({ reference: REF }).set(as(bidders[0]))).status).toBe(403);
  });
});

describe('Tenders to evaluate', () => {
  test('a member sees only the tenders they are appointed to, with where each stands', async () => {
    const { app, ledger } = makeApp();
    await toOpened(app, ledger);
    await db.tender.update({ where: { reference: REF }, data: { closingTime: new Date(Date.now() - 1000) } }); // as closeTender did on the ledger
    const outsider = await signedIn('COMMITTEE', { fabricIdentity: 'committee3' });
    const [mine] = (await request(app).get('/api/evaluation/tenders').set(as(members[0]))).body;
    expect(mine).toMatchObject({ reference: REF, closed: true, committee: 2, approvals: 2, approvedByMe: true, bids: 3, opened: 3,
      recommended: false, awarded: false });
    expect((await request(app).get('/api/evaluation/tenders').set(as(outsider))).body).toEqual([]);
    expect((await request(app).get('/api/evaluation/tenders').set(as(officer))).body.map((t) => t.reference)).toEqual([REF]);
    expect((await request(app).get('/api/evaluation/tenders').set(as(bidders[0]))).status).toBe(403);
  });
});

describe('Opening: after closing, with the committee members\' digital signatures', () => {
  test('approval before the closing time is refused by the ledger', async () => {
    const { app } = makeApp();
    await publishAndBid(app);
    await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
    const res = await request(app).post('/api/evaluation/approve').set(as(members[0])).send({ reference: REF });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/before closing/);
  });

  test('each member signs the approval with their own ledger identity', async () => {
    const { app, ledger } = makeApp();
    await publishAndBid(app);
    await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
    ledger.closeTender(REF);
    for (const m of members) expect((await request(app).post('/api/evaluation/approve').set(as(m)).send({ reference: REF })).status).toBe(200);
    const signers = ledger.calls.filter((c) => c.fn === 'BidContract:ApproveOpening').map((c) => c.identity);
    expect(signers).toEqual(['committee1', 'committee2']);
    const again = await request(app).post('/api/evaluation/approve').set(as(members[0])).send({ reference: REF });
    expect(again.status).toBe(409);
  });

  test('bids cannot be opened until the quorum has signed', async () => {
    const { app, ledger } = makeApp();
    await publishAndBid(app);
    await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
    ledger.closeTender(REF);
    await request(app).post('/api/evaluation/approve').set(as(members[0])).send({ reference: REF });
    const res = await request(app).post('/api/evaluation/open').set(as(officer)).send({ reference: REF });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/needs 2 committee approvals on the ledger; it has 1/);
    expect(ledger.calls.some((c) => c.fn === 'BidContract:OpenBid')).toBe(false);
  });

  test('on opening, each bid is checked against its ledger hash and its opened hash is recorded', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    const opened = ledger.calls.filter((c) => c.fn === 'BidContract:OpenBid');
    expect(opened.map((c) => c.args[1]).sort()).toEqual([...ids].sort());
    expect(opened[0].identity).toBe('committee1'); // signed by the member who opened them
    const bids = await db.bid.findMany();
    expect(bids.every((b) => b.integrity === 'MATCH' && /^[0-9a-f]{64}$/.test(b.plainHash))).toBe(true);

    const file = await request(app).get('/api/evaluation/bid-file').query({ bidId: ids[0] }).set(as(members[1]));
    expect(file.status).toBe(200);
    expect(file.text ?? file.body.toString()).toContain('Bid 0');
  });

  test('a bid whose stored file was altered is not opened and is flagged', async () => {
    const { app, ledger, files } = makeApp();
    const ids = await publishAndBid(app);
    const tampered = await db.bid.findUnique({ where: { bidId: ids[1] } });
    const bytes = files.get(tampered.cid);
    bytes[bytes.length - 1] ^= 0xff; // change one byte of the encrypted file
    await request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
    ledger.closeTender(REF);
    for (const m of members) await request(app).post('/api/evaluation/approve').set(as(m)).send({ reference: REF });
    const res = await request(app).post('/api/evaluation/open').set(as(officer)).send({ reference: REF });

    const result = res.body.results.find((r) => r.bidId === ids[1]);
    expect(result).toMatchObject({ integrity: 'MISMATCH', reason: expect.stringMatching(/does not match the hash recorded on the ledger/) });
    expect(ledger.calls.filter((c) => c.fn === 'BidContract:OpenBid').map((c) => c.args[1])).not.toContain(ids[1]);
    expect((await db.auditLog.findMany({ where: { action: 'bid.integrity_failed' } }))).toHaveLength(1);
  });
});

describe('Scores and the recommended award', () => {
  test('records each member\'s technical score and the bid price; the financial score is calculated', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    await scoreAll(app, ids, [[80, 70], [90, 90], [60, 50]]); // third bid averages 55, below the pass mark of 60
    const res = await request(app).get('/api/evaluation').query({ reference: REF }).set(as(officer));
    expect(res.body.ranking.recommendedBidId).toBe(ids[1]);
    const top = res.body.ranking.rows[0];
    expect(top).toMatchObject({ bidId: ids[1], technical: 90, financial: 96.3, combined: 91.89 });
    expect(res.body.ranking.rows.find((r) => r.bidId === ids[2])).toMatchObject({ technical: 55, eligible: false });
  });

  test.each([
    [{ technicalScore: 101, comment: 'x' }, 'whole number from 0 to 100'],
    [{ technicalScore: 7.5, comment: 'x' }, 'whole number'],
    [{ technicalScore: 70, comment: ' ' }, 'comment'],
  ])('rejects an invalid score %j', async (body, message) => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    const res = await request(app).post('/api/evaluation/score').set(as(members[0])).send({ bidId: ids[0], ...body });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test('a recommendation waits until every member has scored every bid', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    await request(app).post('/api/evaluation/price').set(as(members[0])).send({ bidId: ids[0], priceKwacha: 130000 });
    const res = await request(app).post('/api/evaluation/recommend').set(as(members[0])).send({ reference: REF, bidId: ids[0] });
    expect(res.status).toBe(409);
  });

  test('recommending the top-ranked bid needs no justification', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    await scoreAll(app, ids, [[80, 70], [90, 90], [70, 70]]);
    const res = await request(app).post('/api/evaluation/recommend').set(as(members[0])).send({ reference: REF, bidId: ids[1] });
    expect(res.status).toBe(201);
    expect(res.body.departsFromRecommendation).toBe(false);
  });

  test('departing from the recommended award requires a written justification', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    await scoreAll(app, ids, [[80, 70], [90, 90], [70, 70]]);

    const none = await request(app).post('/api/evaluation/recommend').set(as(members[0])).send({ reference: REF, bidId: ids[0] });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/departs from the recommended bid/);
    const short = await request(app).post('/api/evaluation/recommend').set(as(members[0])).send({ reference: REF, bidId: ids[0], justification: 'Better.' });
    expect(short.status).toBe(400);

    const why = 'The recommended supplier cannot deliver before the start of the school term; this bidder can deliver in 14 days.';
    const ok = await request(app).post('/api/evaluation/recommend').set(as(members[0])).send({ reference: REF, bidId: ids[0], justification: why });
    expect(ok.status).toBe(201);
    expect(ok.body.departsFromRecommendation).toBe(true);

    const saved = await db.recommendation.findUnique({ where: { tenderRef: REF } });
    expect(saved).toMatchObject({ bidId: ids[0], recommendedBidId: ids[1], justification: why });
    expect(saved.reportHash).toBe(reportHash(saved.report)); // the stored report is exactly what was hashed
  });

  test('a bid below the technical pass mark cannot be recommended', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    await scoreAll(app, ids, [[80, 70], [90, 90], [40, 50]]);
    const res = await request(app).post('/api/evaluation/recommend').set(as(members[0]))
      .send({ reference: REF, bidId: ids[2], justification: 'x'.repeat(60) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/below the technical pass mark/);
  });

  test('after the recommendation, scores can no longer change', async () => {
    const { app, ledger } = makeApp();
    const ids = await toOpened(app, ledger);
    await scoreAll(app, ids, [[80, 70], [90, 90], [70, 70]]);
    await request(app).post('/api/evaluation/recommend').set(as(members[0])).send({ reference: REF, bidId: ids[1] });
    const res = await request(app).post('/api/evaluation/score').set(as(members[1])).send({ bidId: ids[0], technicalScore: 100, comment: 'Changed my mind' });
    expect(res.status).toBe(409);
  });
});

describe('Key splitting among the committee (FR-BID-07, SHAMIR_OPENING=on)', () => {
  const appoint = (app) => request(app).post('/api/evaluation/committee').set(as(officer)).send({ reference: REF, memberIds: members.map((m) => m.user.id) });
  const collect = (app, m) => request(app).get('/api/evaluation/share').query({ reference: REF }).set(as(m));
  const provide = (app, m, share) => request(app).post('/api/evaluation/share').set(as(m)).send({ reference: REF, share });
  async function approveAll(app, ledger) {
    ledger.closeTender(REF);
    for (const m of members) await request(app).post('/api/evaluation/approve').set(as(m)).send({ reference: REF });
  }

  test('appointing the committee splits the opening key and removes the back end\'s copies of the bid keys', async () => {
    const { app, bidKeys } = makeApp({ shamirOpening: true });
    const ids = await publishAndBid(app);
    expect(ids.every((id) => bidKeys.has(id))).toBe(true);
    const res = await appoint(app);
    expect(res.body.keySplit).toEqual({ threshold: 2, shares: 2 });
    expect(ids.some((id) => bidKeys.has(id))).toBe(false);
    const bids = await db.bid.findMany({ where: { tenderRef: REF } });
    expect(bids.every((b) => b.wrappedKey)).toBe(true);
    expect((await db.tender.findUnique({ where: { reference: REF } })).openingMode).toBe('SHAMIR');
  });

  test('bids arriving after the split are wrapped for the committee too', async () => {
    const { app, bidKeys } = makeApp({ shamirOpening: true });
    await request(app).post('/api/tenders').set(as(officer)).field('reference', REF).field('title', 'Laptops')
      .field('estValueKwacha', '150000').field('closesInMinutes', '5').attach('document', Buffer.from('tender doc'), 't.txt');
    await appoint(app);
    const bid = await request(app).post('/api/bids').set(as(bidders[0])).field('tenderId', REF).attach('bid', Buffer.from('Bid: K130,000'), 'b.txt');
    expect(bidKeys.has(bid.body.bidId)).toBe(false);
    expect((await db.bid.findUnique({ where: { bidId: bid.body.bidId } })).wrappedKey).toBeTruthy();
  });

  test('each member collects their share once; it cannot be issued again', async () => {
    const { app } = makeApp({ shamirOpening: true });
    await publishAndBid(app);
    await appoint(app);
    const first = await collect(app, members[0]);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ index: expect.any(Number), of: 2, share: expect.stringMatching(/^ZPPA-SHARE:/) });
    expect((await collect(app, members[0])).status).toBe(409);
    expect((await collect(app, bidders[0])).status).toBe(403);
  });

  test('the committee cannot be changed once the key is split', async () => {
    const { app } = makeApp({ shamirOpening: true });
    await publishAndBid(app);
    await appoint(app);
    const again = await appoint(app);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/split/);
  });

  test('approvals on the ledger are not enough: opening needs the quorum\'s key shares', async () => {
    const { app, ledger } = makeApp({ shamirOpening: true });
    await publishAndBid(app);
    await appoint(app);
    const shares = [(await collect(app, members[0])).body.share, (await collect(app, members[1])).body.share];
    await approveAll(app, ledger);
    const none = await request(app).post('/api/evaluation/open').set(as(officer)).send({ reference: REF });
    expect(none.status).toBe(409);
    expect(none.body.error).toMatch(/needs 2 committee key shares; 0 provided/);
    expect((await provide(app, members[0], shares[0])).body).toEqual({ provided: 1, needed: 2 });
    expect((await request(app).post('/api/evaluation/open').set(as(officer)).send({ reference: REF })).body.error).toMatch(/1 provided/);
  });

  test('a share must be the member\'s own, given after they approved', async () => {
    const { app, ledger } = makeApp({ shamirOpening: true });
    await publishAndBid(app);
    await appoint(app);
    const shares = [(await collect(app, members[0])).body.share, (await collect(app, members[1])).body.share];
    expect((await provide(app, members[0], shares[0])).status).toBe(409); // not approved yet
    await approveAll(app, ledger);
    expect((await provide(app, members[0], shares[1])).status).toBe(400); // someone else's share
    expect((await provide(app, members[0], 'not a share')).status).toBe(400);
  });

  test('with the quorum\'s shares the bids open, can be read, and the shares are dropped', async () => {
    const { app, ledger } = makeApp({ shamirOpening: true });
    const ids = await publishAndBid(app);
    await appoint(app);
    const shares = [(await collect(app, members[0])).body.share, (await collect(app, members[1])).body.share];
    await approveAll(app, ledger);
    for (const [i, m] of members.entries()) await provide(app, m, shares[i]);
    const opened = await request(app).post('/api/evaluation/open').set(as(members[0])).send({ reference: REF });
    expect(opened.status).toBe(200);
    expect(opened.body.results.map((r) => r.integrity)).toEqual(['MATCH', 'MATCH', 'MATCH']);
    const file = await request(app).get('/api/evaluation/bid-file').query({ bidId: ids[0] }).set(as(members[1]));
    expect(file.text).toMatch(/^Bid 0: price/);
    const committee = await db.committeeMember.findMany({ where: { tenderRef: REF } });
    expect(committee.every((m) => m.sharePending === null && m.shareSealed === null)).toBe(true);
    const view = await request(app).get('/api/evaluation').query({ reference: REF }).set(as(members[0]));
    expect(view.body.opening).toMatchObject({ mode: 'SHAMIR', threshold: 2, shares: 2, collected: 2, provided: 0 });
  });

  test('with the setting off, nothing changes: the back end opens with its own key', async () => {
    const { app, ledger, bidKeys } = makeApp();
    const ids = await toOpened(app, ledger);
    expect(ids.every((id) => bidKeys.has(id))).toBe(true);
    const view = await request(app).get('/api/evaluation').query({ reference: REF }).set(as(members[0]));
    expect(view.body.opening).toEqual({ mode: 'SERVER' });
    expect(view.body.bids.every((b) => b.integrity === 'MATCH')).toBe(true);
  });
});
