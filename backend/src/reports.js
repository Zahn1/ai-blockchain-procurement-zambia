// Procurement, alert and payment reports in PDF and spreadsheet (XLSX) formats (Chapter 3, 3.5.10).
import express from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { AuthError } from './auth.js';

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const kw = (ngwee) => (ngwee == null ? null : Number(ngwee) / 100);
const lusaka = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lusaka' }) : '');

/** Who may download which report. */
export const REPORT_ROLES = {
  procurement: ['OFFICER', 'REGULATOR'],
  payments: ['OFFICER', 'REGULATOR'],
  alerts: ['REGULATOR'],
};

/** Builds a report as { title, columns: [{ header, key, width, money? }], rows }. */
export async function buildReport(kind, { db, ledger, officerIdentity }) {
  if (kind === 'procurement') {
    const tenders = await db.tender.findMany({ orderBy: { createdAt: 'asc' },
      include: { publishedBy: { include: { entity: true } }, bids: true, contract: true } });
    const rows = [];
    for (const t of tenders) {
      const onLedger = await ledger.evaluate(officerIdentity, 'TenderContract:ReadTender', t.reference);
      const winner = t.contract ? await db.supplier.findFirst({ where: { supplierRef: t.contract.supplierRef } }) : null;
      rows.push({ reference: t.reference, title: t.title, buyer: t.publishedBy.entity?.name ?? '', published: lusaka(t.createdAt),
        closing: lusaka(t.closingTime), estimate: kw(onLedger.estValue), bids: t.bids.length, status: onLedger.status,
        awardedTo: winner?.companyName ?? '', contractValue: kw(t.contract?.amountNgwee) });
    }
    return { title: 'Procurement report', rows, columns: [
      { header: 'Reference', key: 'reference', width: 24 }, { header: 'Title', key: 'title', width: 30 },
      { header: 'Buyer', key: 'buyer', width: 20 }, { header: 'Published', key: 'published', width: 18 },
      { header: 'Closing', key: 'closing', width: 18 }, { header: 'Estimate (K)', key: 'estimate', width: 14, money: true },
      { header: 'Bids', key: 'bids', width: 6 }, { header: 'Status', key: 'status', width: 12 },
      { header: 'Awarded to', key: 'awardedTo', width: 24 }, { header: 'Contract value (K)', key: 'contractValue', width: 16, money: true },
    ] };
  }
  if (kind === 'payments') {
    const paid = await db.milestone.findMany({ where: { paymentStatus: 'PAID' }, orderBy: { paidAt: 'asc' },
      include: { contract: { include: { tender: true } } } });
    const rows = [];
    for (const m of paid) {
      const company = await db.supplier.findFirst({ where: { supplierRef: m.contract.supplierRef } });
      rows.push({ paidAt: lusaka(m.paidAt), contract: m.awardId, tender: m.contract.tenderRef, milestone: `${m.milestoneId} ${m.description}`,
        amount: kw(m.amountNgwee), supplier: company?.companyName ?? m.contract.supplierRef, ifmisRef: m.ifmisRef, txId: m.paymentTxId });
    }
    return { title: 'Payment report', rows, columns: [
      { header: 'Paid', key: 'paidAt', width: 18 }, { header: 'Contract', key: 'contract', width: 13 },
      { header: 'Tender', key: 'tender', width: 22 }, { header: 'Milestone', key: 'milestone', width: 34 },
      { header: 'Amount (K)', key: 'amount', width: 14, money: true }, { header: 'Supplier', key: 'supplier', width: 26 },
      { header: 'IFMIS reference', key: 'ifmisRef', width: 18 }, { header: 'Ledger transaction', key: 'txId', width: 24 },
    ] };
  }
  if (kind === 'alerts') {
    const [alerts, decisions] = await Promise.all([
      ledger.evaluate(officerIdentity, 'AlertContract:GetAllAlerts'),
      db.alertDecision.findMany({ include: { decidedBy: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const rows = alerts.map((a) => {
      const last = decisions.filter((d) => d.alertId === a.id).at(-1);
      return { alert: a.id, on: `${a.subjectType} ${a.subjectId}`, score: a.score, status: a.status, raised: lusaka(a.raisedAt),
        model: a.modelVersion, decision: last?.decision ?? '', reason: last?.reason ?? '', by: last?.decidedBy.name ?? '', decided: lusaka(last?.createdAt) };
    }).sort((x, y) => y.score - x.score);
    return { title: 'Alert report', rows, columns: [
      { header: 'Alert', key: 'alert', width: 20 }, { header: 'On', key: 'on', width: 30 },
      { header: 'Score', key: 'score', width: 7 }, { header: 'Status', key: 'status', width: 11 },
      { header: 'Raised', key: 'raised', width: 18 }, { header: 'Model', key: 'model', width: 10 },
      { header: 'Latest decision', key: 'decision', width: 14 }, { header: 'Reason', key: 'reason', width: 40 },
      { header: 'Decided by', key: 'by', width: 18 }, { header: 'Decided', key: 'decided', width: 18 },
    ] };
  }
  throw new AuthError(404, 'Unknown report.');
}

export async function toXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ZPPA Transparent Procurement prototype';
  const ws = wb.addWorksheet(report.title);
  ws.columns = report.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.addRows(report.rows);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  report.columns.forEach((c, i) => { if (c.money) ws.getColumn(i + 1).numFmt = '#,##0.00'; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(report, generatedAt = new Date()) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: report.title } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const left = 36;
    const usable = doc.page.width - 72;
    const total = report.columns.reduce((s, c) => s + c.width, 0);
    const widths = report.columns.map((c) => (c.width / total) * usable);
    const cell = (v, c) => (v == null ? '' : c.money ? Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : String(v));

    const header = () => {
      let x = left;
      doc.font('Helvetica-Bold').fontSize(8);
      const y = doc.y;
      report.columns.forEach((c, i) => { doc.text(c.header, x, y, { width: widths[i] - 4 }); x += widths[i]; });
      doc.moveTo(left, doc.y + 2).lineTo(left + usable, doc.y + 2).stroke('#999999');
      doc.y += 6;
    };

    doc.font('Helvetica-Bold').fontSize(16).text(report.title, left, 36);
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
      .text(`ZPPA Transparent Procurement prototype · generated ${lusaka(generatedAt)} (Lusaka time) · ${report.rows.length} row(s)`);
    doc.fillColor('#000000').moveDown(1);
    header();
    if (!report.rows.length) doc.font('Helvetica').fontSize(9).text('No records.', left);
    for (const row of report.rows) {
      doc.font('Helvetica').fontSize(8);
      const heights = report.columns.map((c, i) => doc.heightOfString(cell(row[c.key], c), { width: widths[i] - 4 }));
      const h = Math.max(...heights) + 4;
      if (doc.y + h > doc.page.height - 36) { doc.addPage(); header(); doc.font('Helvetica').fontSize(8); }
      const y = doc.y;
      let x = left;
      report.columns.forEach((c, i) => {
        doc.text(cell(row[c.key], c), x, y, { width: widths[i] - 4, align: c.money ? 'right' : 'left' });
        x += widths[i];
      });
      doc.y = y + h;
    }
    doc.end();
  });
}

export function reportRoutes({ db, auth, ledger, officerIdentity }) {
  const r = express.Router();
  r.get('/reports/:kind', auth.requireAuth, wrap(async (req, res) => {
    const kind = req.params.kind;
    const allowed = REPORT_ROLES[kind];
    if (!allowed) throw new AuthError(404, 'Unknown report.');
    if (!allowed.includes(req.user.role)) throw new AuthError(403, 'Your role does not allow this report.');
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'pdf';
    const report = await buildReport(kind, { db, ledger, officerIdentity });
    const stamp = new Date().toISOString().slice(0, 10);
    await auth.audit(req.user.id, 'report.downloaded', { kind, format, rows: report.rows.length }, req.ip);
    if (format === 'xlsx') {
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${kind}-report-${stamp}.xlsx`).send(await toXlsx(report));
    } else {
      res.type('application/pdf').attachment(`${kind}-report-${stamp}.pdf`).send(await toPdf(report));
    }
  }));
  return r;
}
