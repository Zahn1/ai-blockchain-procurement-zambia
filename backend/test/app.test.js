// Route tests for 3.5.3 (tender publication) and 3.5.4 (encrypted bid submission).
// The ledger, IPFS and storage are in-memory fakes; the real network is exercised by the e2e scenario.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { decrypt, sha256 } from '../src/sealed.js';
import { sign, verify } from '../src/receipt.js';
import { db, resetDb, makeAuth, signedIn } from './helpers.js';

let officer, supplier;
beforeEach(async () => {
  await resetDb();
  officer = await signedIn('OFFICER');
  supplier = await signedIn('SUPPLIER');
});
afterAll(() => db.$disconnect());

class LedgerError extends Error {}

function fakes() {
  const ipfsFiles = new Map();
  const tenders = new Map();
  const calls = [];
  const bidKeys = new Map();
  let block = 0;
  const records = { tenders: [], bids: [] };

  const ledger = {
    async submit(user, fn, ...args) {
      calls.push({ user, fn, args });
      block += 1;
      const txId = `tx${block}`;
      if (fn === 'TenderContract:PublishTender') {
        const [id, estValue, closingTime, docHashes] = args;
        tenders.set(id, { id, estValue, closingTime, docHashes: JSON.parse(docHashes), status: 'PUBLISHED' });
        return { result: null, txId, block };
      }
      if (fn === 'BidContract:SubmitBid') {
        const [tenderId] = args;
        const t = tenders.get(tenderId);
        if (!t) throw new LedgerError(`tender ${tenderId} does not exist`);
        if (new Date() >= new Date(t.closingTime)) throw new LedgerError(`bidding for tender ${tenderId} closed at ${t.closingTime}`);
        return { result: { submittedAt: new Date().toISOString() }, txId, block };
      }
      throw new Error(`unexpected ${fn}`);
    },
    async evaluate(_user, fn, id) {
      const t = tenders.get(id);
      if (!t) throw new LedgerError(`tender ${id} does not exist`);
      if (fn === 'TenderContract:ReadTender') return t;
      if (fn === 'TenderContract:GetTenderHistory') return [{ txId: 'tx1', timestamp: 'now', tender: t }];
      if (fn === 'BidContract:GetBidsForTender') return [];
      throw new Error(`unexpected ${fn}`);
    },
  };
  const ipfs = {
    async add(bytes) { const cid = `bafy${sha256(bytes).slice(0, 40)}`; ipfsFiles.set(cid, Buffer.from(bytes)); return cid; },
    async cat(cid) { return ipfsFiles.get(cid); },
  };
  const store = {
    async addTender(t) { records.tenders.unshift(t); },
    async listTenders() { return records.tenders; },
    async getTender(ref) { return records.tenders.find((t) => t.reference === ref) ?? null; },
    async addBid(b) { records.bids.unshift(b); },
  };
  const keys = { async storeBidKey(id, key) { bidKeys.set(id, key); } };
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cert = selfSigned(privateKey, publicKey);
  const receiptSigner = async () => [privateKey, cert];

  return { app: createApp({ ledger, ipfs, store, keys, receiptSigner, db, auth: makeAuth() }), calls, ipfsFiles, bidKeys, tenders, LedgerError };
}

// The route tests only check that a signature is attached; real certificate checks are in 'Receipt verification'.
function selfSigned(_priv, pub) {
  return pub.export({ type: 'spki', format: 'pem' });
}

const doc = Buffer.from('Tender document: supply of 40 laptops');

async function publish(app, overrides = {}) {
  const fields = { reference: 'ZPPA/TEST/0001', title: 'Laptops', estValueKwacha: '150000', closesInMinutes: '5', ...overrides };
  let req = request(app).post('/api/tenders').set('authorization', officer.header);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('document', doc, 'tender.txt');
}

