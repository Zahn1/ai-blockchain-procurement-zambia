// Tests for Chapter 3, 3.5.10 Reporting and Notifications.
import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { dbStore } from '../src/store.js';
import { createNotifier, smsClient } from '../src/notify.js';
import { smsStandIn } from '../src/standins/services.js';
import { buildReport, toPdf, toXlsx } from '../src/reports.js';
import { db, resetDb, makeAuth, signedIn, verifiedSupplier } from './helpers.js';

const REF = 'ZPPA/MOH/2026/1001';
let smsServer;
let smsUrl;
beforeAll(() => {
  const s = express();
  s.use('/sms', smsStandIn());
  smsServer = s.listen(0);
  smsUrl = `http://127.0.0.1:${smsServer.address().port}/sms`;
});
afterAll(async () => { smsServer.close(); await db.$disconnect(); });

function fakeMailer({ failing = false } = {}) {
  const sent = [];
  return { sent, async sendMail(m) { if (failing) throw new Error('SMTP server unavailable'); sent.push(m); return { messageId: `<m${sent.length}@test>` }; } };
}

function fakeLedger() {
  const tenders = new Map();
  return {
    async submit(_id, fn, ...args) {
      if (fn === 'TenderContract:PublishTender') {
        tenders.set(args[0], { id: args[0], estValue: args[1], closingTime: args[2], status: 'PUBLISHED' });
        return { result: null, txId: 'tx-pub-1', block: 1 };
      }
      if (fn === 'BidContract:SubmitBid') return { result: { submittedAt: new Date().toISOString() }, txId: 'tx-bid-1', block: 2 };
      throw new Error(`unexpected ${fn}`);
    },
    async evaluate(_id, fn, ...args) {
      if (fn === 'TenderContract:ReadTender') return tenders.get(args[0]) ?? { id: args[0], estValue: 15_000_000, status: 'AWARDED' };
      if (fn === 'AlertContract:GetAllAlerts') return [
        { id: 'ALT-1', subjectType: 'contract', subjectId: 'AWD-1', score: 82, status: 'CLEARED', modelVersion: 'rf-0.1.0', raisedAt: '2026-10-18T07:00:00Z' },
        { id: 'ALT-2', subjectType: 'tender', subjectId: REF, score: 91, status: 'OPEN', modelVersion: 'rf-0.1.0', raisedAt: '2026-10-18T08:00:00Z' },
      ];
      throw new Error(`unexpected ${fn}`);
    },
  };
}

function setup({ failing = false } = {}) {
  const mailer = fakeMailer({ failing });
  const notifier = createNotifier({ db, mailer, sms: smsClient({ url: smsUrl }), from: 'ZPPA e-Procurement <no-reply@zppa.test>' });
  const files = new Map();
  const app = createApp({ ledger: fakeLedger(), ipfs: { async add(b) { const c = `bafy${files.size}`; files.set(c, b); return c; } },
    store: dbStore(db), keys: { async storeBidKey() {} }, receiptSigner: async () => {
      const crypto = await import('node:crypto');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      return [privateKey, publicKey.export({ type: 'spki', format: 'pem' })];
    }, db, auth: makeAuth(), notifier });
  return { app, mailer, notifier };
}

let officer;
let regulator;
let alpha;
let bravo;
const as = (who) => ({ authorization: who.header });

beforeEach(async () => {
  await resetDb();
  const entity = await db.procuringEntity.create({ data: { code: 'MOH', name: 'Ministry of Health' } });
  officer = await signedIn('OFFICER', { entityId: entity.id });
  regulator = await signedIn('REGULATOR');
  alpha = await signedIn('SUPPLIER', { phone: '+260971000001' });
  bravo = await signedIn('SUPPLIER');
});

const publish = (app) => request(app).post('/api/tenders').set(as(officer)).field('reference', REF).field('title', 'Laptops')
  .field('estValueKwacha', '150000').field('closesInMinutes', '30').attach('document', Buffer.from('tender'), 't.pdf');

