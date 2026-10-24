// AI risk scoring of procurement events (Chapter 3, 3.5.7). The back end works out each event's details, asks the
// AI service for a score and explanation, and at the threshold raises an alert on the ledger as the AI service's own
// identity, with the hash of the explanation. A failure here never blocks the procurement action; it is logged.
import crypto from 'node:crypto';
import { reportHash } from './evaluation.js';

const DAY = 86_400_000;
const lusakaWeekday = (d) => (new Date(new Date(d).getTime() + 2 * 3_600_000).getUTCDay() + 6) % 7; // 0 = Monday, Lusaka time
const sameMonth = (a, b) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

/** Client for the AI service (ai/service/app.py). */
export function aiClient({ url, fetchImpl = fetch }) {
  return {
    async explain(kind, features) {
      const res = await fetchImpl(`${url}/explain`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, features }), signal: AbortSignal.timeout(15_000) });
      const body = await res.json();
      if (!res.ok) throw new Error(`AI service returned ${res.status}: ${JSON.stringify(body.detail ?? body)}`);
      return body;
    },
  };
}

export function createRisk({ db, ledger, ai, auth, aiIdentity, officerIdentity }) {
  /** The details of an awarded tender, in the form the model was trained on. */
  async function tenderFeatures(reference) {
    const t = await db.tender.findUnique({ where: { reference },
      include: { bids: true, contract: true, publishedBy: true } });
    const onLedger = await ledger.evaluate(officerIdentity, 'TenderContract:ReadTender', reference);
    const c = t.contract;
    const entityId = t.publishedBy.entityId;
    // The buyer's awards: contracts on tenders published by officers of the same procuring entity
    const buyerContracts = await db.contract.findMany({ where: { tender: { publishedBy: { entityId } } } });
    const supplierWins = c ? await db.contract.count({ where: { supplierRef: c.supplierRef } }) : 0;
    const withSupplier = c ? buyerContracts.filter((x) => x.supplierRef === c.supplierRef) : [];
    return {
      est_value: onLedger.estValue / 100,
      n_bidders: t.bids.length,
      period_days: Math.max(0, Math.round((t.closingTime - t.createdAt) / DAY)),
      end_weekday: lusakaWeekday(t.closingTime),
      award_value: c ? Number(c.amountNgwee) / 100 : null,
      decision_days: c ? Math.max(0, Math.round((c.awardedAt - t.closingTime) / DAY)) : null,
      buyer_n_awards: buyerContracts.length,
      supplier_wins: supplierWins,
      buyer_supplier_share: c && buyerContracts.length ? withSupplier.length / buyerContracts.length : null,
      pair_awards_same_month: c ? withSupplier.filter((x) => sameMonth(x.awardedAt, c.awardedAt)).length : 0,
      method: 'open',
      category: 'unknown',
      bidders: t.bids.map((b) => b.supplierRef),
      winner: c?.supplierRef ?? null,
    };
  }

  /** The state of a contract's milestones and payments, from the ledger. */
  async function contractFeatures(awardId) {
    const [award, milestones] = await Promise.all([
      ledger.evaluate(officerIdentity, 'AwardContract:ReadAward', awardId),
      ledger.evaluate(officerIdentity, 'MilestoneContract:GetMilestones', awardId),
    ]);
    const done = milestones.filter((m) => m.status === 'COMPLETED');
    const late = done.map((m) => Math.max(0, (new Date(m.completionDate || m.completedAt) - new Date(m.dueDate)) / DAY));
    return {
      contract_value: award.contractValue / 100,
      n_milestones: Math.max(1, milestones.length),
      milestones_completed: done.length,
      paid_ratio: award.contractValue ? award.paidTotal / award.contractValue : 0,
      payments_before_completion: 0, // the ledger refuses these outright (3.5.6)
      duplicate_payments: 0,         // likewise
      avg_days_late: late.length ? late.reduce((a, b) => a + b, 0) / late.length : 0,
      variation_recorded: award.variations > 0,
    };
  }

  /**
   * Scores one event. At the threshold, raises an alert on the ledger (as the AI service) unless the subject already
   * has one from this model version that is still open. Returns the result, or null if scoring failed.
   */
  async function assess(kind, subjectId, event) {
    try {
      const features = kind === 'tender' ? await tenderFeatures(subjectId) : await contractFeatures(subjectId);
      const result = await ai.explain(kind, features);
      await auth.audit(null, 'risk.scored', { kind, subjectId, event, score: result.score, modelVersion: result.modelVersion }, null);
      if (!result.alert) return { ...result, raised: false };

      const existing = await db.riskAlert.findFirst({ where: { subjectId, modelVersion: result.modelVersion } });
      if (existing) return { ...result, raised: false, alertId: existing.alertId };

      const alertId = `ALT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const explanation = { subjectType: kind, subjectId, event, score: result.score, modelVersion: result.modelVersion,
        components: result.components, reasons: result.reasons, features };
      const explanationHash = reportHash(explanation);
      const tx = await ledger.submit(aiIdentity, 'AlertContract:RaiseAlert', alertId, kind, subjectId, result.score,
        result.modelVersion, explanationHash);
      await db.riskAlert.create({ data: { alertId, subjectType: kind, subjectId, event, score: result.score,
        modelVersion: result.modelVersion, explanation, explanationHash, txId: tx.txId } });
      await auth.audit(null, 'risk.alert_raised', { alertId, kind, subjectId, score: result.score, txId: tx.txId }, null);
      return { ...result, raised: true, alertId, txId: tx.txId };
    } catch (err) {
      await auth.audit(null, 'risk.scoring_failed', { kind, subjectId, event, error: err.message }, null).catch(() => {});
      return null;
    }
  }

  return { assess, tenderFeatures, contractFeatures };
}
