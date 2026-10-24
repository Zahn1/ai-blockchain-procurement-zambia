// Chapter 3, 3.5.8 Alert Review and Audit Trail.
//   - regulators review each alert and record a decision (cleared, monitor or refer) with the reason
//   - the hash of that decision is recorded on the ledger
//   - authorised regulators see the complete history of any procurement, from tender publication to final payment
import express from 'express';
import { AuthError } from './auth.js';
import { reportHash } from './evaluation.js';

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const fail = (status, message) => new AuthError(status, message);
export const DECISIONS = ['CLEARED', 'MONITOR', 'REFERRED'];
export const MIN_REASON = 20;

export function oversightRoutes({ db, auth, ledger, officerIdentity, now = () => new Date() }) {
  const r = express.Router();
  const regulator = [auth.requireAuth, auth.requireRole('REGULATOR')];

  // Every alert on the ledger, with the reasons regulators gave; unreviewed and highest scores first
  r.get('/oversight/alerts', regulator, wrap(async (_req, res) => {
    const [alerts, decisions, explanations] = await Promise.all([
      ledger.evaluate(officerIdentity, 'AlertContract:GetAllAlerts'),
      db.alertDecision.findMany({ include: { decidedBy: true }, orderBy: { createdAt: 'asc' } }),
      db.riskAlert.findMany(),
    ]);
    const order = { OPEN: 0, REFERRED: 1, MONITOR: 2, CLEARED: 3 };
    res.json(alerts.map((a) => ({
      ...a,
      // The AI's plain-English reasons (3.5.7), checked against the hash on the ledger
      explanation: (() => {
        const x = explanations.find((e) => e.alertId === a.id);
        return x ? { reasons: x.explanation.reasons, event: x.event, matchesLedger: x.explanationHash === a.explanationHash } : null;
      })(),
      decisions: decisions.filter((d) => d.alertId === a.id).map((d) => ({
        decision: d.decision, reason: d.reason, by: d.decidedBy.name, at: d.createdAt, recordHash: d.recordHash, txId: d.txId })),
    })).sort((x, y) => (order[x.status] - order[y.status]) || (y.score - x.score) || x.id.localeCompare(y.id)));
  }));

  // A decision with its reason. The record's hash goes on the ledger, signed with the regulator's own identity;
  // the chaincode enforces which decisions may follow which.
  r.post('/oversight/alerts/decide', regulator, wrap(async (req, res) => {
    const { alertId, subjectId, decision } = req.body;
    const reason = String(req.body.reason ?? '').trim();
    if (!DECISIONS.includes(decision)) throw fail(400, 'The decision is cleared, monitor or refer.');
    if (reason.length < MIN_REASON) throw fail(400, `Give the reason for the decision (at least ${MIN_REASON} characters).`);
    if (!req.user.fabricIdentity) throw fail(403, 'Your account has no ledger identity. Contact the system administrator.');
    const alerts = await ledger.evaluate(officerIdentity, 'AlertContract:GetAlertsForSubject', String(subjectId ?? ''));
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert) throw fail(404, 'Alert not found.');

    const record = { alertId, subjectId, subjectType: alert.subjectType, score: alert.score, previousStatus: alert.status,
      decision, reason, decidedBy: req.user.email, decidedAt: now().toISOString() };
    const recordHash = reportHash(record);
    const tx = await ledger.submit(req.user.fabricIdentity, 'AlertContract:ReviewAlert', subjectId, alertId, decision, recordHash);
    await db.alertDecision.create({ data: { alertId, subjectId, decision, reason, record, recordHash, decidedById: req.user.id, txId: tx.txId } });
    await auth.audit(req.user.id, 'alert.decided', { alertId, subjectId, decision, recordHash, txId: tx.txId }, req.ip);
    res.status(201).json({ alertId, decision, recordHash, txId: tx.txId });
  }));

  // The complete history of one procurement, built from the ledger (and labelled where a detail is off-chain)
  r.get('/oversight/history', regulator, wrap(async (req, res) => {
    const reference = String(req.query.reference ?? '');
    const tender = await db.tender.findUnique({ where: { reference },
      include: { recommendation: true, contract: true, committee: { include: { user: true } } } });
    if (!tender) throw fail(404, 'Tender not found.');
    const ev = (fn, ...args) => ledger.evaluate(officerIdentity, fn, ...args);
    const events = [];
    const add = (at, what, detail, txId = null, source = 'ledger') => at && events.push({ at, what, detail, txId, source });

    // Tender: every version on the ledger
    const history = await ev('TenderContract:GetTenderHistory', reference);
    let previous = null;
    for (const h of history) {
      const t = h.tender;
      if (!previous) add(h.timestamp, 'Tender published', `Estimated value ${t.estValue} ngwee; closes ${t.closingTime}; document hash ${t.docHashes[0]}`, h.txId);
      else if (t.approvals.length > previous.approvals.length) add(h.timestamp, 'Committee member approved opening', `Approval ${t.approvals.length} of ${t.quorum} (signer ${t.approvals.at(-1).slice(0, 12)}…)`, h.txId);
      else if (t.status !== previous.status) add(h.timestamp, `Tender ${t.status.toLowerCase()}`, '', h.txId);
      else if (t.version > previous.version) add(h.timestamp, 'Tender amended', `Version ${t.version}; closes ${t.closingTime}`, h.txId);
      previous = t;
    }

    // Bids: submission and opening, as recorded on the ledger
    for (const b of await ev('BidContract:GetBidsForTender', reference)) {
      add(b.submittedAt, 'Sealed bid submitted', `${b.id} by ${b.supplierRef}; ciphertext hash ${b.cipherHash}`, b.txId);
      if (b.opened) add(b.openedAt, 'Bid opened', `${b.id}: matched its ledger hash; opened-file hash ${b.plainHash}`);
    }

    if (tender.recommendation) {
      const rec = tender.recommendation;
      add(rec.createdAt.toISOString(), 'Committee recommendation',
        `${rec.bidId}${rec.bidId !== rec.recommendedBidId ? ` (departs from ranking: ${rec.justification})` : ''}; evaluation report hash ${rec.reportHash}`, null, 'off-chain, hash on ledger at award');
    }

    // Award, contract, milestones and payments
    const subjects = [reference];
    if (tender.contract) {
      const c = tender.contract;
      subjects.push(c.awardId);
      const award = await ev('AwardContract:ReadAward', c.awardId);
      add(award.awardedAt, 'Contract awarded', `${c.awardId} to ${award.supplierRef} for ${award.amount} ngwee; evaluation report hash ${award.evalHash}`, c.awardTxId);
      if (award.signedAt) add(award.signedAt, 'Contract signed', `Contract hash ${award.contractHash}`, c.signTxId);
      const ms = await ev('MilestoneContract:GetMilestones', c.awardId);
      const offChain = await db.milestone.findMany({ where: { awardId: c.awardId } });
      for (const m of ms) {
        const local = offChain.find((x) => x.milestoneId === m.id);
        if (m.completedAt) add(m.completedAt, 'Milestone certified complete', `${m.id}: ${m.amount} ngwee; certificate hash ${m.evidenceHash}`, local?.certifyTxId ?? null);
        for (const pid of m.paymentIds) {
          const p = await ev('MilestoneContract:ReadPayment', pid);
          add(p.paidAt, 'Payment made', `${m.id}: ${p.amount} ngwee; IFMIS reference ${p.ifmisRef}`, p.txId);
        }
      }
      if (award.paidTotal >= award.contractValue && award.paidTotal > 0) events.push({ final: true });
    }

    // Alerts and regulators' decisions on the tender or the contract
    const decisions = await db.alertDecision.findMany({ where: { subjectId: { in: subjects } }, include: { decidedBy: true } });
    for (const subject of subjects) {
      for (const a of await ev('AlertContract:GetAlertsForSubject', subject)) {
        add(a.raisedAt, 'Risk alert raised', `${a.id} on ${a.subjectType} ${a.subjectId}: score ${a.score} (model ${a.modelVersion})`);
        for (const d of decisions.filter((x) => x.alertId === a.id)) {
          add(d.createdAt.toISOString(), `Regulator decision: ${d.decision.toLowerCase()}`, `${a.id} by ${d.decidedBy.name}: ${d.reason} (record hash ${d.recordHash})`, d.txId);
        }
      }
    }

    const fullyPaid = events.some((e) => e.final);
    const timeline = events.filter((e) => !e.final).sort((x, y) => new Date(x.at) - new Date(y.at));
    res.json({ reference, title: tender.title, fullyPaid, events: timeline });
  }));

  return r;
}
