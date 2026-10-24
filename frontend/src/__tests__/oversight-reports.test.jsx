// Front end, step 4a: regulators review alerts and see each procurement's history (3.5.7, 3.5.8); reports (3.5.10).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { at, calls, serve, submit } from './helpers.jsx';

const REGULATOR = { id: 'r1', name: 'Natasha Mumba', role: 'REGULATOR' };
const OFFICER = { id: 'o1', name: 'Mwila Banda', role: 'OFFICER' };
const past = '2026-10-24T09:40:00Z';
const alert = (id, status, score, text, extra = {}) => ({ id, status, score, subjectType: 'tender', subjectId: `ZPPA/T/${id}`,
  modelVersion: 'risk-1.0.0', raisedAt: past, decisions: [],
  explanation: { reasons: [{ text, model: 'supervised', impact: 2.6 }, { text: 'Unusual combination of details.', model: 'unsupervised', impact: 1 }], matchesLedger: true },
  ...extra });
const ALERTS = [
  alert('A1', 'OPEN', 83, 'Only 1 bidder.'),
  alert('A2', 'REFERRED', 91, 'This supplier has won 100% of this buyer\'s awards.'),
  alert('A3', 'CLEARED', 75, 'Price far below the estimate.', { decisions: [{ decision: 'CLEARED', reason: 'Checked: the estimate was out of date.', by: 'Natasha Mumba', at: past, recordHash: 'ab'.repeat(32), txId: 'tx3' }] }),
];

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('risk alerts', () => {
  test('unreviewed alerts come first, with the AI\'s reasons in plain words', async () => {
    serve(REGULATOR, { 'GET /oversight/alerts': [200, ALERTS] });
    at('/oversight');
    expect(await screen.findByRole('tab', { name: /To review 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Only 1 bidder.').length).toBeGreaterThan(0);
    expect(screen.getByText('Unusual pattern')).toBeInTheDocument();
    expect(screen.getByText('This explanation matches the hash recorded on the ledger.')).toBeInTheDocument();
    expect(screen.queryByText('Price far below the estimate.')).not.toBeInTheDocument();
  });

  test('offers only the decisions the ledger allows next', async () => {
    serve(REGULATOR, { 'GET /oversight/alerts': [200, ALERTS] });
    at('/oversight');
    fireEvent.click(await screen.findByRole('tab', { name: /Referred/ }));
    expect(screen.getAllByRole('radio').map((r) => r.value)).toEqual(['CLEARED']); // referred can only be cleared
    fireEvent.click(screen.getByRole('tab', { name: /Cleared/ }));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument(); // cleared is final
    expect(screen.getByText('Checked: the estimate was out of date.')).toBeInTheDocument();
  });

  test('a decision needs a reason of 20 characters and is recorded on the ledger', async () => {
    serve(REGULATOR, { 'GET /oversight/alerts': [200, ALERTS], 'POST /oversight/alerts/decide': [201, { alertId: 'A1', decision: 'MONITOR', recordHash: 'cd'.repeat(32), txId: 'tx9' }] });
    at('/oversight');
    fireEvent.click(await screen.findByDisplayValue('MONITOR'));
    const record = screen.getByRole('button', { name: 'Record decision on the ledger' });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Too short' } });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Single bidder in a remote market; prices checked.' } });
    submit('Record decision on the ledger');
    expect(await screen.findByText(/Decision recorded on the ledger/)).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.path === '/oversight/alerts/decide').body))
      .toEqual({ alertId: 'A1', subjectId: 'ZPPA/T/A1', decision: 'MONITOR', reason: 'Single bidder in a remote market; prices checked.' });
  });
});

describe('procurement history', () => {
  test('is grouped by day, with amounts in kwacha and each step\'s ledger transaction', async () => {
    serve(REGULATOR, { [`GET /oversight/history?reference=AWD-1`]: [200, { reference: 'ZPPA/T/1', title: 'Solar panels', fullyPaid: false, events: [
      { at: '2026-10-23T09:00:00Z', what: 'Tender published', detail: 'Estimated value 8650000 ngwee; closes 2026-10-24T09:32:30Z', txId: 'tx1', source: 'ledger' },
      { at: '2026-10-24T09:40:00Z', what: 'Committee recommendation', detail: 'BID-1', txId: null, source: 'off-chain, hash on ledger at award' },
      { at: '2026-10-24T12:08:00Z', what: 'Payment made', detail: 'MS-1: 4100000 ngwee; IFMIS reference IFMIS-2026-000003', txId: 'tx9', source: 'ledger' },
    ] }] });
    at('/oversight/history?ref=AWD-1');
    expect(await screen.findByText('Solar panels')).toBeInTheDocument();
    expect(screen.getByText('23 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('24 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText(/Estimated value K86,500.00; closes 24 Oct 2026, 11:32/)).toBeInTheDocument();
    expect(screen.getByText('off-chain, hash on ledger at award')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });
});

describe('reports', () => {
  test('each role sees only the reports it may download', async () => {
    serve(OFFICER, {});
    at('/reports');
    expect(await screen.findByText('Procurement report')).toBeInTheDocument();
    expect(screen.queryByText('Risk alert report')).not.toBeInTheDocument();
    cleanup();
    serve(REGULATOR, {});
    at('/reports');
    expect(await screen.findByText('Risk alert report')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /PDF/ })).toHaveLength(3);
  });

  test('downloads the chosen format', async () => {
    serve(REGULATOR, {});
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:report');
    const fetchMock = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => (url.startsWith('/api/reports/')
      ? new Response('xlsx', { status: 200, headers: { 'content-disposition': 'attachment; filename="alerts-report.xlsx"' } })
      : fetchMock(url, init)));
    at('/reports');
    fireEvent.click((await screen.findAllByRole('button', { name: /Spreadsheet/ }))[2]);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/reports/alerts?format=xlsx', expect.anything()));
  });
});
