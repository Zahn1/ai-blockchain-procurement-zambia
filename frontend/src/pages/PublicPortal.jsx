// Public verification portal and open data (3.5.9). No sign-in: anyone can search tenders, contracts and payments,
// check a document against its hash on the ledger, and download the data in OCDS. Companies appear; people and bid contents do not.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileCheck2, Search } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { day, kwacha, when } from '../lib/format.js';
import { Badge, Button, Card, Field, Input, Message, PageHeader, Spinner, Table, fileInputClass } from '../components/ui.jsx';

const TABS = [['search', 'Search records'], ['verify', 'Check a document'], ['data', 'Open data']];

function Records({ verify }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [query, setQuery] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api(`/public/search?q=${encodeURIComponent(q)}`).then(setData).catch((e) => setError(e.message)); }, [q]);

  return (
    <div className="space-y-6">
      <form className="flex max-w-2xl gap-2" onSubmit={(e) => { e.preventDefault(); setParams({ tab: 'search', q: query.trim() }); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input aria-label="Search public records" placeholder="Tender reference, title, company or IFMIS reference" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {error && <Message tone="error">{error}</Message>}
      {!data ? <Spinner /> : (
        <>
          {q && <p className="text-sm text-slate-600">{data.tenders.length + data.contracts.length + data.payments.length} records match “{q}”.</p>}
          <Card title={`Tenders (${data.tenders.length})`} padded={false}>
            <Table rows={data.tenders} rowKey={(t) => t.reference} empty="No tenders match." columns={[
              { key: 'reference', label: 'Reference', mono: true },
              { key: 'title', label: 'Title', wide: true },
              { key: 'buyer', label: 'Buyer', render: (t) => t.buyer ?? '–' },
              { key: 'closingTime', label: 'Closes', nowrap: true, render: (t) => when(t.closingTime) },
              { key: 'status', label: 'Status', render: (t) => (t.awarded ? <Badge tone="brand">Awarded</Badge> : new Date(t.closingTime) > new Date() ? <Badge tone="success">Open for bids</Badge> : <Badge>Closed</Badge>) },
              { key: 'actions', label: '', align: 'right', render: (t) => (
                <span className="flex justify-end gap-1">
                  <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => verify({ kind: 'tender', reference: t.reference })}>Check document</Button>
                  <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => download(`/public/ocds?reference=${encodeURIComponent(t.reference)}`)} aria-label={`OCDS data for ${t.reference}`}>OCDS</Button>
                </span>) },
            ]} />
          </Card>
          <Card title={`Contracts (${data.contracts.length})`} padded={false}>
            <Table rows={data.contracts} rowKey={(c) => c.awardId} empty="No contracts match." columns={[
              { key: 'awardId', label: 'Award', mono: true },
              { key: 'title', label: 'Tender', wide: true, render: (c) => <>{c.title}<br /><span className="font-mono text-xs text-slate-500">{c.tenderRef}</span></> },
              { key: 'supplier', label: 'Supplier', render: (c) => c.supplier ?? '–' },
              { key: 'value', label: 'Value', align: 'right', render: (c) => kwacha(c.value) },
              { key: 'paid', label: 'Milestones paid', align: 'right', render: (c) => (c.milestones ? `${c.paid} of ${c.milestones}` : '–') },
              { key: 'actions', label: '', align: 'right', render: (c) => c.signedAt && (
                <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => verify({ kind: 'contract', awardId: c.awardId })}>Check contract</Button>) },
            ]} />
          </Card>
          <Card title={`Payments (${data.payments.length})`} padded={false}>
            <Table rows={data.payments} rowKey={(p) => `${p.awardId}-${p.milestoneId}`} empty="No payments match." columns={[
              { key: 'ifmisRef', label: 'IFMIS reference', mono: true },
              { key: 'title', label: 'For', wide: true, render: (p) => <>{p.description}<br /><span className="text-xs text-slate-500">{p.title} · <span className="font-mono">{p.awardId} {p.milestoneId}</span></span></> },
              { key: 'amount', label: 'Amount', align: 'right', render: (p) => kwacha(p.amount) },
              { key: 'paidAt', label: 'Paid', nowrap: true, render: (p) => day(p.paidAt) },
              { key: 'actions', label: '', align: 'right', render: (p) => (
                <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => verify({ kind: 'certificate', awardId: p.awardId, milestoneId: p.milestoneId })}>Check certificate</Button>) },
            ]} />
          </Card>
        </>
      )}
    </div>
  );
}

const KINDS = { tender: 'Tender document', contract: 'Signed contract', certificate: 'Completion certificate' };

