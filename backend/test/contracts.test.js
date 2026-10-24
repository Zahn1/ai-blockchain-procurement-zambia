// Tests for Chapter 3, 3.5.6 Smart Contract Award and Milestone Payment.
// The fake ledger applies the chaincode's payment rules (inspector-only certification, amount check, high-risk hold);
// the chaincode itself is tested in chaincode/contracts and on the live network. IFMIS is the stand-in, over HTTP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { dbStore } from '../src/store.js';
import { ifmisStandIn } from '../src/standins/services.js';
import { ifmisClient } from '../src/ifmis.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

class LedgerError extends Error {}
const HIGH_RISK = 70;

function fakeLedger() {
  const awards = new Map();
  const milestones = new Map(); // `${award}/${ms}` -> milestone
  const alerts = [];
  const calls = [];
  let block = 100;
  const tx = (result = null) => ({ result, txId: `tx${++block}`, block });
  const flag = (a) => alerts.find((x) => [a.id, a.tenderId].includes(x.subjectId) && x.score >= HIGH_RISK && ['OPEN', 'REFERRED'].includes(x.status));
  function blocker(a, m, amount) {
    if (m.status !== 'COMPLETED') return `milestone ${m.id} is ${m.status}; payment is allowed only after an inspector certifies completion`;
    if (m.paid + amount > m.amount) return `payment would bring milestone ${m.id} above its amount`;
    const f = flag(a);
    return f ? `${f.subjectType} ${f.subjectId} is flagged as high risk (alert ${f.id}, score ${f.score}, ${f.status})` : '';
  }
  return {
    calls, alerts,
    async submit(identity, fn, ...args) {
      calls.push({ identity, fn, args });
      if (fn === 'AwardContract:MakeAward') {
        const [id, tenderId, bidId, amount, evalHash] = args;
        const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        awards.set(id, { id, tenderId, bidId, amount, evalHash, status: 'AWARDED', awardedAt: at, standstillEnds: at, contractValue: amount, paidTotal: 0 });
        return tx();
      }
      if (fn === 'AwardContract:SignContract') { awards.get(args[0]).status = 'SIGNED'; return tx(); }
      if (fn === 'MilestoneContract:AddMilestone') {
        const [award, ms, amount, due] = args;
        milestones.set(`${award}/${ms}`, { id: ms, amount, due, status: 'PENDING', paid: 0 });
        return tx();
      }
      if (fn === 'MilestoneContract:CompleteMilestone') {
        if (!identity?.startsWith('inspector')) throw new LedgerError(`access denied: role "${identity}" may not perform this action`);
        const [award, ms, , amount] = args;
        const m = milestones.get(`${award}/${ms}`);
        if (amount !== m.amount) throw new LedgerError(`the certificate certifies ${amount} ngwee, but milestone ${ms} is for ${m.amount} ngwee`);
        m.status = 'COMPLETED';
        return tx();
      }
      if (fn === 'MilestoneContract:RecordPayment') {
        const [award, ms, , amount] = args;
        const a = awards.get(award);
        const m = milestones.get(`${award}/${ms}`);
        const reason = blocker(a, m, amount);
        if (reason) throw new LedgerError(reason);
        m.paid += amount;
        a.paidTotal += amount;
        return tx();
      }
      throw new Error(`unexpected ${fn}`);
    },
    async evaluate(_identity, fn, ...args) {
      if (fn === 'AwardContract:ReadAward') return awards.get(args[0]);
      if (fn === 'AlertContract:GetAlertsForSubject') return alerts.filter((x) => x.subjectId === args[0]);
      if (fn === 'MilestoneContract:CheckPayable') {
        const [award, ms, amount] = args;
        const reason = blocker(awards.get(award), milestones.get(`${award}/${ms}`), amount);
        return { payable: !reason, reason };
      }
      throw new Error(`unexpected ${fn}`);
    },
  };
}

let ifmisServer;
let ifmisUrl;
beforeAll(() => {
  const s = express();
  s.use('/ifmis', ifmisStandIn());
  ifmisServer = s.listen(0);
  ifmisUrl = `http://127.0.0.1:${ifmisServer.address().port}/ifmis`;
});
afterAll(async () => { ifmisServer.close(); await db.$disconnect(); });