describe('3.5.3 Tender publication', () => {
  test('stores the document on IPFS and records its hash on the ledger as the officer', async () => {
    const { app, calls, ipfsFiles } = fakes();
    const res = await publish(app);

    expect(res.status).toBe(201);
    expect(res.body.docHash).toBe(sha256(doc));
    expect(ipfsFiles.get(res.body.cid)).toEqual(doc);

    const [call] = calls;
    expect(call.user).toBe('officer1');
    expect(call.fn).toBe('TenderContract:PublishTender');
    expect(call.args[0]).toBe('ZPPA/TEST/0001');
    expect(call.args[1]).toBe(15000000); // kwacha converted to ngwee
    expect(JSON.parse(call.args[3])).toEqual([sha256(doc)]);
  });

  test('keeps the title off the ledger', async () => {
    const { app, calls } = fakes();
    await publish(app, { title: 'Confidential project name' });
    expect(JSON.stringify(calls[0].args)).not.toContain('Confidential project name');
  });

  test.each([
    [{ reference: 'a b' }, 'Reference'],
    [{ estValueKwacha: '0' }, 'positive amount'],
    [{ closesInMinutes: '0' }, 'Closing time'],
  ])('rejects invalid input %j', async (overrides, message) => {
    const { app, calls } = fakes();
    const res = await publish(app, overrides);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
    expect(calls).toHaveLength(0);
  });

  test('requires a document', async () => {
    const { app } = fakes();
    const res = await request(app).post('/api/tenders').set('authorization', officer.header).field('reference', 'ZPPA/TEST/0001')
      .field('estValueKwacha', '1').field('closesInMinutes', '5');
    expect(res.status).toBe(400);
  });

  test('verification detects a changed document', async () => {
    const { app } = fakes();
    await publish(app);
    const same = await request(app).post('/api/verify').field('reference', 'ZPPA/TEST/0001').attach('document', doc, 'a.txt');
    const changed = await request(app).post('/api/verify').field('reference', 'ZPPA/TEST/0001')
      .attach('document', Buffer.from('Tender document: supply of 40 laptops.'), 'b.txt');
    expect(same.body.matches).toBe(true);
    expect(changed.body.matches).toBe(false);
  });
});