function Verify({ initial }) {
  const [form, setForm] = useState({ kind: 'tender', reference: '', awardId: '', milestoneId: '', ...initial });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setResult(null); };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    const data = new FormData();
    for (const [k, v] of Object.entries(form)) data.set(k, v.trim());
    data.set('document', file);
    try { setResult(await api('/public/verify', { form: data })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card title="Check a document against the ledger" className="lg:col-span-3"
        description="The file is hashed (SHA-256) and the hash compared with the one recorded when it was published. The file itself is not stored.">
        <form onSubmit={submit} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">What are you checking?</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(KINDS).map(([k, label]) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors duration-150 ${form.kind === k ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                  <input type="radio" name="kind" value={k} checked={form.kind === k} onChange={set('kind')} className="accent-brand-700" /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          {form.kind === 'tender' ? (
            <Field label="Tender reference" id="v-ref"><Input id="v-ref" required value={form.reference} onChange={set('reference')} className="font-mono" placeholder="ZPPA/MOH/2026/F0001" /></Field>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Award ID" id="v-award"><Input id="v-award" required value={form.awardId} onChange={set('awardId')} className="font-mono" placeholder="AWD-1823F9" /></Field>
              {form.kind === 'certificate' && <Field label="Milestone" id="v-ms"><Input id="v-ms" required value={form.milestoneId} onChange={set('milestoneId')} className="font-mono" placeholder="MS-1" /></Field>}
            </div>
          )}
          <Field label="File" id="v-file"><input id="v-file" type="file" required onChange={(e) => { setFile(e.target.files[0] ?? null); setResult(null); }} className={fileInputClass} /></Field>
          {error && <Message tone="error">{error}</Message>}
          <Button type="submit" busy={busy}><FileCheck2 className="h-4 w-4" aria-hidden /> Check</Button>
        </form>
      </Card>
      <div className="lg:col-span-2">
        {result ? (
          <Card title={result.matches ? 'Matches the ledger' : 'Does not match'} className={result.matches ? 'border-emerald-600' : 'border-red-600'}>
            <div className="space-y-4 text-sm">
              <Message tone={result.matches ? 'success' : 'error'}>
                {result.matches ? `This file is the ${result.record} as recorded on the ledger.` : `This file is not the ${result.record} recorded on the ledger. It may have been altered.`}
              </Message>
              <div><p className="text-xs font-medium text-slate-500">Your file's SHA-256</p><p className="mt-0.5 break-all font-mono text-xs">{result.hash}</p></div>
              <div><p className="text-xs font-medium text-slate-500">On the ledger</p>{result.onLedger.map((h) => <p key={h} className="mt-0.5 break-all font-mono text-xs">{h}</p>)}</div>
            </div>
          </Card>
        ) : (
          <Card title="Why this matters">
            <p className="text-sm text-slate-600">A document's SHA-256 hash changes completely if even one character changes. Because the hash was written to a ledger shared by ZPPA and the Office of the Auditor General when the document was published, nobody can quietly swap in a different version.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function OpenData() {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Open Contracting Data Standard (OCDS 1.1)">
      <div className="max-w-3xl space-y-4 text-sm text-slate-700">
        <p>Every procurement as a compiled OCDS release: the tender with its amendments and document hashes, the award, the contract with its milestones, and each payment made through IFMIS. It is built from the ledger when you download it.</p>
        <p>Bid contents and personal data are not published. Companies are named, as in award notices; individual people are not.</p>
        <p className="text-slate-600">Licence: <a className="font-medium text-brand-700 hover:underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution 4.0</a>. One procurement can be downloaded from its row under Search records.</p>
        <Button busy={busy} onClick={async () => { setBusy(true); try { await download('/public/ocds'); } finally { setBusy(false); } }}>
          <Download className="h-4 w-4" aria-hidden /> Download all procurements (JSON)
        </Button>
      </div>
    </Card>
  );
}

export default function PublicPortal() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'search';
  const [check, setCheck] = useState({});
  const verify = (initial) => { setCheck(initial); setParams({ tab: 'verify' }); };

  return (
    <>
      <PageHeader title="Public procurement records" description="Search tenders, contracts and payments, check that a document is genuine, and download the data. No account needed." />
      <div role="tablist" aria-label="Public portal" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setParams({ tab: k })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${tab === k ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'search' && <Records verify={verify} />}
      {tab === 'verify' && <Verify key={JSON.stringify(check)} initial={check} />}
      {tab === 'data' && <OpenData />}
    </>
  );
}
