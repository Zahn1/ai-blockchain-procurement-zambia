// Front end, step 2: officers publish tenders (3.5.3) and bidders submit sealed bids (3.5.4).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth.jsx';
import { tenderStage } from '../lib/format.js';
import App from '../App.jsx';

const future = new Date(Date.now() + 3_600_000).toISOString();
const past = new Date(Date.now() - 3_600_000).toISOString();
const OFFICER = { id: 'u1', name: 'Mwila Banda', role: 'OFFICER' };
const BIDDER = { id: 'u2', name: 'Grace Mulenga', role: 'SUPPLIER', supplierRef: 'SUP-AAA111', companyName: 'Alpha Computers Limited' };
const TENDERS = [
  { reference: 'ZPPA/T/1', title: 'Solar panels', closingTime: future, publishedAt: past, block: 7 },
  { reference: 'ZPPA/T/2', title: 'Hospital beds', closingTime: past, publishedAt: past, block: 5 },
];
const ledgerTender = { id: 'ZPPA/T/1', estValue: 8_650_000, closingTime: future, docHashes: ['ab'.repeat(32)], quorum: 2,
  approvals: [], openingApproved: false, status: 'PUBLISHED', version: 1, publishedBy: 'ZPPAMSP' };

let calls;
function serve(user, routes) {
  calls = [];
  sessionStorage.setItem('procurement.token', 'test-token');
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = url.replace(/^\/api/, '');
    calls.push({ path, method: init.method ?? 'GET', body: init.body });
    const [status, body] = path === '/auth/me' ? [200, user] : (routes[`${init.method ?? 'GET'} ${path}`] ?? [404, { error: 'Not found' }]);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}
// jsdom cannot attach a real file to a required file input, so submit the form directly rather than via its button
const submit = (name) => fireEvent.submit(screen.getByRole('button', { name }).closest('form'));
const at = (path) => render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('tender stage in words', () => {
  test.each([
    [future, undefined, 'Open for bids'],
    [past, undefined, 'Closed'],
    [past, { status: 'PUBLISHED', openingApproved: true }, 'Bids opened'],
    [past, { status: 'AWARDED' }, 'Awarded'],
  ])('closing %s, ledger %o → %s', (closing, ledger, expected) => {
    expect(tenderStage(closing, ledger)[0]).toBe(expected);
  });
});

