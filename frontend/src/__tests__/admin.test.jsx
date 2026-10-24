// Front end, step 4b: the administrator manages users and entities (3.5.1), re-checks bidders (3.5.2) and reads the audit log.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { at, calls, serve, submit } from './helpers.jsx';

const ADMIN = { id: 'a1', name: 'System Administrator', role: 'ADMIN' };
const USERS = [
  { id: 'a1', name: 'System Administrator', email: 'admin@zppa.test', role: 'ADMIN', status: 'ACTIVE', totpEnabled: true, entity: null, fabricIdentity: null },
  { id: 'u1', name: 'Mwila Banda', email: 'officer@moh.test', role: 'OFFICER', status: 'ACTIVE', totpEnabled: true, entity: 'MOH', fabricIdentity: null },
  { id: 'u2', name: 'Grace Mulenga', email: 'grace@alpha.test', role: 'SUPPLIER', status: 'ACTIVE', totpEnabled: false, companyName: 'Alpha Computers Limited', entity: null, fabricIdentity: null },
];
const ENTITIES = [{ id: 'e1', code: 'MOH', name: 'Ministry of Health', status: 'ACTIVE' }];
const routes = (extra = {}) => ({ 'GET /admin/users': [200, USERS], 'GET /admin/entities': [200, ENTITIES], ...extra });

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('users', () => {
  test('bidders and the administrator\'s own role cannot be changed here', async () => {
    serve(ADMIN, routes());
    at('/admin/users');
    expect(await screen.findByLabelText('Role of Mwila Banda')).toHaveValue('OFFICER');
    expect(screen.queryByLabelText('Role of Grace Mulenga')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role of System Administrator')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Suspend' })).toHaveLength(2); // not themselves
  });

  test('suspending a user is sent to the server and confirmed', async () => {
    serve(ADMIN, routes({ 'PATCH /admin/users/u1': [200, { ...USERS[1], status: 'SUSPENDED' }] }));
    at('/admin/users');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Suspend' }))[0]);
    expect(await screen.findByText('Mwila Banda is suspended and can no longer sign in.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/admin/users/u1', body: JSON.stringify({ status: 'SUSPENDED' }) });
  });

  test('a new procurement officer needs an entity; bidders cannot be added here', async () => {
    serve(ADMIN, routes({ 'POST /admin/users': [201, { id: 'u9', name: 'Jane Phiri', role: 'OFFICER' }] }));
    at('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: /Add user/ }));
    expect(screen.getByLabelText('Procuring entity')).toBeRequired();
    expect([...screen.getByLabelText('Role').options].map((o) => o.value)).not.toContain('SUPPLIER');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'REGULATOR' } });
    expect(screen.getByLabelText('Procuring entity')).not.toBeRequired();
    expect(screen.getByText('Gets their own ledger identity to sign with')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'OFFICER' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Jane Phiri' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@moh.test' } });
    fireEvent.change(screen.getByLabelText('Procuring entity'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Starting password'), { target: { value: 'a-long-start-pass' } });
    submit('Add user');
    expect(await screen.findByText('Jane Phiri was added as procurement officer.')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.path === '/admin/users' && c.method === 'POST').body)).toMatchObject({ role: 'OFFICER', entityId: 'e1' });
  });
});

describe('bidders and entities', () => {
  const SUPPLIERS = [
    { pacraNumber: '120260000101', companyName: 'Alpha Computers Limited', tpin: '1000000101', supplierRef: 'SUP-A', status: 'VERIFIED',
      taxClearanceExpiry: '2027-03-31T21:59:59Z', verifiedAt: '2026-10-18T07:00:00Z', users: ['grace@alpha.test'] },
    { pacraNumber: '120260000103', companyName: 'Charlie Supplies', tpin: '1000000103', supplierRef: 'SUP-C', status: 'SUSPENDED',
      taxClearanceExpiry: '2026-01-31T21:59:59Z', verifiedAt: '2026-10-18T07:00:00Z', users: ['c@charlie.test'] },
  ];

  test('an expired tax clearance stands out, and checking again shows why a company is suspended', async () => {
    serve(ADMIN, routes({ 'GET /admin/suppliers': [200, SUPPLIERS],
      'POST /admin/suppliers/120260000103/reverify': [200, { ...SUPPLIERS[1], problems: ['The ZRA tax clearance expired on 31 Jan 2026.'] }] }));
    at('/admin/bidders');
    expect(await screen.findByText(/Expired/)).toHaveClass('text-red-700');
    fireEvent.click(screen.getAllByRole('button', { name: 'Check again' })[1]);
    expect(await screen.findByText(/Charlie Supplies is suspended from bidding: The ZRA tax clearance expired/)).toBeInTheDocument();
  });

  test('adds a procuring entity', async () => {
    serve(ADMIN, routes({ 'GET /admin/suppliers': [200, []], 'POST /admin/entities': [201, { id: 'e2', code: 'MOE', name: 'Ministry of Education', status: 'ACTIVE' }] }));
    at('/admin/bidders');
    fireEvent.click(await screen.findByRole('button', { name: /Add entity/ }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'moe' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ministry of Education' } });
    submit('Add');
    expect(await screen.findByText('MOE was added.')).toBeInTheDocument();
  });
});

test('the audit log can be narrowed to failures', async () => {
  serve(ADMIN, { 'GET /admin/audit': [200, [
    { at: '2026-10-24T12:00:00Z', action: 'login.success', user: 'admin@zppa.test', detail: {}, ip: '127.0.0.1' },
    { at: '2026-10-24T11:00:00Z', action: 'login.failed', user: 'officer@moh.test', detail: { reason: 'wrong password' }, ip: '127.0.0.1' },
  ]] });
  at('/admin/audit');
  expect(await screen.findByText('login.success')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Failures only'));
  await waitFor(() => expect(screen.queryByText('login.success')).not.toBeInTheDocument());
  expect(screen.getByText('reason: wrong password')).toBeInTheDocument();
});