function makeApp(risk) {
  const ledger = fakeLedger();
  const instructions = [];
  const real = ifmisClient({ url: ifmisUrl });
  const ifmis = { async instruct(i) { instructions.push(i); return real.instruct(i); } };
  const files = new Map();
  const ipfs = { async add(b) { const cid = `bafy${files.size}x${Math.random()}`; files.set(cid, b); return cid; }, async cat(c) { return files.get(c); } };
  const app = createApp({ ledger, ipfs, store: dbStore(db), keys: {}, receiptSigner: async () => [], db, auth: makeAuth(),
    ifmis, inspectorIdentities: ['inspector1', 'inspector2'], ...(risk ? { risk } : {}) });
  return { app, ledger, instructions };
}

const REF = 'ZPPA/MOH/2026/0601';
let officer;
let inspectors;
let bidder;
const as = (who) => ({ authorization: who.header });
const today = new Date();
const inDays = (n) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** A tender evaluated and recommended (3.5.5), ready to award: bid price K140,000. */
async function recommendedTender() {
  await db.tender.create({ data: { reference: REF, title: 'Laptops', fileName: 't.pdf', docHash: 'a'.repeat(64), cid: 'bafyT',
    closingTime: new Date(), txId: 'tx1', block: 1, publishedById: officer.user.id } });
  await db.bid.create({ data: { bidId: 'BID-A', tenderRef: REF, supplierId: bidder.supplier.pacraNumber, supplierRef: bidder.supplier.supplierRef,
    fileName: 'b.pdf', cid: 'bafyB', cipherHash: 'b'.repeat(64), txId: 'tx2', submittedAt: new Date(), integrity: 'MATCH',
    plainHash: 'c'.repeat(64), openedAt: new Date(), priceNgwee: 14_000_000n } });
  await db.recommendation.create({ data: { tenderRef: REF, bidId: 'BID-A', recommendedBidId: 'BID-A', report: {},
    reportHash: 'd'.repeat(64), decidedById: officer.user.id } });
}

const schedule = [
  { description: 'Delivery of 20 laptops', amountKwacha: 60000, dueDate: inDays(30) },
  { description: 'Delivery of 20 laptops and installation', amountKwacha: 80000, dueDate: inDays(60) },
];

async function signed(app, ledger) {
  const award = await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF });
  const res = await request(app).post('/api/contracts/sign').set(as(officer)).field('awardId', award.body.awardId)
    .field('inspectorId', inspectors[0].user.id).field('milestones', JSON.stringify(schedule))
    .attach('contract', Buffer.from('signed contract'), 'contract.pdf');
  expect(res.status).toBe(200);
  return award.body.awardId;
}

const certify = (app, awardId, who = inspectors[0], milestoneId = 'MS-1') => request(app).post('/api/contracts/certify').set(as(who))
  .field('awardId', awardId).field('milestoneId', milestoneId).field('completionDate', inDays(0))
  .attach('certificate', Buffer.from('signed completion certificate'), 'certificate.pdf');

beforeEach(async () => {
  await resetDb();
  officer = await signedIn('OFFICER');
  inspectors = [await signedIn('INSPECTOR', { fabricIdentity: 'inspector1' }), await signedIn('INSPECTOR', { fabricIdentity: 'inspector2' })];
  bidder = await signedIn('SUPPLIER');
  await recommendedTender();
});

describe('Award', () => {
  test('awards the recommended bid, with the evaluation report hash on the ledger', async () => {
    const { app, ledger } = makeApp();
    const res = await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ bidId: 'BID-A', amountNgwee: 14_000_000, status: 'AWARDED' });
    const call = ledger.calls.find((c) => c.fn === 'AwardContract:MakeAward');
    expect(call.args.slice(1)).toEqual([REF, 'BID-A', 14_000_000, 'd'.repeat(64)]);
    expect((await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF })).status).toBe(409);
  });

  test('only an officer can award', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/contracts/award').set(as(inspectors[0])).send({ reference: REF })).status).toBe(403);
  });
});

