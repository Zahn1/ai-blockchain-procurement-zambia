// The system's audit log (3.5.1, 3.5.8): sign-ins, failed attempts and every change, newest first.
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { when } from '../lib/format.js';
import { Card, Input, Message, PageHeader, Spinner, Table } from '../components/ui.jsx';

const FAILED = /failed|lockout|integrity/;

/** The detail object as short "key: value" text. */
const describe = (detail) => (detail && typeof detail === 'object'
  ? Object.entries(detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')
  : '');

export default function AuditLog() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  useEffect(() => { api('/admin/audit').then(setRows).catch((e) => setError(e.message)); }, []);

  const shown = (rows ?? []).filter((r) => (!failedOnly || FAILED.test(r.action))
    && `${r.action} ${r.user ?? ''} ${describe(r.detail)}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader title="Audit log" description="The latest 100 actions recorded by the system. Ledger transactions are listed in each procurement's history." />
      {error && <Message tone="error">{error}</Message>}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-5 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search the audit log" placeholder="Search by action, user or detail" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} className="h-4 w-4 accent-brand-700" />
            Failures only
          </label>
        </div>
        {!rows ? <Spinner /> : (
          <Table rows={shown} empty="Nothing matches." columns={[
            { key: 'at', label: 'When', nowrap: true, render: (r) => when(r.at) },
            { key: 'action', label: 'Action', mono: true, render: (r) => <span className={FAILED.test(r.action) ? 'font-medium text-red-700' : ''}>{r.action}</span> },
            { key: 'user', label: 'User', render: (r) => r.user ?? <span className="text-slate-500">system</span> },
            { key: 'detail', label: 'Detail', wide: true, render: (r) => <span className="break-all text-xs text-slate-600">{describe(r.detail)}</span> },
            { key: 'ip', label: 'IP address', mono: true, render: (r) => r.ip ?? '–' },
          ]} />
        )}
      </Card>
    </>
  );
}
