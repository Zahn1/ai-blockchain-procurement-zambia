// User administration (3.5.1): create staff accounts, change roles, suspend or reactivate, and reset a lost authenticator.
// Bidders are not created here: they register themselves so PACRA and ZRA can verify their company (3.5.2).
import { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_NAMES } from '../lib/format.js';
import { Badge, Button, Card, Field, Input, Message, PageHeader, Select, Spinner, Table } from '../components/ui.jsx';

const STAFF_ROLES = ['OFFICER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR', 'ADMIN'];
const MIN_PASSWORD = 10; // as the back end requires
const SIGNS_ON_LEDGER = ['COMMITTEE', 'INSPECTOR', 'REGULATOR']; // each gets their own ledger identity

function AddUser({ entities, onAdded, onCancel }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'OFFICER', entityId: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { onAdded(await api('/admin/users', { body: form })); } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Card title="Add a user" description="They set up their authenticator app at their first sign-in." actions={<Button variant="ghost" onClick={onCancel}>Cancel</Button>}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Full name" id="u-name"><Input id="u-name" required value={form.name} onChange={set('name')} /></Field>
          <Field label="Email" id="u-email"><Input id="u-email" type="email" required autoComplete="off" value={form.email} onChange={set('email')} /></Field>
          <Field label="Role" id="u-role" hint={SIGNS_ON_LEDGER.includes(form.role) ? 'Gets their own ledger identity to sign with' : null}>
            <Select id="u-role" value={form.role} onChange={set('role')}>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
            </Select>
          </Field>
          <Field label="Procuring entity" id="u-entity" hint={form.role === 'OFFICER' ? 'Required for a procurement officer' : 'Optional'}>
            <Select id="u-entity" required={form.role === 'OFFICER'} value={form.entityId} onChange={set('entityId')}>
              <option value="">None</option>
              {entities.filter((x) => x.status === 'ACTIVE').map((x) => <option key={x.id} value={x.id}>{x.code} – {x.name}</option>)}
            </Select>
          </Field>
          <Field label="Mobile number" id="u-phone" hint="For SMS notifications, e.g. +260971234567. Optional.">
            <Input id="u-phone" type="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Starting password" id="u-password" hint={`At least ${MIN_PASSWORD} characters. Give it to the user privately.`}>
            <Input id="u-password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
        </div>
        {error && <Message tone="error">{error}</Message>}
        <Button type="submit" busy={busy}>Add user</Button>
      </form>
    </Card>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [entities, setEntities] = useState([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => api('/admin/users').then(setUsers).catch((e) => setNotice(['error', e.message])), []);
  useEffect(() => { load(); api('/admin/entities').then(setEntities).catch(() => {}); }, [load]);

  async function change(u, body, done) {
    setNotice(null);
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); setNotice(['success', done]); await load(); } catch (err) { setNotice(['error', err.message]); }
  }
  async function resetCode(u) {
    if (!window.confirm(`Reset ${u.name}'s authenticator? They will scan a new QR code at their next sign-in.`)) return;
    setNotice(null);
    try { await api(`/admin/users/${u.id}/reset-code`, { method: 'POST' }); setNotice(['success', `${u.name} will set up their authenticator again at their next sign-in.`]); await load(); } catch (err) { setNotice(['error', err.message]); }
  }

  const rows = (users ?? []).filter((u) => (!role || u.role === role) && `${u.name} ${u.email} ${u.companyName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader title="Users" description="Each role sees only its own functions. Every change is written to the audit log."
        actions={!adding && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add user</Button>} />
      {notice && <div className="mb-4"><Message tone={notice[0]}>{notice[1]}</Message></div>}
      {adding && (
        <div className="mb-6">
          <AddUser entities={entities} onCancel={() => setAdding(false)}
            onAdded={async (u) => { setAdding(false); setNotice(['success', `${u.name} was added as ${ROLE_NAMES[u.role].toLowerCase()}.`]); await load(); }} />
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search users" placeholder="Search by name, email or company" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <div className="w-48">
            <Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option>
              {[...STAFF_ROLES, 'SUPPLIER'].map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
            </Select>
          </div>
        </div>
        {!users ? <Spinner /> : (
          <Table rows={rows} rowKey={(u) => u.id} empty="No users match." columns={[
            { key: 'name', label: 'Name', render: (u) => <>{u.name}{u.id === me.id && <span className="ml-1 text-slate-500">(you)</span>}<br /><span className="text-xs text-slate-500">{u.email}</span></> },
            { key: 'role', label: 'Role', render: (u) => (u.role === 'SUPPLIER' || u.id === me.id
              ? <>{ROLE_NAMES[u.role]}{u.companyName && <><br /><span className="text-xs text-slate-500">{u.companyName}</span></>}</>
              : (
                <Select aria-label={`Role of ${u.name}`} value={u.role} className="min-w-44 py-1.5"
                  onChange={(e) => change(u, { role: e.target.value }, `${u.name} is now ${ROLE_NAMES[e.target.value].toLowerCase()}.`)}>
                  {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                </Select>
              )) },
            { key: 'entity', label: 'Entity', mono: true, render: (u) => u.entity ?? '–' },
            { key: 'ledger', label: 'Ledger identity', mono: true, render: (u) => u.fabricIdentity ?? '–' },
            { key: 'totp', label: 'Authenticator', render: (u) => (u.totpEnabled ? <Badge tone="success">Set up</Badge> : <Badge>At next sign-in</Badge>) },
            { key: 'status', label: 'Status', render: (u) => (u.status === 'ACTIVE' ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>) },
            { key: 'actions', label: '', align: 'right', render: (u) => u.id !== me.id && (
              <span className="flex justify-end gap-2">
                {u.totpEnabled && <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => resetCode(u)}>Reset code</Button>}
                {u.status === 'ACTIVE'
                  ? <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => change(u, { status: 'SUSPENDED' }, `${u.name} is suspended and can no longer sign in.`)}>Suspend</Button>
                  : <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => change(u, { status: 'ACTIVE' }, `${u.name} is active again.`)}>Reactivate</Button>}
              </span>
            ) },
          ]} />
        )}
      </Card>
      {users && <p className="mt-3 text-xs text-slate-500">{rows.length} of {users.length} users, newest first</p>}
    </>
  );
}