describe('The smart contract encodes the milestones, amounts and payment schedule', () => {
  test('signing records the contract hash and each milestone with its amount and due date', async () => {
    const { app, ledger } = makeApp();
    const awardId = await signed(app, ledger);
    const added = ledger.calls.filter((c) => c.fn === 'MilestoneContract:AddMilestone').map((c) => c.args.slice(1, 3));
    expect(added).toEqual([['MS-1', 6_000_000], ['MS-2', 8_000_000]]);
    const detail = await request(app).get('/api/contracts/detail').query({ awardId }).set(as(officer));
    expect(detail.body.milestones.map((m) => m.description)).toEqual(schedule.map((m) => m.description));
    expect(detail.body.inspector.id).toBe(inspectors[0].user.id);
  });

  test.each([
    [[{ description: 'All', amountKwacha: 100000, dueDate: inDays(30) }], 'add up to K100,000, but the contract is for K140,000'],
    [[{ description: 'All', amountKwacha: 140000, dueDate: inDays(-2) }], 'due date from today onwards'],
    [[{ description: ' ', amountKwacha: 140000, dueDate: inDays(30) }], 'needs a description'],
    [[], 'between 1 and'],
  ])('rejects an invalid schedule %#', async (milestones, message) => {
    const { app } = makeApp();
    const award = await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF });
    const res = await request(app).post('/api/contracts/sign').set(as(officer)).field('awardId', award.body.awardId)
      .field('inspectorId', inspectors[0].user.id).field('milestones', JSON.stringify(milestones))
      .attach('contract', Buffer.from('c'), 'c.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  test('the inspector must be an active inspector', async () => {
    const { app } = makeApp();
    const award = await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF });
    const res = await request(app).post('/api/contracts/sign').set(as(officer)).field('awardId', award.body.awardId)
      .field('inspectorId', officer.user.id).field('milestones', JSON.stringify(schedule)).attach('contract', Buffer.from('c'), 'c.pdf');
    expect(res.body.error).toMatch(/active inspector/);
  });
});

describe('An authorised inspector certifies completion', () => {
  test('the certificate is signed with the inspector\'s own ledger identity and checked against the milestone amount', async () => {
    const { app, ledger } = makeApp();
    const awardId = await signed(app, ledger);
    const res = await certify(app, awardId);
    expect(res.status).toBe(200);
    const call = ledger.calls.find((c) => c.fn === 'MilestoneContract:CompleteMilestone');
    expect(call.identity).toBe('inspector1');
    expect(call.args[3]).toBe(6_000_000);
    expect(call.args[2]).toMatch(/^[0-9a-f]{64}$/); // certificate hash
  });

  test('only the inspector assigned to the contract can certify', async () => {
    const { app, ledger } = makeApp();
    const awardId = await signed(app, ledger);
    expect((await certify(app, awardId, inspectors[1])).status).toBe(403);
    expect((await certify(app, awardId, officer)).status).toBe(403);
  });

  test('a milestone is certified once', async () => {
    const { app, ledger } = makeApp();
    const awardId = await signed(app, ledger);
    await certify(app, awardId);
    expect((await certify(app, awardId)).status).toBe(409);
  });
});

