// Chapter 3, 3.5.5 Bid Opening and Evaluation.
//   - bids open only after the closing time and with the digital signatures of the required committee members
//   - on opening, each bid is checked against its recorded hash
//   - technical and financial scores are recorded
//   - a written justification is required when the committee departs from the recommended award
import express from 'express';
import { AuthError } from './auth.js';
import { sha256, decrypt } from './sealed.js';
import { rankBids, reportHash, MIN_JUSTIFICATION } from './evaluation.js';
import { tenderKeyPair, wrapKey, unwrapKey, splitKey, parseShare, shareHash, combineShares } from './shamir.js';

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const fail = (status, message) => new AuthError(status, message);

export function evaluationRoutes({ db, auth, ledger, ipfs, keys, officerIdentity, shamirOpening = false, now = () => new Date() }) {
  const r = express.Router();
  const staff = [auth.requireAuth, auth.requireRole('OFFICER', 'COMMITTEE')];
  const committee = [auth.requireAuth, auth.requireRole('COMMITTEE')];
  const officer = [auth.requireAuth, auth.requireRole('OFFICER')];

  // The ledger identity that signs for this user: committee members sign as themselves
  const identityOf = (user) => (user.role === 'COMMITTEE' ? user.fabricIdentity : officerIdentity);

  async function loadTender(reference) {
    const tender = await db.tender.findUnique({ where: { reference: String(reference ?? '') },
      include: { committee: { include: { user: true } }, recommendation: true } });
    if (!tender) throw fail(404, 'Tender not found.');
    return tender;
  }

  /** Officers of the publishing side, and the members appointed to this tender. */
  function mayView(user, tender) {
    if (user.role === 'OFFICER') return;
    if (!tender.committee.some((m) => m.userId === user.id)) throw fail(403, 'You are not on the evaluation committee for this tender.');
  }

  function notDecided(tender) {
    if (tender.recommendation) throw fail(409, 'The committee has already made its recommendation; the evaluation is closed.');
  }

  async function loadOpenedBid(bidId, user) {
    const bid = await db.bid.findUnique({ where: { bidId: String(bidId ?? '') } });
    if (!bid) throw fail(404, 'Bid not found.');
    const tender = await loadTender(bid.tenderRef);
    mayView(user, tender);
    if (bid.integrity !== 'MATCH') throw fail(409, 'This bid has not been opened.');
    return { bid, tender };
  }

  // Committee members an officer can appoint
  r.get('/evaluation/candidates', officer, wrap(async (_req, res) => {
    const users = await db.user.findMany({ where: { role: 'COMMITTEE', status: 'ACTIVE', fabricIdentity: { not: null } },
      orderBy: { name: 'asc' } });
    res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email })));
  }));

  // The officer appoints the committee, before any member has approved opening
  r.post('/evaluation/committee', officer, wrap(async (req, res) => {
    const tender = await loadTender(req.body.reference);
    if (tender.committee.some((m) => m.approvedAt)) throw fail(409, 'Members have already approved opening; the committee can no longer change.');
    if (tender.openingMode === 'SHAMIR') throw fail(409, 'The opening key is already split among this committee, so it can no longer change.');
    const ids = [...new Set(req.body.memberIds ?? [])];
    const onLedger = await ledger.evaluate(officerIdentity, 'TenderContract:ReadTender', tender.reference);
    if (ids.length < onLedger.quorum) throw fail(400, `Appoint at least ${onLedger.quorum} committee members.`);
    const members = await db.user.findMany({ where: { id: { in: ids }, role: 'COMMITTEE', status: 'ACTIVE', fabricIdentity: { not: null } } });
    if (members.length !== ids.length) throw fail(400, 'Every member must be an active evaluation committee user.');
    if (!shamirOpening) {
      await db.$transaction([
        db.committeeMember.deleteMany({ where: { tenderRef: tender.reference } }),
        db.committeeMember.createMany({ data: ids.map((userId) => ({ tenderRef: tender.reference, userId })) }),
      ]);
    } else {
      // FR-BID-07: a key pair for this tender; bids already in are re-wrapped for it; the private key is split into one
      // share per member (any quorum rebuild it) and then exists nowhere else
      const pair = tenderKeyPair();
      const shares = await splitKey(pair.privateKey, ids.length, onLedger.quorum, tender.reference);
      pair.privateKey.fill(0);
      const bids = await db.bid.findMany({ where: { tenderRef: tender.reference } });
      const wrapped = await Promise.all(bids.map(async (b) => [b.bidId, wrapKey(await keys.loadBidKey(b.bidId), pair.publicKey)]));
      const sealed = await Promise.all(shares.map((s) => keys.sealWithMaster(s)));
      await db.$transaction([
        db.committeeMember.deleteMany({ where: { tenderRef: tender.reference } }),
        db.committeeMember.createMany({ data: ids.map((userId, i) => ({ tenderRef: tender.reference, userId,
          shareIndex: i + 1, shareHash: shareHash(shares[i]), shareSealed: sealed[i] })) }),
        db.tender.update({ where: { reference: tender.reference }, data: { openingMode: 'SHAMIR', openingPublicKey: pair.publicKey } }),
        ...wrapped.map(([bidId, w]) => db.bid.update({ where: { bidId }, data: { wrappedKey: w } })),
      ]);
      for (const [bidId] of wrapped) await keys.deleteBidKey(bidId);
    }
    await auth.audit(req.user.id, 'committee.appointed', { tender: tender.reference, members: members.map((m) => m.email),
      keySplit: shamirOpening ? `${onLedger.quorum} of ${ids.length}` : null }, req.ip);
    res.json({ appointed: members.map((m) => m.name), keySplit: shamirOpening ? { threshold: onLedger.quorum, shares: ids.length } : null });
  }));

  // FR-BID-07: a member collects their key share, once; after that the back end no longer holds it
  r.get('/evaluation/share', committee, wrap(async (req, res) => {
    const tender = await loadTender(req.query.reference);
    mayView(req.user, tender);
    if (tender.openingMode !== 'SHAMIR') throw fail(404, 'This tender\'s opening key is not split among the committee.');
    const m = tender.committee.find((x) => x.userId === req.user.id);
    if (!m.shareSealed) throw fail(409, `You collected your key share on ${m.shareDownloadedAt?.toISOString() ?? 'an earlier date'}. Keep it safe: it cannot be issued again.`);
    const share = (await keys.unsealWithMaster(m.shareSealed)).toString();
    await db.committeeMember.update({ where: { tenderRef_userId: { tenderRef: tender.reference, userId: req.user.id } },
      data: { shareSealed: null, shareDownloadedAt: now() } });
    await auth.audit(req.user.id, 'share.collected', { tender: tender.reference, shareIndex: m.shareIndex }, req.ip);
    res.json({ share, index: m.shareIndex, of: tender.committee.length });
  }));

  // FR-BID-07: at opening, a member who has approved hands back their share; it is checked against its recorded hash
  r.post('/evaluation/share', committee, wrap(async (req, res) => {
    const tender = await loadTender(req.body.reference);
    mayView(req.user, tender);
    if (tender.openingMode !== 'SHAMIR') throw fail(404, 'This tender\'s opening key is not split among the committee.');
    const m = tender.committee.find((x) => x.userId === req.user.id);
    if (!m.approvedAt) throw fail(409, 'Approve opening on the ledger first, then provide your key share.');
    let parsed;
    try { parsed = parseShare(req.body.share); } catch (err) { throw fail(400, err.message); }
    if (parsed.reference !== tender.reference || shareHash(req.body.share) !== m.shareHash) {
      throw fail(400, 'That is not your key share for this tender.');
    }
    await db.committeeMember.update({ where: { tenderRef_userId: { tenderRef: tender.reference, userId: req.user.id } },
      data: { sharePending: await keys.sealWithMaster(String(req.body.share).trim()) } });
    await auth.audit(req.user.id, 'share.provided', { tender: tender.reference, shareIndex: m.shareIndex }, req.ip);
    const { quorum } = await ledger.evaluate(officerIdentity, 'TenderContract:ReadTender', tender.reference);
    res.json({ provided: tender.committee.filter((x) => x.sharePending || x.userId === req.user.id).length, needed: quorum });
  }));

  // The tenders to evaluate: every tender for an officer, only those a member is appointed to for the committee
  r.get('/evaluation/tenders', staff, wrap(async (req, res) => {
    const mine = req.user.role === 'COMMITTEE';
    const tenders = await db.tender.findMany({ where: mine ? { committee: { some: { userId: req.user.id } } } : {},
      include: { committee: true, recommendation: true, contract: true, bids: true }, orderBy: { closingTime: 'desc' } });
    res.json(tenders.map((t) => ({
      reference: t.reference, title: t.title, closingTime: t.closingTime, closed: now() >= t.closingTime,
      committee: t.committee.length, approvals: t.committee.filter((m) => m.approvedAt).length,
      approvedByMe: mine ? !!t.committee.find((m) => m.userId === req.user.id)?.approvedAt : null,
      bids: t.bids.length, opened: t.bids.filter((b) => b.integrity !== null).length,
      recommended: !!t.recommendation, awarded: !!t.contract,
    })));
  }));

  // Everything the officer or a member needs to see
  r.get('/evaluation', staff, wrap(async (req, res) => {
    const tender = await loadTender(req.query.reference);
    mayView(req.user, tender);
    const [onLedger, ledgerBids, bids] = await Promise.all([
      ledger.evaluate(officerIdentity, 'TenderContract:ReadTender', tender.reference),
      ledger.evaluate(officerIdentity, 'BidContract:GetBidsForTender', tender.reference),
      db.bid.findMany({ where: { tenderRef: tender.reference }, include: { scores: { include: { user: true } } }, orderBy: { submittedAt: 'asc' } }),
    ]);
    const members = tender.committee.map((m) => m.userId);
    const ranking = rankBids(bids.filter((b) => b.integrity === 'MATCH').map((b) => ({
      bidId: b.bidId, supplierRef: b.supplierRef, priceNgwee: b.priceNgwee === null ? null : Number(b.priceNgwee),
      technicalScores: b.scores.filter((s) => members.includes(s.userId)).map((s) => s.technicalScore),
    })), tender);
    res.json({
      reference: tender.reference, title: tender.title,
      closingTime: onLedger.closingTime, closed: now() >= new Date(onLedger.closingTime),
      quorum: onLedger.quorum, openingApproved: onLedger.openingApproved, ledgerStatus: onLedger.status,
      technicalWeight: tender.technicalWeight, passMark: tender.passMark,
      committee: tender.committee.map((m) => ({ id: m.userId, name: m.user.name, approvedAt: m.approvedAt, approvalTxId: m.approvalTxId })),
      me: { id: req.user.id, onCommittee: members.includes(req.user.id) },
      opening: tender.openingMode === 'SHAMIR' ? (() => {
        const mine = tender.committee.find((m) => m.userId === req.user.id);
        return { mode: 'SHAMIR', threshold: onLedger.quorum, shares: tender.committee.length,
          provided: tender.committee.filter((m) => m.sharePending).length,
          collected: tender.committee.filter((m) => m.shareDownloadedAt).length,
          mine: mine ? { index: mine.shareIndex, collectedAt: mine.shareDownloadedAt, provided: !!mine.sharePending } : null };
      })() : { mode: 'SERVER' },
      bids: bids.map((b) => ({
        bidId: b.bidId, supplierRef: b.supplierRef, submittedAt: b.submittedAt, cipherHash: b.cipherHash,
        onLedger: ledgerBids.some((lb) => lb.id === b.bidId),
        integrity: b.integrity, plainHash: b.plainHash, openedAt: b.openedAt,
        priceNgwee: b.priceNgwee === null ? null : Number(b.priceNgwee),
        scoresIn: b.scores.filter((s) => members.includes(s.userId)).length,
        myScore: b.scores.find((s) => s.userId === req.user.id) ?? null,
      })),
      ranking,
      recommendation: tender.recommendation && {
        bidId: tender.recommendation.bidId, recommendedBidId: tender.recommendation.recommendedBidId,
        justification: tender.recommendation.justification, reportHash: tender.recommendation.reportHash,
        createdAt: tender.recommendation.createdAt,
      },
    });
  }));

  // A member approves opening with a ledger transaction signed by their own identity.
  // The chaincode refuses it before the closing time and counts each member once.
  r.post('/evaluation/approve', committee, wrap(async (req, res) => {
    const tender = await loadTender(req.body.reference);
    mayView(req.user, tender);
    const membership = tender.committee.find((m) => m.userId === req.user.id);
    if (membership.approvedAt) throw fail(409, 'You have already approved opening for this tender.');
    const tx = await ledger.submit(identityOf(req.user), 'BidContract:ApproveOpening', tender.reference);
    await db.committeeMember.update({ where: { tenderRef_userId: { tenderRef: tender.reference, userId: req.user.id } },
      data: { approvedAt: now(), approvalTxId: tx.txId } });
    await auth.audit(req.user.id, 'opening.approved', { tender: tender.reference, txId: tx.txId }, req.ip);
    res.json({ txId: tx.txId, block: tx.block });
  }));

  // Open every bid: check the stored file against the ledger hash, decrypt, record the opened file's hash.
  r.post('/evaluation/open', staff, wrap(async (req, res) => {
    const tender = await loadTender(req.body.reference);
    mayView(req.user, tender);
    const onLedger = await ledger.evaluate(officerIdentity, 'TenderContract:ReadTender', tender.reference);
    if (!onLedger.openingApproved) {
      throw fail(409, `Opening needs ${onLedger.quorum} committee approvals on the ledger; it has ${onLedger.approvals.length}.`);
    }
    // FR-BID-07: rebuild the opening key from the quorum's shares, in memory only
    let openingKey = null;
    if (tender.openingMode === 'SHAMIR') {
      const pending = tender.committee.filter((m) => m.sharePending);
      if (pending.length < onLedger.quorum) {
        throw fail(409, `Opening needs ${onLedger.quorum} committee key shares; ${pending.length} provided.`);
      }
      try {
        openingKey = await combineShares(await Promise.all(pending.map(async (m) => (await keys.unsealWithMaster(m.sharePending)).toString())),
          tender.openingPublicKey);
      } catch (err) {
        throw fail(409, err.message);
      }
    }
    const keyFor = async (bid) => (openingKey && bid.wrappedKey ? unwrapKey(bid.wrappedKey, openingKey) : keys.loadBidKey(bid.bidId));
    const ledgerBids = await ledger.evaluate(officerIdentity, 'BidContract:GetBidsForTender', tender.reference);
    const bids = await db.bid.findMany({ where: { tenderRef: tender.reference, integrity: null } });
    const results = [];
    for (const bid of bids) {
      const recorded = ledgerBids.find((lb) => lb.id === bid.bidId);
      let plain = null;
      let reason = null;
      try {
        const sealed = await ipfs.cat(bid.cid);
        if (!recorded) reason = 'The bid is not on the ledger.';
        else if (sha256(sealed) !== recorded.cipherHash) reason = 'The stored file does not match the hash recorded on the ledger.';
        else {
          const key = await keyFor(bid);
          plain = decrypt(sealed, key); // GCM also detects tampering
          if (openingKey) await keys.storeBidKey(bid.bidId, key); // opened: the committee may now read it
        }
      } catch {
        reason = reason ?? 'The stored file could not be decrypted: it has been altered or its key is missing.';
      }
      if (!plain) {
        await db.bid.update({ where: { bidId: bid.bidId }, data: { integrity: 'MISMATCH' } });
        await auth.audit(req.user.id, 'bid.integrity_failed', { bidId: bid.bidId, reason }, req.ip);
        results.push({ bidId: bid.bidId, supplierRef: bid.supplierRef, integrity: 'MISMATCH', reason });
        continue;
      }
      const plainHash = sha256(plain);
      const tx = await ledger.submit(identityOf(req.user), 'BidContract:OpenBid', tender.reference, bid.bidId, plainHash);
      await db.bid.update({ where: { bidId: bid.bidId }, data: { integrity: 'MATCH', plainHash, openedAt: now() } });
      await auth.audit(req.user.id, 'bid.opened', { bidId: bid.bidId, txId: tx.txId }, req.ip);
      results.push({ bidId: bid.bidId, supplierRef: bid.supplierRef, integrity: 'MATCH', plainHash, txId: tx.txId });
    }
    if (openingKey) {
      openingKey.fill(0);
      await db.committeeMember.updateMany({ where: { tenderRef: tender.reference }, data: { sharePending: null } });
    }
    res.json({ results });
  }));

  // The opened bid document, for the committee and officer only. Checked against its recorded hash again.
  r.get('/evaluation/bid-file', staff, wrap(async (req, res) => {
    const { bid } = await loadOpenedBid(req.query.bidId, req.user);
    const plain = decrypt(await ipfs.cat(bid.cid), await keys.loadBidKey(bid.bidId));
    if (sha256(plain) !== bid.plainHash) throw fail(409, 'The opened file no longer matches its recorded hash.');
    await auth.audit(req.user.id, 'bid.viewed', { bidId: bid.bidId }, req.ip);
    res.attachment(bid.fileName).send(plain);
  }));

  // The bid price, read from the opened document (financial score input)
  r.post('/evaluation/price', committee, wrap(async (req, res) => {
    const { bid, tender } = await loadOpenedBid(req.body.bidId, req.user);
    notDecided(tender);
    const ngwee = Math.round(Number(req.body.priceKwacha) * 100);
    if (!(ngwee > 0)) throw fail(400, 'Enter the bid price in kwacha.');
    await db.bid.update({ where: { bidId: bid.bidId }, data: { priceNgwee: BigInt(ngwee) } });
    await auth.audit(req.user.id, 'bid.price_recorded', { bidId: bid.bidId, priceNgwee: ngwee }, req.ip);
    res.json({ bidId: bid.bidId, priceNgwee: ngwee });
  }));

  // Each member's own technical score for a bid, with a comment
  r.post('/evaluation/score', committee, wrap(async (req, res) => {
    const { bid, tender } = await loadOpenedBid(req.body.bidId, req.user);
    notDecided(tender);
    const score = Number(req.body.technicalScore);
    const comment = String(req.body.comment ?? '').trim();
    if (!Number.isInteger(score) || score < 0 || score > 100) throw fail(400, 'The technical score is a whole number from 0 to 100.');
    if (!comment) throw fail(400, 'Add a short comment explaining the score.');
    await db.score.upsert({
      where: { bidId_userId: { bidId: bid.bidId, userId: req.user.id } },
      create: { bidId: bid.bidId, userId: req.user.id, technicalScore: score, comment },
      update: { technicalScore: score, comment },
    });
    await auth.audit(req.user.id, 'bid.scored', { bidId: bid.bidId, technicalScore: score }, req.ip);
    res.json({ bidId: bid.bidId, technicalScore: score });
  }));

  // The committee's recommendation. Departing from the top-ranked bid needs a written justification.
  r.post('/evaluation/recommend', committee, wrap(async (req, res) => {
    const tender = await loadTender(req.body.reference);
    mayView(req.user, tender);
    notDecided(tender);
    const bids = await db.bid.findMany({ where: { tenderRef: tender.reference }, include: { scores: { include: { user: true } } } });
    if (bids.some((b) => b.integrity === null)) throw fail(409, 'Open all the bids first.');
    const opened = bids.filter((b) => b.integrity === 'MATCH');
    const members = tender.committee.map((m) => m.userId);
    for (const b of opened) {
      if (b.priceNgwee === null) throw fail(409, `Record the price for bid ${b.bidId} first.`);
      const missing = tender.committee.filter((m) => !b.scores.some((s) => s.userId === m.userId));
      if (missing.length) throw fail(409, `Bid ${b.bidId} still needs a score from ${missing.map((m) => m.user.name).join(', ')}.`);
    }
    const ranking = rankBids(opened.map((b) => ({
      bidId: b.bidId, supplierRef: b.supplierRef, priceNgwee: Number(b.priceNgwee),
      technicalScores: b.scores.filter((s) => members.includes(s.userId)).map((s) => s.technicalScore),
    })), tender);
    const chosen = ranking.rows.find((row) => row.bidId === req.body.bidId);
    if (!chosen) throw fail(400, 'Choose one of the opened bids.');
    if (!chosen.eligible) throw fail(400, `Bid ${chosen.bidId} is below the technical pass mark of ${tender.passMark}.`);
    const departs = chosen.bidId !== ranking.recommendedBidId;
    const justification = String(req.body.justification ?? '').trim();
    if (departs && justification.length < MIN_JUSTIFICATION) {
      throw fail(400, `This departs from the recommended bid (${ranking.recommendedBidId}). Write a justification of at least ${MIN_JUSTIFICATION} characters.`);
    }

    // The full evaluation as recorded; its hash goes on the ledger with the award (3.5.6)
    const report = {
      tender: tender.reference, method: { technicalWeight: tender.technicalWeight, passMark: tender.passMark },
      committee: tender.committee.map((m) => ({ name: m.user.name, approvalTxId: m.approvalTxId })),
      bids: bids.map((b) => ({
        bidId: b.bidId, supplierRef: b.supplierRef, integrity: b.integrity, plainHash: b.plainHash,
        priceNgwee: b.priceNgwee === null ? null : Number(b.priceNgwee),
        scores: b.scores.filter((s) => members.includes(s.userId))
          .map((s) => ({ member: s.user.name, technical: s.technicalScore, comment: s.comment }))
          .sort((x, y) => x.member.localeCompare(y.member)),
      })),
      ranking: ranking.rows, recommendedBidId: ranking.recommendedBidId,
      decision: { bidId: chosen.bidId, departsFromRecommendation: departs, justification: departs ? justification : null,
        decidedBy: req.user.name, decidedAt: now().toISOString() },
    };
    const hash = reportHash(report);
    await db.recommendation.create({ data: {
      tenderRef: tender.reference, bidId: chosen.bidId, recommendedBidId: ranking.recommendedBidId,
      justification: departs ? justification : null, report, reportHash: hash, decidedById: req.user.id,
    } });
    await auth.audit(req.user.id, 'evaluation.recommended', { tender: tender.reference, bidId: chosen.bidId, departs, reportHash: hash }, req.ip);
    res.status(201).json({ bidId: chosen.bidId, departsFromRecommendation: departs, reportHash: hash });
  }));

  return r;
}