describe('3.5.4 Encrypted bid submission', () => {
  const bidFile = Buffer.from('Our price: K138,500');

  async function submitBid(app, tenderId = 'ZPPA/TEST/0001') {
    return request(app).post('/api/bids').set('authorization', supplier.header).field('tenderId', tenderId)
      .attach('bid', bidFile, 'bid.txt');
  }

  test('encrypts the bid, stores only ciphertext on IPFS and records its hash as the gateway', async () => {
    const { app, calls, ipfsFiles, bidKeys } = fakes();
    await publish(app);
    const res = await submitBid(app);

    expect(res.status).toBe(201);
    const stored = ipfsFiles.get(res.body.cid);
    expect(stored.includes(bidFile)).toBe(false); // plaintext is not on IPFS
    expect(res.body.cipherHash).toBe(sha256(stored));
    expect(decrypt(stored, bidKeys.get(res.body.bidId))).toEqual(bidFile); // and the kept key opens it

    const bidCall = calls.find((c) => c.fn === 'BidContract:SubmitBid');
    expect(bidCall.user).toBe('gateway');
    expect(bidCall.args).toEqual(['ZPPA/TEST/0001', res.body.bidId, supplier.supplier.supplierRef, res.body.cipherHash]);
  });

  test('returns a receipt with the ledger transaction and a signature', async () => {
    const { app } = fakes();
    await publish(app);
    const res = await submitBid(app);
    expect(res.body).toMatchObject({ tenderId: 'ZPPA/TEST/0001', supplierRef: supplier.supplier.supplierRef, txId: expect.any(String) });
    expect(res.body.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('a late bid is refused with the ledger reason and no key is kept', async () => {
    const { app, bidKeys, tenders } = fakes();
    await publish(app);
    tenders.get('ZPPA/TEST/0001').closingTime = new Date(Date.now() - 1000).toISOString(); // tender has closed
    const res = await submitBid(app);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: expect.stringContaining('closed at'), source: 'ledger' });
    expect(bidKeys.size).toBe(0);
  });

  test('requires a file and a valid tender', async () => {
    const { app } = fakes();
    const noFile = await request(app).post('/api/bids').set('authorization', supplier.header).field('tenderId', 'ZPPA/TEST/0001');
    expect(noFile.status).toBe(400);
    const unknown = await submitBid(app, 'ZPPA/NOPE/1');
    expect(unknown.status).toBe(409);
  });
});

describe('3.5.1 Roles on tenders and bids', () => {
  test('publishing needs a signed-in officer', async () => {
    const { app } = fakes();
    const anonymous = await request(app).post('/api/tenders').field('reference', 'ZPPA/TEST/0001');
    expect(anonymous.status).toBe(401);
    const asSupplier = await request(app).post('/api/tenders').set('authorization', supplier.header)
      .field('reference', 'ZPPA/TEST/0001');
    expect(asSupplier.status).toBe(403);
  });

  test('bidding needs a signed-in bidder', async () => {
    const { app } = fakes();
    await publish(app);
    const asOfficer = await request(app).post('/api/bids').set('authorization', officer.header)
      .field('tenderId', 'ZPPA/TEST/0001').attach('bid', Buffer.from('x'), 'bid.txt');
    expect(asOfficer.status).toBe(403);
  });

  test('a bidder cannot bid under another supplier\'s pseudonym', async () => {
    const { app, calls } = fakes();
    await publish(app);
    await request(app).post('/api/bids').set('authorization', supplier.header).field('tenderId', 'ZPPA/TEST/0001')
      .field('supplierRef', 'SUP-SOMEONE-ELSE').attach('bid', Buffer.from('x'), 'bid.txt');
    const bidCall = calls.find((c) => c.fn === 'BidContract:SubmitBid');
    expect(bidCall.args[2]).toBe(supplier.supplier.supplierRef);
  });

  test('a suspended officer is refused at once, even with a valid session', async () => {
    const { app } = fakes();
    await db.user.update({ where: { id: officer.user.id }, data: { status: 'SUSPENDED' } });
    const res = await publish(app);
    expect(res.status).toBe(401);
  });

  test('publishing and bidding are written to the audit log', async () => {
    const { app } = fakes();
    await publish(app);
    await request(app).post('/api/bids').set('authorization', supplier.header).field('tenderId', 'ZPPA/TEST/0001')
      .attach('bid', Buffer.from('x'), 'bid.txt');
    const actions = (await db.auditLog.findMany()).map((a) => a.action).sort();
    expect(actions).toEqual(['bid.submitted', 'tender.published']);
  });
});

describe('Receipt verification', () => {
  // A real self-signed P-256 certificate, made with openssl, so the check runs exactly as in production
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=gateway'],
  { stdio: 'ignore' });
  const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(dir, 'key.pem')));
  const cert = fs.readFileSync(path.join(dir, 'cert.pem'));
  const receipt = { bidId: 'BID-1', tenderId: 'ZPPA/TEST/0001', supplierRef: 'SUP-alpha', cipherHash: 'ab'.repeat(32),
    cid: 'bafyexample', submittedAt: '2026-10-13T06:00:00Z', txId: 'tx1', block: 7 };

  test('a genuine receipt verifies', () => {
    expect(verify(sign(receipt, privateKey, cert))).toBe(true);
  });

  test.each(['bidId', 'cipherHash', 'submittedAt', 'block'])('changing %s breaks the signature', (field) => {
    const signed = sign(receipt, privateKey, cert);
    expect(verify({ ...signed, [field]: field === 'block' ? 8 : `${signed[field]}x` })).toBe(false);
  });

  test('a receipt signed by another key fails', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(verify({ ...sign(receipt, other, cert) })).toBe(false);
  });

  test('the API endpoint reports validity', async () => {
    const { app } = fakes();
    const signed = sign(receipt, privateKey, cert);
    expect((await request(app).post('/api/receipts/verify').send(signed)).body).toEqual({ valid: true });
    expect((await request(app).post('/api/receipts/verify').send({ ...signed, block: 99 })).body).toEqual({ valid: false });
  });
});

describe('3.5.2 Bidding needs a verified company', () => {
  test('a bidder whose company tax clearance has expired cannot bid', async () => {
    const { app, calls } = fakes();
    await publish(app);
    await db.supplier.update({ where: { pacraNumber: supplier.supplier.pacraNumber },
      data: { taxClearanceExpiry: new Date(Date.now() - 86_400_000) } });
    const res = await request(app).post('/api/bids').set('authorization', supplier.header)
      .field('tenderId', 'ZPPA/TEST/0001').attach('bid', Buffer.from('x'), 'bid.txt');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/tax clearance expired/);
    expect(calls.find((c) => c.fn === 'BidContract:SubmitBid')).toBeUndefined();
  });
});