describe('Payment through IFMIS', () => {
  test('a valid certificate on a contract not flagged as high risk is paid, and the IFMIS reference goes on the ledger', async () => {
    const { app, ledger, instructions } = makeApp();
    const awardId = await signed(app, ledger);
    const res = await certify(app, awardId);
    expect(res.body.payment).toMatchObject({ status: 'PAID', ifmisRef: expect.stringMatching(/^IFMIS-\d{4}-\d{6}$/) });
    expect(instructions).toEqual([{ paymentId: `PAY-${awardId}-MS-1`, contractRef: awardId, milestoneRef: 'MS-1',
      amountNgwee: 6_000_000, payeeRef: bidder.supplier.supplierRef }]);
    const recorded = ledger.calls.find((c) => c.fn === 'MilestoneContract:RecordPayment');
    expect(recorded.args).toEqual([awardId, 'MS-1', `PAY-${awardId}-MS-1`, 6_000_000, res.body.payment.ifmisRef]);
  });

  test('a contract flagged as high risk is not paid: no instruction goes to IFMIS', async () => {
    const { app, ledger, instructions } = makeApp();
    const awardId = await signed(app, ledger);
    ledger.alerts.push({ id: 'ALT-1', subjectType: 'contract', subjectId: awardId, score: 82, status: 'OPEN' });
    const res = await certify(app, awardId);
    expect(res.body.payment.status).toBe('HELD');
    expect(res.body.payment.reason).toMatch(/flagged as high risk \(alert ALT-1, score 82, OPEN\)/);
    expect(instructions).toHaveLength(0);
    expect(ledger.calls.some((c) => c.fn === 'MilestoneContract:RecordPayment')).toBe(false);
    const detail = await request(app).get('/api/contracts/detail').query({ awardId }).set(as(officer));
    expect(detail.body.milestones[0]).toMatchObject({ paymentStatus: 'HELD' });
  });

  test('a held payment goes through once the regulator decides to monitor or clear the alert', async () => {
    const { app, ledger, instructions } = makeApp();
    const awardId = await signed(app, ledger);
    ledger.alerts.push({ id: 'ALT-1', subjectType: 'contract', subjectId: awardId, score: 82, status: 'OPEN' });
    await certify(app, awardId);
    ledger.alerts[0].status = 'MONITOR';
    const res = await request(app).post('/api/contracts/pay').set(as(officer)).send({ awardId, milestoneId: 'MS-1' });
    expect(res.body.status).toBe('PAID');
    expect(instructions).toHaveLength(1);
  });

  test('an alert on the tender also holds payment; a low score does not', async () => {
    const { app, ledger } = makeApp();
    const awardId = await signed(app, ledger);
    ledger.alerts.push({ id: 'ALT-LOW', subjectType: 'contract', subjectId: awardId, score: 40, status: 'OPEN' });
    ledger.alerts.push({ id: 'ALT-T', subjectType: 'tender', subjectId: REF, score: 75, status: 'REFERRED' });
    const res = await certify(app, awardId);
    expect(res.body.payment.reason).toMatch(/tender .* flagged as high risk \(alert ALT-T/);
  });

  test('IFMIS gives the same reference if an instruction is sent twice', async () => {
    const client = ifmisClient({ url: ifmisUrl });
    const i = { paymentId: 'PAY-X-MS-1', contractRef: 'X', milestoneRef: 'MS-1', amountNgwee: 100, payeeRef: 'SUP-1' };
    const first = await client.instruct(i);
    const again = await client.instruct(i);
    expect(again.ifmisRef).toBe(first.ifmisRef);
    await expect(client.instruct({ ...i, amountNgwee: 200 })).rejects.toThrow(/different amount/);
  });

  test('a paid milestone cannot be paid again', async () => {
    const { app, ledger } = makeApp();
    const awardId = await signed(app, ledger);
    await certify(app, awardId);
    const res = await request(app).post('/api/contracts/pay').set(as(officer)).send({ awardId, milestoneId: 'MS-1' });
    expect(res.status).toBe(409);
  });
});

describe('IFMIS stand-in', () => {
  test('keeps its records, so payment references carry on after a restart instead of repeating', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ifmis-')), 'ifmis.json');
    const pay = async (paymentId) => {
      const s = express().use(ifmisStandIn({ file })).listen(0);
      try {
        return (await request(s).post('/api/payment-instructions')
          .send({ paymentId, contractRef: 'AWD-1', milestoneRef: 'MS-1', amountNgwee: 100, payeeRef: 'SUP-A' })).body.ifmisRef;
      } finally { s.close(); }
    };
    const first = await pay('PAY-1');
    const afterRestart = await pay('PAY-2'); // a new stand-in reading the same file
    expect(afterRestart).not.toBe(first);
    expect(await pay('PAY-1')).toBe(first); // a retried instruction still gets its original reference
  });
});

describe('3.5.7 AI scoring of contract events', () => {
  test('the tender is scored when it is awarded, and the contract is scored before any payment', async () => {
    const order = [];
    const risk = { async assess(kind, subject, event) { order.push(`assess ${kind} ${event}`); return { score: 12, alert: false }; } };
    const { app, ledger } = makeApp(risk);
    const realSubmit = ledger.submit.bind(ledger);
    ledger.submit = async (id, fn, ...args) => { order.push(fn); return realSubmit(id, fn, ...args); };
    const award = await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF });
    expect(award.body.risk).toEqual({ score: 12, alert: false, alertId: null });
    const awardId = award.body.awardId;
    await request(app).post('/api/contracts/sign').set(as(officer)).field('awardId', awardId)
      .field('inspectorId', inspectors[0].user.id).field('milestones', JSON.stringify(schedule))
      .attach('contract', Buffer.from('signed contract'), 'contract.pdf');
    order.length = 0;
    await certify(app, awardId);
    expect(order).toEqual(['MilestoneContract:CompleteMilestone', 'assess contract MILESTONE_CERTIFIED', 'MilestoneContract:RecordPayment']);
  });

  test('an award still goes ahead if scoring fails', async () => {
    const { app } = makeApp({ async assess() { return null; } });
    const res = await request(app).post('/api/contracts/award').set(as(officer)).send({ reference: REF });
    expect(res.status).toBe(201);
    expect(res.body.risk).toBeNull();
  });
});
