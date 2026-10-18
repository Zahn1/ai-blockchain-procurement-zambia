// Chapter 3, 3.5.6 Smart Contract Award and Milestone Payment.
//   - on award, the smart contract encodes the contract milestones, amounts and payment schedule
//   - an authorised inspector uploads a signed completion certificate, which the contract checks against the terms
//   - if valid and not flagged as high risk, a payment instruction goes to IFMIS
//   - the IFMIS payment reference is recorded on the ledger
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { AuthError } from './auth.js';
import { sha256 } from './sealed.js';
import { endOfDayInZambia } from './registries.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const fail = (status, message) => new AuthError(status, message);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z'); // RFC 3339, as the chaincode expects
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MILESTONES = 12;

const milestoneView = (m) => ({
  milestoneId: m.milestoneId, description: m.description, amountNgwee: Number(m.amountNgwee), dueDate: m.dueDate,
  certificateFileName: m.certificateFileName, certificateHash: m.certificateHash, completionDate: m.completionDate,
  certifiedBy: m.certifiedBy?.name ?? null, certifyTxId: m.certifyTxId,
  paymentStatus: m.paymentStatus, paymentNote: m.paymentNote, paymentId: m.paymentId, ifmisRef: m.ifmisRef,
  paymentTxId: m.paymentTxId, paidAt: m.paidAt,
});

const contractView = (c) => ({
  awardId: c.awardId, tenderRef: c.tenderRef, title: c.tender?.title, bidId: c.bidId, supplierRef: c.supplierRef,
  amountNgwee: Number(c.amountNgwee), evalHash: c.evalHash, awardTxId: c.awardTxId, awardedAt: c.awardedAt,
  standstillEnds: c.standstillEnds, status: c.status, contractFileName: c.contractFileName, contractHash: c.contractHash,
  signTxId: c.signTxId, signedAt: c.signedAt, inspector: c.inspector ? { id: c.inspector.id, name: c.inspector.name } : null,
  milestones: (c.milestones ?? []).sort((a, b) => a.milestoneId.localeCompare(b.milestoneId, 'en', { numeric: true })).map(milestoneView),
});

