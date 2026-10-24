// Front end, step 3: the committee opens and evaluates bids (3.5.5); the officer awards and signs, the inspector certifies (3.5.6).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { evaluationStage } from '../pages/Evaluation.jsx';
import { contractStage } from '../pages/Contracts.jsx';
import { at, calls, serve, submit } from './helpers.jsx';

const past = new Date(Date.now() - 3_600_000).toISOString();
const future = new Date(Date.now() + 86_400_000).toISOString();
const MEMBER = { id: 'm1', name: 'Chanda Mwape', role: 'COMMITTEE' };
const OFFICER = { id: 'o1', name: 'Mwila Banda', role: 'OFFICER' };
const INSPECTOR = { id: 'i1', name: 'Bwalya Kunda', role: 'INSPECTOR' };
const REF = 'ZPPA/T/1';
const EV_PATH = `GET /evaluation?reference=${encodeURIComponent(REF)}`;

/** An evaluation as GET /evaluation returns it, at a given stage. */
function evaluation({ approvals = 0, opened = false, scored = false, recommendation = null } = {}) {
  const committee = [{ id: 'm1', name: 'Chanda Mwape' }, { id: 'm2', name: 'Joseph Tembo' }]
    .map((m, i) => ({ ...m, approvedAt: i < approvals ? past : null, approvalTxId: i < approvals ? `tx${i}` : null }));
  const bid = (bidId, price, technical) => ({ bidId, supplierRef: `SUP-${bidId}`, submittedAt: past, cipherHash: 'ab'.repeat(32),
    integrity: opened ? 'MATCH' : null, priceNgwee: scored ? price : null, scoresIn: scored ? 2 : 0,
    myScore: scored ? { technicalScore: technical, comment: 'ok' } : null });
  return {
    reference: REF, title: 'Solar panels', closingTime: past, closed: true, quorum: 2, openingApproved: approvals >= 2,
    ledgerStatus: 'PUBLISHED', technicalWeight: 70, passMark: 60, committee, me: { id: 'm1', onCommittee: true },
    bids: [bid('B1', 8_200_000, 75), bid('B2', 7_900_000, 70)],
    ranking: scored ? { recommendedBidId: 'B1', rows: [
      { bidId: 'B1', supplierRef: 'SUP-B1', priceNgwee: 8_200_000, technical: 75, financial: 96.34, combined: 81.4, eligible: true },
      { bidId: 'B2', supplierRef: 'SUP-B2', priceNgwee: 7_900_000, technical: 70, financial: 100, combined: 79, eligible: true },
    ] } : { recommendedBidId: null, rows: [] },
    recommendation,
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('stages in words', () => {
  test('evaluation: the next thing that has to happen', () => {
    expect(evaluationStage({ closed: true, committee: 0 })[0]).toBe('Committee to be appointed');
    expect(evaluationStage({ closed: true, committee: 2, bids: 3, opened: 0 })[0]).toBe('Awaiting opening');
    expect(evaluationStage({ closed: true, committee: 2, bids: 3, opened: 3 })[0]).toBe('Being scored');
    expect(evaluationStage({ closed: true, recommended: true })[0]).toBe('Recommended, awaiting award');
  });

  test('contract: standstill, held payment, completed', () => {
    expect(contractStage({ status: 'AWARDED', standstillEnds: future })[0]).toBe('Standstill period');
    expect(contractStage({ status: 'SIGNED', milestones: [{ paymentStatus: 'PAID' }, { paymentStatus: 'HELD' }] })[0]).toBe('Payment held');
    expect(contractStage({ status: 'SIGNED', milestones: [{ paymentStatus: 'PAID' }] })[0]).toBe('Completed');
  });
});

describe('committee member', () => {
  test('approves opening, which is signed on the ledger', async () => {
    serve(MEMBER, { [EV_PATH]: [200, evaluation()], 'POST /evaluation/approve': [200, { txId: 'tx9', block: 120 }] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve opening' }));
    expect(await screen.findByText('Your approval is on the ledger in block 120.')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/evaluation/approve').body).toBe(JSON.stringify({ reference: REF }));
  });

  test('cannot open bids before the quorum, and sees the integrity result after opening', async () => {
    serve(MEMBER, { [EV_PATH]: [200, evaluation({ approvals: 1 })] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    expect(await screen.findByText('1 of 2 on the ledger')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open 2 bids/ })).not.toBeInTheDocument();
    cleanup();

    serve(MEMBER, { [EV_PATH]: [200, evaluation({ approvals: 2 })], 'POST /evaluation/open': [200, { results: [
      { bidId: 'B1', integrity: 'MATCH' }, { bidId: 'B2', integrity: 'MISMATCH', reason: 'The stored file does not match the hash recorded on the ledger.' }] }] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    fireEvent.click(await screen.findByRole('button', { name: /Open 2 bids/ }));
    expect(await screen.findByText(/B2: The stored file does not match the hash recorded on the ledger/)).toBeInTheDocument();
  });

  test('records their own technical score with a comment', async () => {
    serve(MEMBER, { [EV_PATH]: [200, evaluation({ approvals: 2, opened: true })], 'POST /evaluation/score': [200, { ok: true }] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Evaluate' }))[0]);
    fireEvent.change(screen.getByLabelText('Your technical score (0 to 100)'), { target: { value: '74' } });
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Meets the specification' } });
    submit('Save my score');
    await waitFor(() => expect(calls.some((c) => c.path === '/evaluation/score')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/evaluation/score').body)).toEqual({ bidId: 'B1', technicalScore: 74, comment: 'Meets the specification' });
  });

  test('the top-ranked bid is preselected; choosing another needs a justification of 50 characters', async () => {
    serve(MEMBER, { [EV_PATH]: [200, evaluation({ approvals: 2, opened: true, scored: true })] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    const select = await screen.findByLabelText('Recommended bid');
    expect(select).toHaveValue('B1');
    expect(screen.queryByLabelText('Justification')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'B2' } });
    expect(screen.getByText(/departs from the top-ranked bid \(B1\)/)).toBeInTheDocument();
    const record = screen.getByRole('button', { name: 'Record recommendation' });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Justification'), { target: { value: 'B2 is cheaper and its delivery schedule suits the rainy season better.' } });
    expect(record).toBeEnabled();
  });

  test('after the recommendation, the report hash is shown and scoring is closed', async () => {
    serve(MEMBER, { [EV_PATH]: [200, evaluation({ approvals: 2, opened: true, scored: true,
      recommendation: { bidId: 'B1', recommendedBidId: 'B1', justification: null, reportHash: 'cd'.repeat(32), createdAt: past } })] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    expect(await screen.findByText('Evaluation report hash')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record recommendation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    expect(screen.getByRole('button', { name: 'Save my score' })).toBeDisabled();
  });
});

const contract = (over = {}) => ({
  awardId: 'AWD-1', tenderRef: REF, title: 'Solar panels', bidId: 'B1', supplierRef: 'SUP-B1', amountNgwee: 8_200_000,
  evalHash: 'cd'.repeat(32), awardTxId: 'tx1', awardedAt: past, standstillEnds: past, status: 'AWARDED', inspector: null,
  milestones: [], ledger: { status: 'AWARDED', contractValue: 8_200_000, paidTotal: 0 }, alerts: [], ...over,
});

describe('officer', () => {
  test('signs only when the milestones add up to the contract value', async () => {
    serve(OFFICER, { 'GET /contracts/detail?awardId=AWD-1': [200, contract()], 'GET /contracts/inspectors': [200, [{ id: 'i1', name: 'Bwalya Kunda' }]],
      'POST /contracts/sign': [200, contract({ status: 'SIGNED' })] });
    at('/contracts/detail?id=AWD-1');
    const sign = await screen.findByRole('button', { name: 'Sign contract' });
    expect(sign).toBeEnabled(); // one milestone, prefilled with the full value
    fireEvent.click(screen.getByRole('button', { name: /Add milestone/ }));
    fireEvent.change(screen.getAllByLabelText('Amount (K)')[1], { target: { value: '100' } });
    expect(screen.getByText(/must equal the contract value/)).toBeInTheDocument();
    expect(sign).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText('Amount (K)')[0], { target: { value: '81900' } });
    expect(sign).toBeEnabled();
  });

  test('cannot sign during the standstill period', async () => {
    serve(OFFICER, { 'GET /contracts/detail?awardId=AWD-1': [200, contract({ standstillEnds: future })], 'GET /contracts/inspectors': [200, []] });
    at('/contracts/detail?id=AWD-1');
    expect(await screen.findByText('Standstill period', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign contract' })).toBeDisabled();
  });

  test('sees why a payment is held, and that a high-risk alert holds the contract', async () => {
    serve(OFFICER, { 'GET /contracts/detail?awardId=AWD-1': [200, contract({ status: 'SIGNED',
      alerts: [{ id: 'ALT-1', subjectType: 'tender', score: 83, status: 'OPEN', raisedAt: past }],
      milestones: [{ milestoneId: 'MS-1', description: 'Delivery', amountNgwee: 8_200_000, dueDate: future, certifyTxId: 'tx5',
        certificateHash: 'ef'.repeat(32), certifiedBy: 'Bwalya Kunda', completionDate: past, paymentStatus: 'HELD', paymentNote: 'flagged as high risk (alert ALT-1)' }] })] });
    at('/contracts/detail?id=AWD-1');
    expect(await screen.findByText('Payments on this contract are held')).toBeInTheDocument();
    expect(screen.getByText('flagged as high risk (alert ALT-1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry payment' })).toBeInTheDocument();
  });
});

describe('inspector', () => {
  test('certifies a milestone and sees the payment result', async () => {
    const signed = contract({ status: 'SIGNED', inspector: { id: 'i1', name: 'Bwalya Kunda' },
      milestones: [{ milestoneId: 'MS-1', description: 'Delivery', amountNgwee: 8_200_000, dueDate: future, certifyTxId: null, paymentStatus: null }] });
    serve(INSPECTOR, { 'GET /contracts/detail?awardId=AWD-1': [200, signed], 'POST /contracts/certify': [200, {
      certifyTxId: 'tx7', certificateHash: '12'.repeat(32), payment: { status: 'PAID', ifmisRef: 'IFMIS-2026-000123' }, risk: { score: 22, alert: false } }] });
    at('/contracts/detail?id=AWD-1');
    expect(screen.queryByText('Sign the contract')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Certify' }));
    fireEvent.change(screen.getByLabelText('Signed completion certificate'), { target: { files: [new File(['c'], 'cert.pdf')] } });
    submit('Certify and request payment');
    expect(await screen.findByText('Paid through IFMIS: IFMIS-2026-000123')).toBeInTheDocument();
    const sent = calls.find((c) => c.path === '/contracts/certify').body;
    expect(sent.get('milestoneId')).toBe('MS-1');
    expect(sent.get('certificate').name).toBe('cert.pdf');
  });

  test('cannot reach the evaluation', async () => {
    serve(INSPECTOR, { 'GET /dashboard': [200, { figures: {} }], 'GET /contracts': [200, []] });
    at(`/evaluation/tender?ref=${encodeURIComponent(REF)}`);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
