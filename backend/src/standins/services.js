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