export function contractRoutes({ db, auth, ledger, ipfs, ifmis, notifier, officerIdentity, now = () => new Date() }) {
  const r = express.Router();
  const officer = [auth.requireAuth, auth.requireRole('OFFICER')];
  const inspector = [auth.requireAuth, auth.requireRole('INSPECTOR')];
  const staff = [auth.requireAuth, auth.requireRole('OFFICER', 'INSPECTOR')];
  const include = { tender: true, inspector: true, milestones: { include: { certifiedBy: true } } };

  async function loadContract(awardId) {
    const c = await db.contract.findUnique({ where: { awardId: String(awardId ?? '') }, include });
    if (!c) throw fail(404, 'Contract not found.');
    return c;
  }

  function mayView(user, c) {
    if (user.role === 'INSPECTOR' && c.inspectorId !== user.id) throw fail(403, 'You are not the inspector for this contract.');
  }

  /**
   * Pays a certified milestone: ask the ledger whether it is payable (certified, within the terms, not flagged as
   * high risk); if so send the instruction to IFMIS and record its reference on the ledger. Otherwise hold it.
   */
  async function payMilestone(c, m, actor, ip) {
    const amount = Number(m.amountNgwee);
    const paymentId = `PAY-${c.awardId}-${m.milestoneId}`;
    const where = { awardId_milestoneId: { awardId: c.awardId, milestoneId: m.milestoneId } };
    const check = await ledger.evaluate(officerIdentity, 'MilestoneContract:CheckPayable', c.awardId, m.milestoneId, amount);
    if (!check.payable) {
      await db.milestone.update({ where, data: { paymentStatus: 'HELD', paymentNote: check.reason } });
      await auth.audit(actor.id, 'payment.held', { awardId: c.awardId, milestoneId: m.milestoneId, reason: check.reason }, ip);
      return { status: 'HELD', reason: check.reason };
    }
    const instruction = await ifmis.instruct({ paymentId, contractRef: c.awardId, milestoneRef: m.milestoneId,
      amountNgwee: amount, payeeRef: c.supplierRef });
    try {
      const tx = await ledger.submit(officerIdentity, 'MilestoneContract:RecordPayment', c.awardId, m.milestoneId,
        paymentId, amount, instruction.ifmisRef);
      await db.milestone.update({ where, data: { paymentStatus: 'PAID', paymentNote: null, paymentId,
        ifmisRef: instruction.ifmisRef, paymentTxId: tx.txId, paidAt: now() } });
      await auth.audit(actor.id, 'payment.recorded', { awardId: c.awardId, milestoneId: m.milestoneId, ifmisRef: instruction.ifmisRef, txId: tx.txId }, ip);
      notifier?.paymentMade(c, m, instruction.ifmisRef);
      return { status: 'PAID', ifmisRef: instruction.ifmisRef, txId: tx.txId };
    } catch (err) {
      // Very unlikely after CheckPayable; IFMIS keeps the same reference for this payment ID if it is retried
      const note = `IFMIS issued ${instruction.ifmisRef}, but the ledger refused to record it: ${err.message}`;
      await db.milestone.update({ where, data: { paymentStatus: 'HELD', paymentNote: note, paymentId, ifmisRef: instruction.ifmisRef } });
      await auth.audit(actor.id, 'payment.record_failed', { awardId: c.awardId, milestoneId: m.milestoneId, note }, ip);
      return { status: 'HELD', reason: note };
    }
  }

  // Tenders with a committee recommendation and no contract yet
  r.get('/contracts/awardable', officer, wrap(async (_req, res) => {
    const tenders = await db.tender.findMany({ where: { recommendation: { isNot: null }, contract: null },
      include: { recommendation: true }, orderBy: { createdAt: 'desc' } });
    res.json(tenders.map((t) => ({ reference: t.reference, title: t.title, bidId: t.recommendation.bidId })));
  }));

  r.get('/contracts/inspectors', officer, wrap(async (_req, res) => {
    const users = await db.user.findMany({ where: { role: 'INSPECTOR', status: 'ACTIVE', fabricIdentity: { not: null } }, orderBy: { name: 'asc' } });
    res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email })));
  }));

  // Award the tender to the committee's recommended bid, with the evaluation report hash (3.5.5) on the ledger
  r.post('/contracts/award', officer, wrap(async (req, res) => {
    const tender = await db.tender.findUnique({ where: { reference: String(req.body.reference ?? '') },
      include: { recommendation: true, contract: true } });
    if (!tender) throw fail(404, 'Tender not found.');
    if (!tender.recommendation) throw fail(409, 'The evaluation committee has not made its recommendation yet.');
    if (tender.contract) throw fail(409, 'This tender has already been awarded.');
    const bid = await db.bid.findUnique({ where: { bidId: tender.recommendation.bidId } });
    const awardId = `AWD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const amount = Number(bid.priceNgwee);
    const tx = await ledger.submit(officerIdentity, 'AwardContract:MakeAward', awardId, tender.reference, bid.bidId,
      amount, tender.recommendation.reportHash);
    const onLedger = await ledger.evaluate(officerIdentity, 'AwardContract:ReadAward', awardId);
    const c = await db.contract.create({ data: {
      awardId, tenderRef: tender.reference, bidId: bid.bidId, supplierRef: bid.supplierRef, amountNgwee: BigInt(amount),
      evalHash: tender.recommendation.reportHash, awardTxId: tx.txId, awardedAt: new Date(onLedger.awardedAt),
      standstillEnds: new Date(onLedger.standstillEnds), status: 'AWARDED',
    }, include });
    await auth.audit(req.user.id, 'contract.awarded', { awardId, tender: tender.reference, bidId: bid.bidId, txId: tx.txId }, req.ip);
    notifier?.contractAwarded(c, tender.title);
    res.status(201).json(contractView(c));
  }));

  // Sign the contract: its hash, its milestones (amounts and due dates: the payment schedule), and its inspector
  r.post('/contracts/sign', officer, upload.single('contract'), wrap(async (req, res) => {
    const c = await loadContract(req.body.awardId);
    if (c.status !== 'AWARDED') throw fail(409, 'This contract is already signed.');
    if (!req.file) throw fail(400, 'Attach the signed contract document.');
    if (now() < c.standstillEnds) throw fail(409, `The standstill period runs until ${c.standstillEnds.toISOString()}.`);

    let items;
    try { items = JSON.parse(req.body.milestones ?? '[]'); } catch { items = null; }
    if (!Array.isArray(items) || !items.length || items.length > MAX_MILESTONES) throw fail(400, `Give between 1 and ${MAX_MILESTONES} milestones.`);
    const milestones = items.map((m, i) => {
      const description = String(m.description ?? '').trim();
      const ngwee = Math.round(Number(m.amountKwacha) * 100);
      if (!description) throw fail(400, `Milestone ${i + 1} needs a description.`);
      if (!(ngwee > 0)) throw fail(400, `Milestone ${i + 1} needs a positive amount.`);
      if (!DATE.test(m.dueDate ?? '') || endOfDayInZambia(m.dueDate) < now()) throw fail(400, `Milestone ${i + 1} needs a due date from today onwards.`);
      return { milestoneId: `MS-${i + 1}`, description, ngwee, due: endOfDayInZambia(m.dueDate) };
    });
    const total = milestones.reduce((s, m) => s + m.ngwee, 0);
    if (total !== Number(c.amountNgwee)) {
      throw fail(400, `The milestones add up to K${(total / 100).toLocaleString('en-GB')}, but the contract is for K${(Number(c.amountNgwee) / 100).toLocaleString('en-GB')}.`);
    }
    const insp = await db.user.findUnique({ where: { id: String(req.body.inspectorId ?? '') } });
    if (!insp || insp.role !== 'INSPECTOR' || insp.status !== 'ACTIVE' || !insp.fabricIdentity) throw fail(400, 'Choose an active inspector.');

    const contractHash = sha256(req.file.buffer);
    const cid = await ipfs.add(req.file.buffer, req.file.originalname);
    const tx = await ledger.submit(officerIdentity, 'AwardContract:SignContract', c.awardId, contractHash);
    for (const m of milestones) {
      await ledger.submit(officerIdentity, 'MilestoneContract:AddMilestone', c.awardId, m.milestoneId, m.ngwee, iso(m.due));
    }
    await db.$transaction([
      db.contract.update({ where: { awardId: c.awardId }, data: { status: 'SIGNED', contractFileName: req.file.originalname,
        contractCid: cid, contractHash, signTxId: tx.txId, signedAt: now(), inspectorId: insp.id } }),
      db.milestone.createMany({ data: milestones.map((m) => ({ awardId: c.awardId, milestoneId: m.milestoneId,
        description: m.description, amountNgwee: BigInt(m.ngwee), dueDate: m.due })) }),
    ]);
    await auth.audit(req.user.id, 'contract.signed', { awardId: c.awardId, contractHash, milestones: milestones.length, inspector: insp.email, txId: tx.txId }, req.ip);
    res.json(contractView(await loadContract(c.awardId)));
  }));

  r.get('/contracts', staff, wrap(async (req, res) => {
    const where = req.user.role === 'INSPECTOR' ? { inspectorId: req.user.id } : {};
    const list = await db.contract.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    res.json(list.map(contractView));
  }));

  // The contract with what the ledger says: its award record and any risk alerts on it or its tender
  r.get('/contracts/detail', staff, wrap(async (req, res) => {
    const c = await loadContract(req.query.awardId);
    mayView(req.user, c);
    const [award, onContract, onTender] = await Promise.all([
      ledger.evaluate(officerIdentity, 'AwardContract:ReadAward', c.awardId),
      ledger.evaluate(officerIdentity, 'AlertContract:GetAlertsForSubject', c.awardId),
      ledger.evaluate(officerIdentity, 'AlertContract:GetAlertsForSubject', c.tenderRef),
    ]);
    res.json({ ...contractView(c), ledger: { status: award.status, contractValue: award.contractValue, paidTotal: award.paidTotal },
      alerts: [...onContract, ...onTender].map((a) => ({ id: a.id, subjectType: a.subjectType, score: a.score, status: a.status, raisedAt: a.raisedAt })) });
  }));

  // The inspector's signed completion certificate, checked on the ledger against the milestone terms,
  // then payment through IFMIS unless the contract is flagged as high risk
  r.post('/contracts/certify', inspector, upload.single('certificate'), wrap(async (req, res) => {
    const c = await loadContract(req.body.awardId);
    mayView(req.user, c);
    const m = c.milestones.find((x) => x.milestoneId === req.body.milestoneId);
    if (!m) throw fail(404, 'Milestone not found.');
    if (m.certifyTxId) throw fail(409, 'This milestone is already certified.');
    if (!req.file) throw fail(400, 'Attach the signed completion certificate.');
    if (!DATE.test(req.body.completionDate ?? '')) throw fail(400, 'Give the completion date on the certificate.');
    // The end of that day in Zambia, but never later than now (the ledger refuses future dates)
    const completion = new Date(Math.min(endOfDayInZambia(req.body.completionDate).getTime(), now().getTime() - 5000));

    const certificateHash = sha256(req.file.buffer);
    const cid = await ipfs.add(req.file.buffer, req.file.originalname);
    const tx = await ledger.submit(req.user.fabricIdentity, 'MilestoneContract:CompleteMilestone', c.awardId, m.milestoneId,
      certificateHash, Number(m.amountNgwee), iso(completion));
    await db.milestone.update({ where: { awardId_milestoneId: { awardId: c.awardId, milestoneId: m.milestoneId } },
      data: { certificateFileName: req.file.originalname, certificateCid: cid, certificateHash, completionDate: completion,
        certifiedById: req.user.id, certifyTxId: tx.txId } });
    await auth.audit(req.user.id, 'milestone.certified', { awardId: c.awardId, milestoneId: m.milestoneId, certificateHash, txId: tx.txId }, req.ip);

    const payment = await payMilestone(c, m, req.user, req.ip);
    res.json({ certifyTxId: tx.txId, certificateHash, payment });
  }));

  // Try a held payment again, e.g. after a regulator clears the alert or decides to monitor it
  r.post('/contracts/pay', officer, wrap(async (req, res) => {
    const c = await loadContract(req.body.awardId);
    const m = c.milestones.find((x) => x.milestoneId === req.body.milestoneId);
    if (!m) throw fail(404, 'Milestone not found.');
    if (!m.certifyTxId) throw fail(409, 'An inspector has not certified this milestone yet.');
    if (m.paymentStatus === 'PAID') throw fail(409, 'This milestone is already paid.');
    res.json(await payMilestone(c, m, req.user, req.ip));
  }));

  return r;
}
