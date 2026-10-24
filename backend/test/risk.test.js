// Tests for Chapter 3, 3.5.7: scoring procurement events and raising alerts on the ledger.
import { createRisk } from '../src/risk.js';
import { reportHash } from '../src/evaluation.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

const REF = 'ZPPA/MOH/2026/1101';
let officer;
let alpha;
let bravo;

function fakeLedger() {
  const calls = [];
  return {
    calls,
    async submit(identity, fn, ...args) { calls.push({ identity, fn, args }); return { result: null, txId: `tx${calls.length}`, block: 1 }; },
    async evaluate(_id, fn, ...args) {
      if (fn === 'TenderContract:ReadTender') return { id: args[0], estValue: 19_500_000, status: 'AWARDED' };
      if (fn === 'AwardContract:ReadAward') return { contractValue: 14_000_000, paidTotal: 18_200_000, variations: 0 };
      if (fn === 'MilestoneContract:GetMilestones') return [
        { id: 'MS-1', status: 'COMPLETED', dueDate: '2026-10-01T21:59:59Z', completionDate: '2026-10-11T12:00:00Z' },
        { id: 'MS-2', status: 'PENDING', dueDate: '2026-11-01T21:59:59Z' },
      ];
      throw new Error(`unexpected ${fn}`);
    },
  };
}

function fakeAi(result) {
  const calls = [];
  return { calls, async explain(kind, features) { calls.push({ kind, features }); if (result instanceof Error) throw result; return result; } };
}

const ALERT = { score: 91, alert: true, threshold: 70, modelVersion: 'risk-1.0.0',
  components: { supervised: 0.97, unsupervisedPercentile: 0.5, graphPercentile: null },
  reasons: [{ factor: 'buyer_supplier_share', text: "This supplier has won 67% of this buyer's awards.", impact: 4.2, model: 'supervised' }] };

beforeEach(async () => {
  await resetDb();
  const entity = await db.procuringEntity.create({ data: { code: 'MOH', name: 'Ministry of Health' } });
  officer = await signedIn('OFFICER', { entityId: entity.id });
  alpha = await signedIn('SUPPLIER');
  bravo = await signedIn('SUPPLIER');
  const awardedAt = new Date('2026-10-20T10:00:00Z');
  for (const [i, ref] of ['ZPPA/MOH/2026/1099', 'ZPPA/MOH/2026/1100', REF].entries()) {
    await db.tender.create({ data: { reference: ref, title: 'Beds', fileName: 't', docHash: 'a'.repeat(64), cid: 'c',
      closingTime: new Date('2026-10-17T10:00:00Z'), createdAt: new Date('2026-10-14T10:00:00Z'), txId: 'tx', block: 1, publishedById: officer.user.id } });
    const winner = i === 0 ? bravo : alpha; // alpha wins 2 of the buyer's 3 awards, both in October
    await db.contract.create({ data: { awardId: `AWD-${i}`, tenderRef: ref, bidId: `BID-${i}`, supplierRef: winner.supplier.supplierRef,
      amountNgwee: 19_500_000n, evalHash: 'e'.repeat(64), awardTxId: 'tx', awardedAt, standstillEnds: awardedAt, status: 'AWARDED' } });
  }
  await db.bid.create({ data: { bidId: 'BID-2', tenderRef: REF, supplierId: alpha.supplier.pacraNumber, supplierRef: alpha.supplier.supplierRef,
    fileName: 'b', cid: 'c', cipherHash: 'b'.repeat(64), txId: 'tx', submittedAt: new Date('2026-10-16T10:00:00Z') } });
});
afterAll(() => db.$disconnect());

const make = (ai, ledger = fakeLedger()) => ({ ledger,
  risk: createRisk({ db, ledger, ai, auth: makeAuth(), aiIdentity: 'risk-service', officerIdentity: 'officer1' }) });

describe('Scoring events', () => {
  test('an awarded tender is described to the model the way it was trained', async () => {
    const ai = fakeAi({ ...ALERT, alert: false, score: 20 });
    await make(ai).risk.assess('tender', REF, 'TENDER_AWARDED');
    expect(ai.calls[0].kind).toBe('tender');
    expect(ai.calls[0].features).toMatchObject({
      est_value: 195000, n_bidders: 1, period_days: 3, end_weekday: 5, award_value: 195000, decision_days: 3,
      buyer_n_awards: 3, supplier_wins: 2, pair_awards_same_month: 2, bidders: [alpha.supplier.supplierRef], winner: alpha.supplier.supplierRef,
    });
    expect(ai.calls[0].features.buyer_supplier_share).toBeCloseTo(2 / 3);
  });

  test('a contract is described from the ledger: payments, completion and lateness', async () => {
    const ai = fakeAi({ ...ALERT, alert: false, score: 20 });
    await make(ai).risk.assess('contract', 'AWD-2', 'MILESTONE_CERTIFIED');
    expect(ai.calls[0].features).toMatchObject({ contract_value: 140000, n_milestones: 2, milestones_completed: 1,
      paid_ratio: 1.3, variation_recorded: false });
    expect(ai.calls[0].features.avg_days_late).toBeCloseTo(9.58, 1);
  });

  test('below the threshold nothing goes on the ledger', async () => {
    const { ledger, risk } = make(fakeAi({ ...ALERT, alert: false, score: 20 }));
    const r = await risk.assess('tender', REF, 'TENDER_AWARDED');
    expect(r.raised).toBe(false);
    expect(ledger.calls).toHaveLength(0);
  });
});

describe('Alerts at the threshold', () => {
  test('raises the alert on the ledger as the AI service, with the hash of the stored explanation', async () => {
    const { ledger, risk } = make(fakeAi(ALERT));
    const r = await risk.assess('tender', REF, 'TENDER_AWARDED');
    expect(r).toMatchObject({ raised: true, alertId: expect.stringMatching(/^ALT-[0-9A-F]{8}$/) });
    const [call] = ledger.calls;
    expect(call.identity).toBe('risk-service');
    expect(call.fn).toBe('AlertContract:RaiseAlert');
    expect(call.args.slice(1, 5)).toEqual(['tender', REF, 91, 'risk-1.0.0']);
    const saved = await db.riskAlert.findUnique({ where: { alertId: r.alertId } });
    expect(saved.explanation.reasons[0].text).toContain('67%');
    expect(call.args[5]).toBe(saved.explanationHash);
    expect(reportHash(saved.explanation)).toBe(saved.explanationHash);
  });

  test('the same model does not raise a second alert on the same subject', async () => {
    const { ledger, risk } = make(fakeAi(ALERT));
    const first = await risk.assess('tender', REF, 'TENDER_AWARDED');
    const second = await risk.assess('tender', REF, 'TENDER_AWARDED');
    expect(second).toMatchObject({ raised: false, alertId: first.alertId });
    expect(ledger.calls).toHaveLength(1);
  });

  test('if the AI service is down, nothing is raised, the failure is logged and no error escapes', async () => {
    const { ledger, risk } = make(fakeAi(new Error('connect ECONNREFUSED 127.0.0.1:8000')));
    expect(await risk.assess('tender', REF, 'TENDER_AWARDED')).toBeNull();
    expect(ledger.calls).toHaveLength(0);
    const logged = await db.auditLog.findFirst({ where: { action: 'risk.scoring_failed' } });
    expect(logged.detail.error).toMatch(/ECONNREFUSED/);
  });
});
