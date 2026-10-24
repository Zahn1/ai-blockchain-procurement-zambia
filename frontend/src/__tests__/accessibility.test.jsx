// Accessibility (NFR-10, WCAG 2.1 AA): every main screen is checked with axe-core, the engine behind most
// accessibility checkers. jsdom has no layout, so colour contrast is checked in a real browser (docs/phase6/accessibility.md).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { AuthProvider } from '../lib/auth.jsx';
import SignIn from '../pages/SignIn.jsx';
import { at, serve } from './helpers.jsx';

const past = '2026-10-24T09:00:00Z';
const OFFICER = { id: 'o1', name: 'Mwila Banda', role: 'OFFICER' };
const REGULATOR = { id: 'r1', name: 'Natasha Mumba', role: 'REGULATOR' };
const BIDDER = { id: 'b1', name: 'Grace Mulenga', role: 'SUPPLIER', supplierRef: 'SUP-A', companyName: 'Alpha Computers Limited' };
const ADMIN = { id: 'a1', name: 'System Administrator', role: 'ADMIN' };
const TENDERS = [{ reference: 'ZPPA/T/1', title: 'Solar panels', closingTime: past, publishedAt: past, block: 7 }];

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function violations() {
  const result = await axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

test('sign-in', async () => {
  render(<MemoryRouter><AuthProvider><SignIn /></AuthProvider></MemoryRouter>);
  expect(await violations()).toEqual([]);
});

test.each([
  ['officer dashboard', OFFICER, '/', { 'GET /dashboard': [200, { figures: { openTenders: 1, awaitingEvaluation: 0, activeContracts: 1, paymentsHeld: 0 } }], 'GET /tenders': [200, TENDERS] }, 'Dashboard'],
  ['tender register', OFFICER, '/tenders', { 'GET /tenders': [200, TENDERS] }, 'Tenders'],
  ['publish tender', OFFICER, '/tenders/new', {}, 'Publish tender'],
  ['my bids', BIDDER, '/bids', { 'GET /tenders': [200, TENDERS], 'GET /bids/mine': [200, []] }, 'My bids'],
  ['risk alerts', REGULATOR, '/oversight', { 'GET /oversight/alerts': [200, [{ id: 'A1', status: 'OPEN', score: 83, subjectType: 'tender', subjectId: 'ZPPA/T/1',
    modelVersion: 'risk-1.0.0', raisedAt: past, decisions: [], explanation: { reasons: [{ text: 'Only 1 bidder.', model: 'supervised', impact: 2 }], matchesLedger: true } }]] }, 'Risk alerts'],
  ['reports', REGULATOR, '/reports', {}, 'Reports'],
  ['users', ADMIN, '/admin/users', { 'GET /admin/users': [200, [{ id: 'u1', name: 'Mwila Banda', email: 'o@x.test', role: 'OFFICER', status: 'ACTIVE', totpEnabled: true }]], 'GET /admin/entities': [200, []] }, 'Users'],
  ['public portal', null, '/public', { 'GET /public/search?q=': [200, { tenders: [], contracts: [], payments: [] }] }, 'Public procurement records'],
  ['registration', null, '/register', {}, 'Register as a bidder'],
])('%s', async (_name, user, path, routes, heading) => {
  serve(user, routes);
  at(path);
  await screen.findByRole('heading', { name: heading, level: 1 });
  await new Promise((r) => setTimeout(r, 50)); // let the page's own data load
  expect(await violations()).toEqual([]);
});

test('control: the check does catch problems (an image with no text, an unlabelled field)', async () => {
  render(<main><img src="x.png" /><input type="text" /></main>);
  const found = await violations();
  expect(found.some((v) => v.startsWith('image-alt'))).toBe(true);
  expect(found.some((v) => v.startsWith('label'))).toBe(true);
});