describe('officer', () => {
  test('sees the tender register and can filter to open tenders', async () => {
    serve(OFFICER, { 'GET /tenders': [200, TENDERS] });
    at('/tenders');
    expect(await screen.findByText('Solar panels')).toBeInTheDocument();
    expect(screen.getByText('Hospital beds')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'open' } });
    expect(screen.queryByText('Hospital beds')).not.toBeInTheDocument();
  });

  test('publishes a tender with its document, closing time in minutes and value in kwacha', async () => {
    serve(OFFICER, { 'POST /tenders': [201, { reference: 'ZPPA/T/9', title: 'Desks', closingTime: future, docHash: 'cd'.repeat(32),
      cid: 'bafy', txId: 'ef'.repeat(32), block: 12, fileName: 'desks.pdf' }] });
    at('/tenders/new');
    fireEvent.change(await screen.findByLabelText('Tender reference'), { target: { value: 'ZPPA/T/9' } });
    fireEvent.change(screen.getByLabelText('Estimated value (K)'), { target: { value: '1200.50' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Desks' } });
    fireEvent.change(screen.getByLabelText('Closes in'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'hours' } });
    fireEvent.change(screen.getByLabelText('Tender document'), { target: { files: [new File(['x'], 'desks.pdf')] } });
    submit('Publish tender');

    expect(await screen.findByText('ZPPA/T/9 is on the ledger')).toBeInTheDocument();
    const sent = calls.find((c) => c.path === '/tenders' && c.method === 'POST').body;
    expect(sent.get('closesInMinutes')).toBe('120');
    expect(sent.get('estValueKwacha')).toBe('1200.50');
    expect(sent.get('document').name).toBe('desks.pdf');
  });

  test('a ledger refusal is shown as such', async () => {
    serve(OFFICER, { 'POST /tenders': [409, { error: 'tender ZPPA/T/1 already exists', source: 'ledger' }] });
    at('/tenders/new');
    fireEvent.change(await screen.findByLabelText('Tender reference'), { target: { value: 'ZPPA/T/1' } });
    fireEvent.change(screen.getByLabelText('Estimated value (K)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Again' } });
    fireEvent.change(screen.getByLabelText('Tender document'), { target: { files: [new File(['x'], 'a.pdf')] } });
    submit('Publish tender');
    expect(await screen.findByText(/The ledger refused this tender: tender ZPPA\/T\/1 already exists/)).toBeInTheDocument();
  });

  test('cannot reach the bid form', async () => {
    serve(OFFICER, { 'GET /dashboard': [200, { figures: {} }], 'GET /tenders': [200, []] });
    at('/bids/new');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('bidder', () => {
  test('sees only open tenders to bid on, and their own bids', async () => {
    serve(BIDDER, { 'GET /tenders': [200, TENDERS], 'GET /bids/mine': [200, [
      { bidId: 'BID-1', tenderRef: 'ZPPA/T/2', title: 'Hospital beds', submittedAt: past, cipherHash: 'aa'.repeat(32), outcome: 'Under evaluation' }]] });
    at('/bids');
    expect(await screen.findByRole('link', { name: 'Submit bid' })).toHaveAttribute('href', '/bids/new?tender=ZPPA%2FT%2F1');
    expect(await screen.findByText('BID-1')).toBeInTheDocument();
    expect(screen.getByText('Under evaluation')).toBeInTheDocument();
  });

  test('submits a sealed bid only after confirming, and gets a checked receipt', async () => {
    const receipt = { bidId: 'BID-9', tenderId: 'ZPPA/T/1', supplierRef: 'SUP-AAA111', cipherHash: '12'.repeat(32), cid: 'bafy2',
      submittedAt: past, txId: '34'.repeat(32), block: 13, signature: 'sig', signer: 'gateway@zppa.example.com', signerCert: 'cert' };
    serve(BIDDER, { 'GET /tenders': [200, TENDERS], 'POST /bids': [201, receipt], 'POST /receipts/verify': [200, { valid: true }] });
    at('/bids/new?tender=ZPPA%2FT%2F1');
    expect(await screen.findByText(/encrypted with its own AES-256 key/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Hospital beds/ })).not.toBeInTheDocument(); // closed tenders are not offered
    fireEvent.change(screen.getByLabelText('Bid document'), { target: { files: [new File(['bid'], 'bid.pdf')] } });
    expect(screen.getByRole('checkbox')).toBeRequired();
    fireEvent.click(screen.getByRole('checkbox'));
    submit('Submit sealed bid');

    expect(await screen.findByText('Bid BID-9 is sealed and recorded on the ledger')).toBeInTheDocument();
    expect(await screen.findByText('Signature valid')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/bids').body.get('tenderId')).toBe('ZPPA/T/1');
  });

  test('is not offered a second bid on a tender already bid on', async () => {
    serve(BIDDER, { [`GET /tender?id=${encodeURIComponent('ZPPA/T/1')}`]: [200, { tender: ledgerTender,
      history: [{ txId: 'tx1', timestamp: past, tender: ledgerTender }],
      bids: [{ id: 'BID-9', supplierRef: 'SUP-AAA111', submittedAt: past, cipherHash: '12'.repeat(32), opened: false }],
      offChain: { title: 'Solar panels', cid: 'bafy', txId: 'tx1' } }] });
    at('/tender?id=ZPPA%2FT%2F1');
    expect(await screen.findByText('(yours)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Submit a sealed bid/ })).not.toBeInTheDocument();
    expect(screen.getByText('Sealed')).toBeInTheDocument();
    expect(screen.getByText('0 of 2')).toBeInTheDocument();
  });
});
