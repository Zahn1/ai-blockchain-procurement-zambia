// Front end, step 4c: the public portal (3.5.9) and bidder registration (3.5.2), both without signing in.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { at, calls, serve, submit } from './helpers.jsx';

const RESULTS = {
  tenders: [{ reference: 'ZPPA/T/1', title: 'Solar panels', buyer: 'Ministry of Health', closingTime: '2026-10-24T09:32:00Z', awarded: true }],
  contracts: [{ awardId: 'AWD-1', tenderRef: 'ZPPA/T/1', title: 'Solar panels', supplier: 'Alpha Computers Limited', value: 8_200_000, status: 'SIGNED', signedAt: '2026-10-24T09:41:00Z', milestones: 2, paid: 1 }],
  payments: [{ awardId: 'AWD-1', tenderRef: 'ZPPA/T/1', title: 'Solar panels', milestoneId: 'MS-1', description: 'Delivery of 40 kits', amount: 4_100_000, paidAt: '2026-10-24T12:08:00Z', ifmisRef: 'IFMIS-2026-000003' }],
};

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('public portal, signed out', () => {
  test('searches tenders, contracts and payments; companies are named', async () => {
    serve(null, { 'GET /public/search?q=solar': [200, RESULTS] });
    at('/public?q=solar');
    expect(await screen.findByText('3 records match “solar”.')).toBeInTheDocument();
    expect(screen.getByText('Alpha Computers Limited')).toBeInTheDocument();
    expect(screen.getByText('IFMIS-2026-000003')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument(); // the public frame, not the signed-in sidebar
  });

  test('"Check certificate" opens the document check with the record filled in, and a mismatch is reported', async () => {
    serve(null, { 'GET /public/search?q=': [200, RESULTS], 'POST /public/verify': [200, { kind: 'certificate',
      record: 'completion certificate for AWD-1 MS-1', hash: 'ff'.repeat(32), onLedger: ['2d'.repeat(32)], matches: false }] });
    at('/public');
    fireEvent.click(await screen.findByRole('button', { name: 'Check certificate' }));
    expect(screen.getByLabelText('Award ID')).toHaveValue('AWD-1');
    expect(screen.getByLabelText('Milestone')).toHaveValue('MS-1');
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File(['edited'], 'cert.txt')] } });
    submit('Check');
    expect(await screen.findByText('Does not match')).toBeInTheDocument();
    expect(screen.getByText(/It may have been altered/)).toBeInTheDocument();
    const sent = calls.find((c) => c.path === '/public/verify').body;
    expect([sent.get('kind'), sent.get('awardId'), sent.get('milestoneId')]).toEqual(['certificate', 'AWD-1', 'MS-1']);
  });

  test('open data explains what is and is not published', async () => {
    serve(null, {});
    at('/public?tab=data');
    expect(await screen.findByText(/Bid contents and personal data are not published/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download all procurements/ })).toBeInTheDocument();
  });
});

describe('bidder registration', () => {
  const fill = (password = 'a-long-password', confirm = password) => {
    fireEvent.change(screen.getByLabelText('PACRA registration number'), { target: { value: '120260000105' } });
    fireEvent.change(screen.getByLabelText('ZRA TPIN'), { target: { value: '1000000105' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Esther Banda' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'esther@echo.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
  };

  test('passwords must match before anything is sent', async () => {
    serve(null, {});
    at('/register');
    fill('a-long-password', 'a-different-one');
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  test('a company PACRA or ZRA cannot confirm is refused, with the reasons', async () => {
    serve(null, { 'POST /register/supplier': [422, { error: 'Registration could not be verified.', problems: ['The ZRA tax clearance expired on 30 June 2026.'] }] });
    at('/register');
    fill();
    submit('Register');
    expect(await screen.findByText('Your company could not be verified')).toBeInTheDocument();
    expect(screen.getByText('The ZRA tax clearance expired on 30 June 2026.')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.path === '/register/supplier').body)).not.toHaveProperty('confirm');
  });

  test('a verified company gets its ledger code', async () => {
    serve(null, { 'POST /register/supplier': [201, { companyName: 'Charlie General Supplies Limited', supplierRef: 'SUP-UW6ATU', email: 'chanda@charlie.test' }] });
    at('/register');
    fill();
    submit('Register');
    expect(await screen.findByText('Charlie General Supplies Limited is registered')).toBeInTheDocument();
    expect(screen.getByText('SUP-UW6ATU')).toBeInTheDocument();
  });
});
