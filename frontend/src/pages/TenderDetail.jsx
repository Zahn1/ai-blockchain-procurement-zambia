// One tender as the ledger holds it (3.5.3): its record, every version, the sealed bids, and a document check.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { kwacha, tenderStage, when } from '../lib/format.js';
import { BackLink, Badge, Button, ButtonLink, Card, Details, Field, Hash, Message, PageHeader, Spinner, Table } from '../components/ui.jsx';

function VerifyDocument({ reference }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    const data = new FormData();
    data.set('reference', reference);
    data.set('document', file);
    try { setResult(await api('/verify', { form: data })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Card title="Check a document" description="Is a copy you hold the one that was published? Its hash is compared with the ledger.">
      <form onSubmit={check} className="space-y-4">
        <Field label="Document" id="verify-file">
          <input id="verify-file" type="file" required onChange={(e) => { setFile(e.target.files[0] ?? null); setResult(null); }}
            className="block w-full text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-50" />
        </Field>
        <Button type="submit" variant="secondary" busy={busy}>Check against the ledger</Button>
        {error && <Message tone="error">{error}</Message>}
        {result && (result.matches
          ? <Message tone="success" title="Matches the ledger">This is the document that was published. SHA-256 <code className="break-all font-mono text-xs">{result.hash}</code></Message>
          : <Message tone="error" title="Does not match">This file differs from the published document. Its SHA-256 is <code className="break-all font-mono text-xs">{result.hash}</code></Message>)}
      </form>
    </Card>
  );
}

export default function TenderDetail() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const id = params.get('id');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/tender?id=${encodeURIComponent(id ?? '')}`).then(setData).catch((e) => setError(e.message)); }, [id]);

  const back = user.role === 'SUPPLIER' ? <BackLink to="/bids">My bids</BackLink> : <BackLink to="/tenders">Tenders</BackLink>;
  if (error) return <>{back}<Message tone="error" title="Tender not found">{error}</Message></>;
  if (!data) return <Spinner />;

  const { tender: t, history, bids, offChain } = data;
  const [stage, tone] = tenderStage(t.closingTime, t);
  const open = stage === 'Open for bids';
  const mine = (b) => user.supplierRef && b.supplierRef === user.supplierRef;

  return (
    <>
      {back}
      <PageHeader meta={<span className="font-mono normal-case tracking-normal">{t.id}</span>} title={offChain?.title || t.id}
        description={<Badge tone={tone}>{stage}</Badge>}
        actions={<>
          {offChain?.cid && <Button variant="secondary" onClick={() => window.open(`/api/ipfs/${offChain.cid}`, '_blank', 'noopener')}><Download className="h-4 w-4" aria-hidden /> Tender document</Button>}
          {open && user.role === 'SUPPLIER' && !bids.some(mine) && <ButtonLink to={`/bids/new?tender=${encodeURIComponent(t.id)}`}><Send className="h-4 w-4" aria-hidden /> Submit a sealed bid</ButtonLink>}
        </>} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Ledger record">
            <Details items={[
              ['Estimated value', kwacha(t.estValue)],
              ['Closes', when(t.closingTime)],
              ['Published by', t.publishedBy === 'ZPPAMSP' ? 'ZPPA' : t.publishedBy],
              ['Version', t.version],
              ['Committee approvals to open bids', `${t.approvals.length} of ${t.quorum}`],
              ['Bids opened', t.openingApproved ? 'Yes' : 'No'],
              ['Document hash (SHA-256)', <Hash value={t.docHashes[0]} n={24} />],
              offChain && ['Publishing transaction', <Hash value={offChain.txId} n={24} />],
            ]} />
          </Card>

          <Card title={`Sealed bids (${bids.length})`} description="Each bid is encrypted before it leaves the server; only its hash is on the ledger." padded={false}>
            <Table rows={bids} rowKey={(b) => b.id} empty={open ? 'No bids yet.' : 'No bids were received.'} columns={[
              { key: 'id', label: 'Bid', mono: true, render: (b) => <>{b.id}{mine(b) && <span className="ml-2 font-sans text-slate-500">(yours)</span>}</> },
              { key: 'supplierRef', label: 'Bidder code', mono: true },
              { key: 'submittedAt', label: 'Submitted', nowrap: true, render: (b) => when(b.submittedAt) },
              { key: 'cipherHash', label: 'Encrypted file hash', render: (b) => <Hash value={b.cipherHash} /> },
              { key: 'opened', label: 'Status', render: (b) => (b.opened ? <Badge tone="info">Opened</Badge> : <Badge>Sealed</Badge>) },
            ]} />
          </Card>

          <Card title="Version history" description="Every change to this tender is a new ledger transaction; earlier versions cannot be altered." padded={false}>
            <Table rows={[...history].reverse()} rowKey={(h) => h.txId} columns={[
              { key: 'version', label: 'Version', align: 'right', render: (h) => h.tender?.version ?? '–' },
              { key: 'timestamp', label: 'Recorded', nowrap: true, render: (h) => when(h.timestamp) },
              { key: 'status', label: 'Ledger status', render: (h) => <span className="font-mono text-xs">{h.tender?.status}</span> },
              { key: 'change', label: 'Change', wide: true, render: (h) => describe(h, history) },
              { key: 'txId', label: 'Transaction', render: (h) => <Hash value={h.txId} /> },
            ]} />
          </Card>
        </div>
        <VerifyDocument reference={t.id} />
      </div>
    </>
  );
}

/** What a version changed, compared with the one before it. */
function describe(h, history) {
  const i = history.findIndex((x) => x.txId === h.txId);
  const now = h.tender;
  const before = history[i - 1]?.tender;
  if (!before) return 'Published';
  if (now.status !== before.status) return now.status === 'AWARDED' ? 'Contract awarded' : now.status === 'CANCELLED' ? 'Cancelled' : `Status: ${now.status}`;
  if (now.openingApproved && !before.openingApproved) return 'Committee quorum reached; bids may be opened';
  if (now.approvals.length > before.approvals.length) return `Committee approval ${now.approvals.length} of ${now.quorum}`;
  return 'Updated';
}
