// Registered bidders (3.5.2), checked against PACRA and ZRA, and the procuring entities officers belong to (3.5.1).
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { day } from '../lib/format.js';
import { Badge, Button, Card, Field, Input, Message, PageHeader, Spinner, Table } from '../components/ui.jsx';

function Bidders() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => api('/admin/suppliers').then(setRows).catch((e) => setNotice(['error', e.message])), []);
  useEffect(() => { load(); }, [load]);

  async function reverify(s) {
    setBusy(s.pacraNumber);
    setNotice(null);
    try {
      const r = await api(`/admin/suppliers/${encodeURIComponent(s.pacraNumber)}/reverify`, { method: 'POST' });
      setNotice(r.status === 'VERIFIED'
        ? ['success', `${r.companyName} is verified with PACRA and ZRA.`]
        : ['warning', `${r.companyName} is suspended from bidding: ${r.problems.join(' ')}`]);
      await load();
    } catch (err) { setNotice(['error', err.message]); } finally { setBusy(''); }
  }

  return (
    <Card title="Registered bidders" description="Verified against PACRA (company registration) and ZRA (tax clearance) at registration, and again on request. A bidder whose clearance has expired cannot bid." padded={false}>
      {notice && <div className="border-b border-slate-200 p-4"><Message tone={notice[0]}>{notice[1]}</Message></div>}
      {!rows ? <Spinner /> : (
        <Table rows={rows} rowKey={(s) => s.pacraNumber} empty="No bidders have registered yet." columns={[
          { key: 'companyName', label: 'Company', render: (s) => <>{s.companyName}<br /><span className="text-xs text-slate-500">{s.users.join(', ')}</span></> },
          { key: 'pacraNumber', label: 'PACRA number', mono: true },
          { key: 'tpin', label: 'TPIN', mono: true },
          { key: 'supplierRef', label: 'Ledger code', mono: true },
          { key: 'clearance', label: 'Tax clearance', nowrap: true, render: (s) => {
            const expired = new Date(s.taxClearanceExpiry) < new Date();
            return <span className={expired ? 'font-medium text-red-700' : ''}>{expired ? 'Expired ' : 'Until '}{day(s.taxClearanceExpiry)}</span>;
          } },
          { key: 'status', label: 'Status', render: (s) => (s.status === 'VERIFIED' ? <Badge tone="success">Verified</Badge> : <Badge tone="danger">Suspended</Badge>) },
          { key: 'verifiedAt', label: 'Last checked', nowrap: true, render: (s) => day(s.verifiedAt) },
          { key: 'action', label: '', align: 'right', render: (s) => <Button variant="secondary" className="min-h-8 px-3 py-1" busy={busy === s.pacraNumber} disabled={!!busy} onClick={() => reverify(s)}>Check again</Button> },
        ]} />
      )}
    </Card>
  );
}

function Entities() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => api('/admin/entities').then(setRows).catch((e) => setNotice(['error', e.message])), []);
  useEffect(() => { load(); }, [load]);

  async function run(fn, done) {
    setNotice(null);
    try { await fn(); setNotice(['success', done]); await load(); return true; } catch (err) { setNotice(['error', err.message]); return false; }
  }

  return (
    <Card title="Procuring entities" description="Ministries and agencies that publish tenders. Each procurement officer belongs to one." padded={false}
      actions={!adding && <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add entity</Button>}>
      {adding && (
        <form className="grid grid-cols-1 items-end gap-3 border-b border-slate-200 p-5 sm:grid-cols-[8rem_1fr_auto_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api('/admin/entities', { body: form }), `${form.code.toUpperCase()} was added.`)) { setForm({ code: '', name: '' }); setAdding(false); }
          }}>
          <Field label="Code" id="e-code"><Input id="e-code" required maxLength={12} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="font-mono uppercase" placeholder="MOH" /></Field>
          <Field label="Name" id="e-name"><Input id="e-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ministry of Health" /></Field>
          <Button type="submit">Add</Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </form>
      )}
      {notice && <div className="border-b border-slate-200 p-4"><Message tone={notice[0]}>{notice[1]}</Message></div>}
      {!rows ? <Spinner /> : (
        <Table rows={rows} rowKey={(x) => x.id} empty="No procuring entities yet." columns={[
          { key: 'code', label: 'Code', mono: true },
          { key: 'name', label: 'Name', wide: true },
          { key: 'status', label: 'Status', render: (x) => (x.status === 'ACTIVE' ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>) },
          { key: 'action', label: '', align: 'right', render: (x) => (
            <Button variant="secondary" className="min-h-8 px-3 py-1"
              onClick={() => run(() => api(`/admin/entities/${x.id}`, { method: 'PATCH', body: { status: x.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } }),
                `${x.code} is ${x.status === 'ACTIVE' ? 'suspended' : 'active again'}.`)}>
              {x.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>) },
        ]} />
      )}
    </Card>
  );
}

export default function AdminBidders() {
  return (
    <>
      <PageHeader title="Bidders and entities" description="Bidders register themselves; the system checks each company with PACRA and ZRA before it can bid." />
      <div className="space-y-6">
        <Bidders />
        <Entities />
      </div>
    </>
  );
}
