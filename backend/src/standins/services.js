// Stand-ins for the PACRA and ZRA systems that ZPPA's e-GP already integrates with (Chapter 3, 3.5.2).
// Each is a separate HTTP service; the back end reaches them only through their URLs (PACRA_API_URL, ZRA_API_URL),
// so pointing those settings at the real services replaces the stand-ins without code changes.
import express from 'express';
import { pacraCompanies, zraTaxpayers } from './registry-data.js';

export function pacraStandIn() {
  const r = express.Router();
  r.get('/api/companies/:registrationNumber', (req, res) => {
    const company = pacraCompanies.find((c) => c.registrationNumber === req.params.registrationNumber);
    if (!company) return res.status(404).json({ error: 'No company with that registration number.' });
    res.json(company);
  });
  return r;
}

export function zraStandIn() {
  const r = express.Router();
  r.get('/api/taxpayers/:tpin', (req, res) => {
    const taxpayer = zraTaxpayers.find((t) => t.tpin === req.params.tpin);
    if (!taxpayer) return res.status(404).json({ error: 'No taxpayer with that TPIN.' });
    res.json(taxpayer);
  });
  return r;
}

// Stand-in for IFMIS, the government payment system (Chapter 3, 3.5.6). It accepts payment instructions and returns
// a payment reference. The same payment ID always gets the same reference, so a retried instruction is not paid twice.
export function ifmisStandIn() {
  const r = express.Router();
  r.use(express.json());
  const instructions = new Map();
  let next = 1;
  r.post('/api/payment-instructions', (req, res) => {
    const { paymentId, contractRef, milestoneRef, amountNgwee, payeeRef } = req.body ?? {};
    if (!paymentId || !contractRef || !milestoneRef || !(Number(amountNgwee) > 0) || !payeeRef) {
      return res.status(400).json({ error: 'paymentId, contractRef, milestoneRef, amountNgwee and payeeRef are required.' });
    }
    const existing = instructions.get(paymentId);
    if (existing) {
      if (existing.amountNgwee !== Number(amountNgwee)) return res.status(409).json({ error: 'That payment ID was used for a different amount.' });
      return res.json(existing);
    }
    const instruction = { paymentId, contractRef, milestoneRef, amountNgwee: Number(amountNgwee), payeeRef,
      ifmisRef: `IFMIS-${new Date().getUTCFullYear()}-${String(next++).padStart(6, '0')}`, status: 'ACCEPTED',
      receivedAt: new Date().toISOString() };
    instructions.set(paymentId, instruction);
    res.status(201).json(instruction);
  });
  return r;
}

// Stand-in for an SMS gateway (Chapter 3, 3.5.10). It accepts messages and lists them, so a demonstration can show
// what each phone would have received. A real gateway replaces it through SMS_API_URL.
export function smsStandIn() {
  const r = express.Router();
  r.use(express.json());
  const messages = [];
  r.post('/api/messages', (req, res) => {
    const { to, message } = req.body ?? {};
    if (!/^\+\d{9,15}$/.test(to ?? '')) return res.status(400).json({ error: 'The number must be in international format, e.g. +260971234567.' });
    if (!message) return res.status(400).json({ error: 'The message is empty.' });
    const sent = { messageId: `SMS-${String(messages.length + 1).padStart(6, '0')}`, to, message, at: new Date().toISOString() };
    messages.push(sent);
    res.status(201).json(sent);
  });
  r.get('/api/messages', (_req, res) => res.json([...messages].reverse()));
  return r;
}