describe('Notifications for key events', () => {
  test('tender publication: every active user of a verified supplier gets an e-mail, and an SMS if they gave a number', async () => {
    const suspended = await verifiedSupplier({ status: 'SUSPENDED' });
    await signedIn('SUPPLIER', { supplierId: suspended.pacraNumber });
    const { app, mailer, notifier } = setup();
    expect((await publish(app)).status).toBe(201);
    await notifier.flush();

    expect(mailer.sent.map((m) => m.to).sort()).toEqual([alpha.user.email, bravo.user.email].sort());
    expect(mailer.sent[0]).toMatchObject({ subject: `New tender: ${REF} Laptops`, from: expect.stringContaining('no-reply@zppa.test') });
    const sms = await db.notification.findMany({ where: { channel: 'SMS' } });
    expect(sms).toEqual([expect.objectContaining({ event: 'TENDER_PUBLISHED', recipient: '+260971000001', status: 'SENT', providerRef: expect.stringMatching(/^SMS-/) })]);
  });

  test('bid receipt: the bidder gets the bid ID and ledger transaction', async () => {
    const { app, mailer, notifier } = setup();
    await publish(app);
    await notifier.flush();
    mailer.sent.length = 0;
    const bid = await request(app).post('/api/bids').set(as(alpha)).field('tenderId', REF).attach('bid', Buffer.from('my bid'), 'bid.pdf');
    await notifier.flush();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: alpha.user.email, subject: `Bid received for ${REF}` });
    expect(mailer.sent[0].text).toContain(bid.body.bidId);
    expect(mailer.sent[0].text).toContain('tx-bid-1');
  });

  test('contract award and payment: only the winning company is told', async () => {
    const { mailer, notifier } = setup();
    const contract = { awardId: 'AWD-1', tenderRef: REF, bidId: 'BID-A', supplierRef: alpha.supplier.supplierRef,
      amountNgwee: 14_000_000n, standstillEnds: new Date() };
    notifier.contractAwarded(contract, 'Laptops');
    notifier.paymentMade(contract, { milestoneId: 'MS-1', description: 'Delivery', amountNgwee: 6_000_000n }, 'IFMIS-2026-000007');
    await notifier.flush();
    // Sent in the background, so in either order
    expect(mailer.sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      [alpha.user.email, `Contract awarded: ${REF}`],
      [alpha.user.email, 'Payment made: AWD-1 MS-1'],
    ]);
    const payment = mailer.sent.find((m) => m.subject.startsWith('Payment made'));
    expect(payment.text).toContain('K60,000.00');
    expect(payment.text).toContain('IFMIS-2026-000007');
    const events = (await db.notification.findMany({ where: { channel: 'SMS' } })).map((n) => n.event).sort();
    expect(events).toEqual(['CONTRACT_AWARDED', 'PAYMENT_MADE']);
  });

  test('a failed e-mail is logged and never undoes the action', async () => {
    const { app, notifier } = setup({ failing: true });
    const res = await publish(app);
    expect(res.status).toBe(201);
    await notifier.flush();
    expect(await db.tender.count()).toBe(1);
    const failed = await db.notification.findMany({ where: { channel: 'EMAIL' } });
    expect(failed.every((n) => n.status === 'FAILED' && n.error === 'SMTP server unavailable')).toBe(true);
    expect(failed).toHaveLength(2);
  });

  test('mobile numbers must be in international format', async () => {
    const { app } = setup();
    const admin = await signedIn('ADMIN');
    const bad = await request(app).post('/api/admin/users').set(as(admin))
      .send({ email: 'x@moh.test', name: 'X', role: 'REGULATOR', password: 'starting-pass-1', phone: '0971234567' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/international format/);
  });
});

