// Officer's tender register (3.5.3): every published tender, with where it stands.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { tenderStage, when } from '../lib/format.js';
import { Badge, ButtonLink, Card, Input, Message, PageHeader, Select, Spinner, Table } from '../components/ui.jsx';

export const tenderLink = (reference) => `/tender?id=${encodeURIComponent(reference)}`;

export default function Tenders() {
  const [tenders, setTenders] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  useEffect(() => { api('/tenders').then(setTenders).catch((e) => setError(e.message)); }, []);

  const rows = (tenders ?? []).filter((t) => {
    const text = `${t.reference} ${t.title}`.toLowerCase();
    const open = new Date(t.closingTime) > new Date();
    return text.includes(q.trim().toLowerCase()) && (show === 'all' || (show === 'open') === open);
  });

  return (
    <>
      <PageHeader title="Tenders" description="Each tender's document is stored on IPFS and its SHA-256 hash and closing time are recorded on the ledger."
        actions={<ButtonLink to="/tenders/new"><Plus className="h-4 w-4" aria-hidden /> Publish tender</ButtonLink>} />
      {error && <Message tone="error">{error}</Message>}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="Search tenders" placeholder="Search by reference or title" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <div className="w-44">
            <Select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="all">All tenders</option>
              <option value="open">Open for bids</option>
              <option value="closed">Closed</option>
            </Select>
          </div>
        </div>
        {!tenders ? <Spinner /> : (
          <Table rows={rows} rowKey={(t) => t.reference} empty={tenders.length ? 'No tenders match.' : 'No tenders have been published yet.'} columns={[
            { key: 'reference', label: 'Reference', mono: true, render: (t) => <Link to={tenderLink(t.reference)} className="font-medium text-brand-700 hover:underline">{t.reference}</Link> },
            { key: 'title', label: 'Title', wide: true },
            { key: 'publishedAt', label: 'Published', nowrap: true, render: (t) => when(t.publishedAt) },
            { key: 'closingTime', label: 'Closes', nowrap: true, render: (t) => when(t.closingTime) },
            { key: 'stage', label: 'Status', render: (t) => { const [label, tone] = tenderStage(t.closingTime); return <Badge tone={tone}>{label}</Badge>; } },
            { key: 'block', label: 'Block', align: 'right', render: (t) => <span className="font-mono text-xs">{t.block}</span> },
          ]} />
        )}
      </Card>
    </>
  );
}
