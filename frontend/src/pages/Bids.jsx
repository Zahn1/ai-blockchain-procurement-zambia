// A bidder's own bids and the tenders open to them (3.5.4).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { when } from '../lib/format.js';
import { Badge, ButtonLink, Card, Hash, Message, PageHeader, Spinner, Table } from '../components/ui.jsx';
import { tenderLink } from './Tenders.jsx';

const OUTCOME = { Won: 'brand', Open: 'success', 'Under evaluation': 'info', 'Not successful': 'default' };

export default function Bids() {
  const { user } = useAuth();
  const [bids, setBids] = useState(null);
  const [tenders, setTenders] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/bids/mine').then(setBids).catch((e) => setError(e.message));
    api('/tenders').then(setTenders).catch((e) => setError(e.message));
  }, []);

  const open = (tenders ?? []).filter((t) => new Date(t.closingTime) > new Date());
  const bidOn = new Set((bids ?? []).map((b) => b.tenderRef));

  return (
    <>
      <PageHeader title="My bids" description={`${user.companyName} bids under the ledger code ${user.supplierRef}; your company name is never written to the ledger.`} />
      {error && <Message tone="error">{error}</Message>}
      <div className="space-y-6">
        <Card title="Open tenders" description="Bids are encrypted on submission and cannot be opened before the closing time." padded={false}>
          {!tenders ? <Spinner /> : (
            <Table rows={open} rowKey={(t) => t.reference} empty="No tenders are open at the moment." columns={[
              { key: 'reference', label: 'Reference', mono: true, render: (t) => <Link to={tenderLink(t.reference)} className="font-medium text-brand-700 hover:underline">{t.reference}</Link> },
              { key: 'title', label: 'Title', wide: true },
              { key: 'closingTime', label: 'Closes', nowrap: true, render: (t) => when(t.closingTime) },
              { key: 'action', label: '', align: 'right', render: (t) => (bidOn.has(t.reference)
                ? <Badge tone="success">Bid submitted</Badge>
                : <ButtonLink variant="secondary" to={`/bids/new?tender=${encodeURIComponent(t.reference)}`} className="min-h-8 px-3 py-1">Submit bid</ButtonLink>) },
            ]} />
          )}
        </Card>

        <Card title="Bids submitted" padded={false}>
          {!bids ? <Spinner /> : (
            <Table rows={bids} rowKey={(b) => b.bidId} empty="You have not submitted a bid yet." columns={[
              { key: 'bidId', label: 'Bid', mono: true },
              { key: 'title', label: 'Tender', wide: true, render: (b) => <Link to={tenderLink(b.tenderRef)} className="hover:underline">{b.title}<br /><span className="font-mono text-xs text-slate-500">{b.tenderRef}</span></Link> },
              { key: 'submittedAt', label: 'Submitted', nowrap: true, render: (b) => when(b.submittedAt) },
              { key: 'cipherHash', label: 'Encrypted file hash', render: (b) => <Hash value={b.cipherHash} /> },
              { key: 'outcome', label: 'Status', render: (b) => <Badge tone={OUTCOME[b.outcome]}>{b.outcome}</Badge> },
            ]} />
          )}
        </Card>
      </div>
    </>
  );
}