describe('Reports in PDF and spreadsheet formats', () => {
  async function seed() {
    await db.tender.create({ data: { reference: REF, title: 'Laptops', fileName: 't.pdf', docHash: 'a'.repeat(64), cid: 'c',
      closingTime: new Date('2026-10-18T09:00:00Z'), txId: 'tx', block: 1, publishedById: officer.user.id } });
    await db.contract.create({ data: { awardId: 'AWD-1', tenderRef: REF, bidId: 'BID-A', supplierRef: alpha.supplier.supplierRef,
      amountNgwee: 14_000_000n, evalHash: 'e'.repeat(64), awardTxId: 'tx-a', awardedAt: new Date(), standstillEnds: new Date(), status: 'SIGNED' } });
    await db.milestone.create({ data: { awardId: 'AWD-1', milestoneId: 'MS-1', description: 'Delivery', amountNgwee: 6_000_000n,
      dueDate: new Date(), paymentStatus: 'PAID', ifmisRef: 'IFMIS-2026-000007', paymentTxId: 'tx-pay', paidAt: new Date('2026-10-18T10:00:00Z') } });
    await db.alertDecision.create({ data: { alertId: 'ALT-1', subjectId: 'AWD-1', decision: 'CLEARED', reason: 'Deliveries verified by the inspector.',
      record: {}, recordHash: 'h'.repeat(64), decidedById: regulator.user.id, txId: 'tx-d' } });
  }
  const deps = { db, ledger: fakeLedger(), officerIdentity: 'officer1' };

  test('the procurement report lists each tender with its buyer, bids, status and awardee', async () => {
    await seed();
    const r = await buildReport('procurement', deps);
    expect(r.rows).toEqual([expect.objectContaining({ reference: REF, buyer: 'Ministry of Health', bids: 0, status: 'AWARDED',
      estimate: 150000, contractValue: 140000, awardedTo: alpha.supplier.companyName })]);
  });

  test('the payment report lists each payment with its supplier and IFMIS reference', async () => {
    await seed();
    const r = await buildReport('payments', deps);
    expect(r.rows).toEqual([expect.objectContaining({ contract: 'AWD-1', amount: 60000, ifmisRef: 'IFMIS-2026-000007', supplier: alpha.supplier.companyName })]);
  });

  test('the alert report lists alerts, highest score first, with the latest decision and reason', async () => {
    await seed();
    const r = await buildReport('alerts', deps);
    expect(r.rows.map((x) => x.alert)).toEqual(['ALT-2', 'ALT-1']);
    expect(r.rows[1]).toMatchObject({ decision: 'CLEARED', reason: 'Deliveries verified by the inspector.' });
  });

  test('PDF and XLSX files are produced from the same rows', async () => {
    await seed();
    const r = await buildReport('payments', deps);
    const pdf = await toPdf(r);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toXlsx(r));
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).getCell(1).value).toBe('Paid');
    expect(ws.getRow(2).getCell(5).value).toBe(60000);
    expect(ws.getRow(2).getCell(7).value).toBe('IFMIS-2026-000007');
  });

  test.each([
    ['procurement', 'pdf', 'OFFICER', 200, 'application/pdf'],
    ['payments', 'xlsx', 'OFFICER', 200, 'spreadsheetml'],
    ['alerts', 'pdf', 'REGULATOR', 200, 'application/pdf'],
    ['alerts', 'xlsx', 'OFFICER', 403, null],
    ['payments', 'pdf', 'SUPPLIER', 403, null],
  ])('the %s report as %s for a %s: %i', async (kind, format, role, status, type) => {
    await seed();
    const { app } = setup();
    const who = { OFFICER: officer, REGULATOR: regulator, SUPPLIER: alpha }[role];
    const res = await request(app).get(`/api/reports/${kind}`).query({ format }).set(as(who)).buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(status);
    if (type) {
      expect(res.headers['content-type']).toContain(type);
      expect(res.headers['content-disposition']).toMatch(new RegExp(`${kind}-report-\\d{4}-\\d{2}-\\d{2}\\.${format}`));
    }
  });

  test('reports need signing in', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/reports/procurement')).status).toBe(401);
  });
});
