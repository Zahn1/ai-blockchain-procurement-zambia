// Summary figures for each role's dashboard, and a bidder's own bids (Phase 5 front end).
import express from 'express';

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const DAY = 86_400_000;

export function dashboardRoutes({ db, auth, ledger, officerIdentity, now = () => new Date() }) {
  const r = express.Router();

  r.get('/dashboard', auth.requireAuth, wrap(async (req, res) => {
    const u = req.user;
    const at = now();
    const figures = {
      OFFICER: async () => {
        const [open, awaiting, active, held, contracts] = await Promise.all([
          db.tender.count({ where: { closingTime: { gt: at } } }),
          db.tender.count({ where: { closingTime: { lte: at }, recommendation: null } }),
          db.contract.count({ where: { status: 'SIGNED' } }),
          db.milestone.count({ where: { paymentStatus: 'HELD' } }),
          db.contract.findMany({ select: { amountNgwee: true } }),
        ]);
        return { openTenders: open, awaitingEvaluation: awaiting, activeContracts: active, paymentsHeld: held,
          valueAwardedNgwee: contracts.reduce((s, c) => s + Number(c.amountNgwee), 0) };
      },
      SUPPLIER: async () => {
        const ref = u.supplier?.supplierRef;
        const [open, bids, won, paid] = await Promise.all([
          db.tender.count({ where: { closingTime: { gt: at } } }),
          db.bid.count({ where: { supplierRef: ref } }),
          db.contract.findMany({ where: { supplierRef: ref }, select: { amountNgwee: true } }),
          db.milestone.findMany({ where: { paymentStatus: 'PAID', contract: { supplierRef: ref } }, select: { amountNgwee: true } }),
        ]);
        return { openTenders: open, myBids: bids, contractsWon: won.length,
          valueWonNgwee: won.reduce((s, c) => s + Number(c.amountNgwee), 0),
          paidNgwee: paid.reduce((s, m) => s + Number(m.amountNgwee), 0) };
      },
      COMMITTEE: async () => {
        const mine = await db.committeeMember.findMany({ where: { userId: u.id },
          include: { tender: { include: { recommendation: true, bids: { include: { scores: true } } } } } });
        return {
          tenders: mine.length,
          awaitingMyApproval: mine.filter((m) => !m.approvedAt && m.tender.closingTime <= at).length,
          bidsAwaitingMyScore: mine.filter((m) => !m.tender.recommendation).flatMap((m) => m.tender.bids)
            .filter((b) => b.integrity === 'MATCH' && !b.scores.some((s) => s.userId === u.id)).length,
          recommended: mine.filter((m) => m.tender.recommendation).length,
        };
      },
      INSPECTOR: async () => {
        const [contracts, pending, certified] = await Promise.all([
          db.contract.count({ where: { inspectorId: u.id } }),
          db.milestone.count({ where: { contract: { inspectorId: u.id }, certifyTxId: null } }),
          db.milestone.count({ where: { certifiedById: u.id } }),
        ]);
        return { contracts, awaitingCertificate: pending, certified };
      },
      REGULATOR: async () => {
        const [alerts, held, contracts] = await Promise.all([
          ledger.evaluate(officerIdentity, 'AlertContract:GetAllAlerts'),
          db.milestone.count({ where: { paymentStatus: 'HELD' } }),
          db.contract.findMany({ select: { amountNgwee: true } }),
        ]);
        return { unreviewedAlerts: alerts.filter((a) => a.status === 'OPEN').length,
          highRiskAlerts: alerts.filter((a) => a.score >= 70 && ['OPEN', 'REFERRED'].includes(a.status)).length,
          referred: alerts.filter((a) => a.status === 'REFERRED').length, paymentsHeld: held,
          contractValueNgwee: contracts.reduce((s, c) => s + Number(c.amountNgwee), 0) };
      },
      ADMIN: async () => {
        const [users, suspended, bidders, entities, failed] = await Promise.all([
          db.user.count(), db.user.count({ where: { status: 'SUSPENDED' } }), db.supplier.count(), db.procuringEntity.count(),
          db.auditLog.count({ where: { action: { in: ['login.failed', 'login.lockout'] }, createdAt: { gte: new Date(at - DAY) } } }),
        ]);
        return { users, suspendedUsers: suspended, bidders, procuringEntities: entities, failedSignIns24h: failed };
      },
    }[u.role];
    res.json({ role: u.role, figures: figures ? await figures() : {} });
  }));

  // A bidder's own bids, with where each one stands
  r.get('/bids/mine', auth.requireAuth, auth.requireRole('SUPPLIER'), wrap(async (req, res) => {
    const ref = req.user.supplier?.supplierRef;
    const bids = await db.bid.findMany({ where: { supplierRef: ref }, orderBy: { submittedAt: 'desc' },
      include: { tender: { include: { contract: true } } } });
    res.json(bids.map((b) => ({
      bidId: b.bidId, tenderRef: b.tenderRef, title: b.tender.title, submittedAt: b.submittedAt, txId: b.txId,
      cipherHash: b.cipherHash, closingTime: b.tender.closingTime, opened: b.integrity === 'MATCH',
      outcome: !b.tender.contract ? (b.tender.closingTime > now() ? 'Open' : 'Under evaluation')
        : b.tender.contract.bidId === b.bidId ? 'Won' : 'Not successful',
    })));
  }));

  return r;
}
