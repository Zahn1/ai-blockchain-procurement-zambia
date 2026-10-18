// HTTP API: sign-in and administration (3.5.1), tender publication (3.5.3) and encrypted bid submission (3.5.4).
// Dependencies are passed in so tests can replace the ledger, IPFS and storage with fakes.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, actors } from './config.js';
import { sha256, encrypt, newKey } from './sealed.js';
import { sign, verify } from './receipt.js';
import { authRoutes } from './auth-routes.js';
import { supplierRoutes, bidBlocker } from './supplier-routes.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const ID = /^[A-Za-z0-9._/-]{3,64}$/;

export function createApp({ ledger, ipfs, store, keys, receiptSigner, db, auth, registries }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(root, 'public')));

  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
  const bad = (res, message) => res.status(400).json({ error: message });
  const officer = [auth.requireAuth, auth.requireRole('OFFICER')];
  const bidder = [auth.requireAuth, auth.requireRole('SUPPLIER')];

  app.use('/api', authRoutes({ db, auth }));
  app.use('/api', supplierRoutes({ db, auth, registries }));

  // 3.5.3: publish a tender. The document goes to IPFS; its SHA-256 hash and the closing time go on the ledger.
  app.post('/api/tenders', officer, upload.single('document'), wrap(async (req, res) => {
    const { reference, title } = req.body;
    const estValue = Math.round(Number(req.body.estValueKwacha) * 100); // ngwee
    const minutes = Number(req.body.closesInMinutes);
    if (!req.file) return bad(res, 'Attach the tender document.');
    if (!ID.test(reference ?? '')) return bad(res, 'Reference must be 3–64 characters: letters, digits, . _ / -');
    if (!(estValue > 0)) return bad(res, 'Estimated value must be a positive amount in kwacha.');
    if (!(minutes >= 1 && minutes <= 60 * 24 * 90)) return bad(res, 'Closing time must be between 1 minute and 90 days from now.');

    const docHash = sha256(req.file.buffer);
    const cid = await ipfs.add(req.file.buffer, req.file.originalname);
    const closingTime = new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const tx = await ledger.submit(actors.officer, 'TenderContract:PublishTender',
      reference, estValue, closingTime, JSON.stringify([docHash]), 2);

    // Title and file name stay off-chain (ledger rule: hashes, IDs, amounts and statuses only)
    const record = { reference, title: title ?? '', fileName: req.file.originalname, docHash, cid,
      closingTime, txId: tx.txId, block: tx.block, publishedAt: new Date().toISOString() };
    await store.addTender(record);
    await auth.audit(req.user.id, 'tender.published', { reference, txId: tx.txId }, req.ip);
    res.status(201).json(record);
  }));

  app.get('/api/tenders', wrap(async (_req, res) => {
    res.json(await store.listTenders());
  }));

  // Ledger view of one tender, with its full version history. IDs contain slashes, so they go in the query string.
  app.get('/api/tender', wrap(async (req, res) => {
    const id = req.query.id;
    if (!ID.test(id ?? '')) return bad(res, 'Give a valid tender reference.');
    const [tender, history, bids] = await Promise.all([
      ledger.evaluate(actors.officer, 'TenderContract:ReadTender', id),
      ledger.evaluate(actors.officer, 'TenderContract:GetTenderHistory', id),
      ledger.evaluate(actors.officer, 'BidContract:GetBidsForTender', id),
    ]);
    res.json({ tender, history, bids, offChain: await store.getTender(id) });
  }));

  // 3.5.3: check a document against the hashes recorded on the ledger for a tender.
  app.post('/api/verify', upload.single('document'), wrap(async (req, res) => {
    const id = req.body.reference;
    if (!req.file) return bad(res, 'Attach the document to check.');
    if (!ID.test(id ?? '')) return bad(res, 'Give a valid tender reference.');
    const tender = await ledger.evaluate(actors.officer, 'TenderContract:ReadTender', id);
    const hash = sha256(req.file.buffer);
    res.json({ reference: id, hash, onLedger: tender.docHashes, matches: tender.docHashes.includes(hash) });
  }));

  // 3.5.4: submit a sealed bid. Encrypted with a fresh AES-256-GCM key, stored on IPFS, hash recorded on the
  // ledger. The chaincode rejects it if the tender has closed. The supplier gets a signed receipt.
  // The code name is the bidder's company's (one per PACRA number), never taken from the form.
  // The company must still be verified and its ZRA tax clearance in date (3.5.2).
  app.post('/api/bids', bidder, upload.single('bid'), wrap(async (req, res) => {
    const { tenderId } = req.body;
    const blocked = bidBlocker(req.user.supplier);
    if (blocked) return res.status(403).json({ error: blocked, source: 'auth' });
    const { supplierRef } = req.user.supplier;
    if (!req.file) return bad(res, 'Attach the bid document.');
    if (!ID.test(tenderId ?? '')) return bad(res, 'Choose a tender.');

    const key = newKey();
    const sealed = encrypt(req.file.buffer, key);
    const cipherHash = sha256(sealed);
    const bidId = `BID-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const cid = await ipfs.add(sealed, `${bidId}.enc`);
    const tx = await ledger.submit(actors.gateway, 'BidContract:SubmitBid', tenderId, bidId, supplierRef, cipherHash);
    await keys.storeBidKey(bidId, key); // only once the ledger has accepted the bid

    const receipt = sign({ bidId, tenderId, supplierRef, cipherHash, cid,
      submittedAt: tx.result.submittedAt, txId: tx.txId, block: tx.block }, ...(await receiptSigner()));
    await store.addBid({ bidId, tenderId, supplierRef, cid, cipherHash, fileName: req.file.originalname });
    await auth.audit(req.user.id, 'bid.submitted', { bidId, tenderId, txId: tx.txId }, req.ip);
    res.status(201).json(receipt);
  }));

  // Anyone can check a receipt's signature.
  app.post('/api/receipts/verify', (req, res) => {
    res.json({ valid: verify(req.body) });
  });

  // Raw IPFS content, to show that a stored bid is unreadable ciphertext.
  app.get('/api/ipfs/:cid', wrap(async (req, res) => {
    if (!/^[a-z0-9]{20,100}$/i.test(req.params.cid)) return bad(res, 'Invalid CID.');
    res.type('application/octet-stream').send(await ipfs.cat(req.params.cid));
  }));

  // Ledger rejections become 409 with the chaincode's reason; sign-in and role errors keep their status.
  app.use((err, _req, res, _next) => {
    if (err.name === 'AuthError' || err.constructor?.name === 'AuthError') {
      return res.status(err.status).json({ error: err.message, source: 'auth' });
    }
    if (err.name === 'LedgerError' || err.constructor?.name === 'LedgerError') {
      return res.status(409).json({ error: err.message, source: 'ledger' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. See the server log.' });
  });

  return app;
}
