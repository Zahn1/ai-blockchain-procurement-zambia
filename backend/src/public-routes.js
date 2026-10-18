// Chapter 3, 3.5.9 Public Verification Portal and Open Data. No sign-in.
//   - search tenders, contracts and payments
//   - check that any published record matches its hash on the ledger
//   - download open data in OCDS, including amendments, milestones and payments
//   - bid contents and personal data are never shown: companies appear, people do not
import express from 'express';
import multer from 'multer';
import { AuthError } from './auth.js';
import { sha256 } from './sealed.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const fail = (status, message) => new AuthError(status, message);
export const OCID_PREFIX = 'ocds-zmproc'; // prototype prefix; ZPPA's live data uses its own (ocds-23g63a)
const ocid = (reference) => `${OCID_PREFIX}-${reference.replace(/\//g, '-')}`;
const kwacha = (ngwee) => ({ amount: Number(ngwee) / 100, currency: 'ZMW' });

export function publicRoutes({ db, ledger, officerIdentity, publisherName = 'ZPPA Transparent Procurement prototype' }) {
  const r = express.Router();
  const ev = (fn, ...args) => ledger.evaluate(officerIdentity, fn, ...args);
  const tenderInclude = { publishedBy: { include: { entity: true } }, bids: true,
    contract: { include: { milestones: true } } };

  async function supplierName(pacraNumber) {
    return (await db.supplier.findUnique({ where: { pacraNumber } }))?.companyName ?? null;
  }

  // Search tenders, contracts and payments by reference, title, company or IFMIS reference
  r.get('/public/search', wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const like = q ? { contains: q, mode: 'insensitive' } : undefined;
    // A company matches the contracts and payments it was awarded, not every tender it bid on
    const refs = q ? (await db.supplier.findMany({ where: { companyName: like } })).map((x) => x.supplierRef) : [];
    const [tenders, contracts, payments] = await Promise.all([
      db.tender.findMany({ where: q ? { OR: [{ reference: like }, { title: like }] } : {}, orderBy: { createdAt: 'desc' }, take: 50,
        include: { publishedBy: { include: { entity: true } }, contract: true } }),
      db.contract.findMany({ where: q ? { OR: [{ awardId: like }, { tenderRef: like }, { tender: { title: like } },
        { supplierRef: like }, { supplierRef: { in: refs } }] } : {},
      orderBy: { createdAt: 'desc' }, take: 50, include: { tender: true, milestones: true } }),
      db.milestone.findMany({ where: { paymentStatus: 'PAID', ...(q ? { OR: [{ ifmisRef: like }, { awardId: like },
        { contract: { tenderRef: like } }, { contract: { tender: { title: like } } }, { contract: { supplierRef: { in: refs } } }] } : {}) },
      orderBy: { paidAt: 'desc' }, take: 50, include: { contract: { include: { tender: true } } } }),
    ]);
    const companies = new Map();
    for (const c of contracts) {
      const bid = await db.bid.findUnique({ where: { bidId: c.bidId } });
      companies.set(c.awardId, bid ? await supplierName(bid.supplierId) : null);
    }
    res.json({
      tenders: tenders.map((t) => ({ reference: t.reference, title: t.title, buyer: t.publishedBy.entity?.name ?? null,
        closingTime: t.closingTime, awarded: !!t.contract })),
      contracts: contracts.map((c) => ({ awardId: c.awardId, tenderRef: c.tenderRef, title: c.tender.title,
        supplier: companies.get(c.awardId), value: Number(c.amountNgwee), status: c.status, signedAt: c.signedAt,
        milestones: c.milestones.length, paid: c.milestones.filter((m) => m.paymentStatus === 'PAID').length })),
      payments: payments.map((m) => ({ awardId: m.awardId, tenderRef: m.contract.tenderRef, title: m.contract.tender.title,
        milestoneId: m.milestoneId, description: m.description, amount: Number(m.amountNgwee), paidAt: m.paidAt, ifmisRef: m.ifmisRef })),
    });
  }));

  // Check a published record against its hash on the ledger: a tender document, a signed contract, or a
  // completion certificate. The file is hashed here and compared; nothing is stored.
  r.post('/public/verify', upload.single('document'), wrap(async (req, res) => {
    if (!req.file) throw fail(400, 'Attach the document to check.');
    const kind = String(req.body.kind ?? 'tender');
    const hash = sha256(req.file.buffer);
    let onLedger;
    let label;
    if (kind === 'tender') {
      const t = await ev('TenderContract:ReadTender', String(req.body.reference ?? ''));
      onLedger = t.docHashes;
      label = `tender ${t.id} (version ${t.version})`;
    } else if (kind === 'contract') {
      const a = await ev('AwardContract:ReadAward', String(req.body.awardId ?? ''));
      if (!a.contractHash) throw fail(409, 'This contract has not been signed yet.');
      onLedger = [a.contractHash];
      label = `signed contract ${a.id}`;
    } else if (kind === 'certificate') {
      const ms = await ev('MilestoneContract:GetMilestones', String(req.body.awardId ?? ''));
      const m = ms.find((x) => x.id === req.body.milestoneId);
      if (!m?.evidenceHash) throw fail(409, 'That milestone has no completion certificate on the ledger.');
      onLedger = [m.evidenceHash];
      label = `completion certificate for ${req.body.awardId} ${m.id}`;
    } else {
      throw fail(400, 'Choose what to check: tender, contract or certificate.');
    }
    res.json({ kind, record: label, hash, onLedger, matches: onLedger.includes(hash) });
  }));

  /** One procurement as an OCDS 1.1 compiled release, built from the ledger plus public off-chain details. */
  async function release(t) {
    const history = await ev('TenderContract:GetTenderHistory', t.reference);
    const now = history.at(-1).tender;
    const buyerName = t.publishedBy.entity?.name ?? 'Procuring entity';
    const buyerId = `ZM-ENTITY-${t.publishedBy.entity?.code ?? 'UNKNOWN'}`;
    const parties = [{ id: buyerId, name: buyerName, roles: ['buyer', 'procuringEntity'] }];
    const amendments = [];
    for (let i = 1; i < history.length; i += 1) {
      const [before, after] = [history[i - 1].tender, history[i].tender];
      if (after.version > before.version && after.status === before.status) {
        amendments.push({ id: `${t.reference}-v${after.version}`, date: history[i].timestamp,
          rationale: after.closingTime !== before.closingTime ? `Closing time extended to ${after.closingTime}` : 'Addendum issued',
          description: `${after.docHashes.length - before.docHashes.length} document(s) added` });
      }
    }
    const tenderStatus = { PUBLISHED: 'active', AWARDED: 'complete', CANCELLED: 'cancelled' }[now.status] ?? 'active';
    const ocdsRelease = {
      ocid: ocid(t.reference), id: `${ocid(t.reference)}-${history.at(-1).txId.slice(0, 12)}`, date: history.at(-1).timestamp,
      tag: ['compiled'], initiationType: 'tender', language: 'en',
      parties, buyer: { id: buyerId, name: buyerName },
      tender: {
        id: t.reference, title: t.title, status: tenderStatus, value: kwacha(now.estValue),
        tenderPeriod: { startDate: history[0].timestamp, endDate: now.closingTime },
        numberOfTenderers: t.bids.length,
        documents: now.docHashes.map((h, i) => ({ id: `${t.reference}-doc-${i + 1}`, documentType: i === 0 ? 'tenderNotice' : 'clarifications',
          title: i === 0 ? t.fileName : `Addendum ${i}`, format: 'application/octet-stream',
          url: i === 0 ? `ipfs://${t.cid}` : undefined, hash: { scheme: 'SHA-256', value: h } })),
        amendments,
      },
    };
    const c = t.contract;
    if (c) {
      const award = await ev('AwardContract:ReadAward', c.awardId);
      const bid = t.bids.find((b) => b.bidId === c.bidId);
      const company = bid ? await supplierName(bid.supplierId) : null;
      const supplierId = bid ? `ZM-PACRA-${bid.supplierId}` : c.supplierRef;
      parties.push({ id: supplierId, name: company ?? c.supplierRef, roles: ['supplier', 'payee'] });
      ocdsRelease.awards = [{ id: c.awardId, status: 'active', date: award.awardedAt, value: kwacha(award.amount),
        suppliers: [{ id: supplierId, name: company ?? c.supplierRef }] }];
      const milestones = await ev('MilestoneContract:GetMilestones', c.awardId);
      const transactions = [];
      for (const m of milestones) {
        for (const pid of m.paymentIds) {
          const p = await ev('MilestoneContract:ReadPayment', pid);
          transactions.push({ id: p.id, source: 'IFMIS', date: p.paidAt, value: kwacha(p.amount),
            payer: { id: buyerId, name: buyerName }, payee: { id: supplierId, name: company ?? c.supplierRef },
            uri: `ifmis:${p.ifmisRef}`, relatedMilestone: m.id });
        }
      }
      const describe = (id) => c.milestones.find((x) => x.milestoneId === id)?.description ?? id;
      ocdsRelease.contracts = [{
        id: c.awardId, awardID: c.awardId, status: award.status === 'SIGNED' ? 'active' : 'pending',
        value: kwacha(award.contractValue), dateSigned: award.signedAt || undefined,
        documents: award.contractHash ? [{ id: `${c.awardId}-contract`, documentType: 'contractSigned', title: 'Signed contract',
          hash: { scheme: 'SHA-256', value: award.contractHash } }] : [],
        milestones: milestones.map((m) => ({ id: m.id, title: describe(m.id), type: 'delivery', dueDate: m.dueDate,
          status: m.status === 'COMPLETED' ? 'met' : 'scheduled', dateMet: m.completedAt || undefined, value: kwacha(m.amount),
          documents: m.evidenceHash ? [{ id: `${c.awardId}-${m.id}-certificate`, documentType: 'completionCertificate',
            hash: { scheme: 'SHA-256', value: m.evidenceHash } }] : [] })),
        implementation: { transactions },
      }];
    }
    return ocdsRelease;
  }

  const releasePackage = (releases) => ({
    uri: '/api/public/ocds', version: '1.1', publishedDate: new Date().toISOString(),
    publisher: { name: publisherName },
    license: 'https://creativecommons.org/licenses/by/4.0/',
    publicationPolicy: 'Built from the permissioned ledger; bid contents and personal data are not published.',
    releases,
  });

  // OCDS download: one procurement (?reference=) or all of them
  r.get('/public/ocds', wrap(async (req, res) => {
    const where = req.query.reference ? { reference: String(req.query.reference) } : {};
    const tenders = await db.tender.findMany({ where, include: tenderInclude, orderBy: { createdAt: 'asc' } });
    if (req.query.reference && !tenders.length) throw fail(404, 'Tender not found.');
    const pkg = releasePackage(await Promise.all(tenders.map(release)));
    const name = req.query.reference ? `${ocid(String(req.query.reference))}.json` : 'procurement-ocds.json';
    res.type('application/json').attachment(name).send(JSON.stringify(pkg, null, 2));
  }));

  return r;
}

/** Files the public may fetch from IPFS: tender documents, and bids only as the encrypted files. */
export async function publicCid(db, cid) {
  const [tender, bid] = await Promise.all([db.tender.findFirst({ where: { cid } }), db.bid.findFirst({ where: { cid } })]);
  return !!(tender || bid);
}
