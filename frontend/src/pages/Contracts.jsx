// Contracts (3.5.6): officers award recommended tenders and follow every contract; inspectors see the contracts they certify.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { day, kwacha } from '../lib/format.js';
import { Badge, Button, Card, Message, PageHeader, Spinner, Table } from '../components/ui.jsx';

export const contractLink = (awardId) => `/contracts/detail?id=${encodeURIComponent(awardId)}`;

/** Where a contract stands, in words. */
export function contractStage(c) {
  const ms = c.milestones ?? [];
  if (c.status === 'AWARDED') return new Date(c.standstillEnds) > new Date() ? ['Standstill period', 'warning'] : ['Awaiting signature', 'info'];
  if (ms.some((m) => m.paymentStatus === 'HELD')) return ['Payment held', 'danger'];
  if (ms.length && ms.every((m) => m.paymentStatus === 'PAID')) return ['Completed', 'brand'];
  return ['In delivery', 'success'];
}

function Awardable() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api('/contracts/awardable').then(setRows).catch(() => setRows([])); }, []);

  async function award(reference) {
    setBusy(reference);
    setError('');
    try {
      const c = await api('/contracts/award', { body: { reference } });
      navigate(contractLink(c.awardId), { state: { awarded: c } });
    } catch (err) {
      setError(err.fromLedger ? `The ledger refused the award: ${err.message}` : err.message);
      setBusy('');
    }
  }

  if (!rows?.length) return null;
  return (
    <Card title="Ready to award" description="The committee has recommended a bid. The award records the evaluation report's hash on the ledger and starts the standstill period." padded={false}>
      {error && <div className="border-b border-slate-200 p-4"><Message tone="error">{error}</Message></div>}
      <Table rows={rows} rowKey={(r) => r.reference} columns={[
        { key: 'reference', label: 'Tender', mono: true },
        { key: 'title', label: 'Title', wide: true },
        { key: 'bidId', label: 'Recommended bid', mono: true },
        { key: 'action', label: '', align: 'right', render: (r) => <Button busy={busy === r.reference} disabled={!!busy} className="min-h-8 px-3 py-1" onClick={() => award(r.reference)}>Award</Button> },
      ]} />
    </Card>
  );
}

export default function Contracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/contracts').then(setContracts).catch((e) => setError(e.message)); }, []);
  const officer = user.role === 'OFFICER';

  return (
    <>
      <PageHeader title="Contracts" description={officer
        ? 'Awards, signed contracts and milestone payments. A payment is made through IFMIS only when the ledger confirms the milestone is certified, within the terms and not flagged as high risk.'
        : 'Contracts you are the inspector for. Your signed completion certificate is checked against the milestone terms on the ledger.'} />
      {error && <Message tone="error">{error}</Message>}
      <div className="space-y-6">
        {officer && <Awardable />}
        <Card title={officer ? 'All contracts' : 'My contracts'} padded={false}>
          {!contracts ? <Spinner /> : (
            <Table rows={contracts} rowKey={(c) => c.awardId} empty={officer ? 'No contracts have been awarded yet.' : 'You have not been assigned a contract yet.'} columns={[
              { key: 'awardId', label: 'Award', mono: true, render: (c) => <Link to={contractLink(c.awardId)} className="font-medium text-brand-700 hover:underline">{c.awardId}</Link> },
              { key: 'title', label: 'Tender', wide: true, render: (c) => <>{c.title}<br /><span className="font-mono text-xs text-slate-500">{c.tenderRef}</span></> },
              { key: 'supplierRef', label: 'Bidder code', mono: true },
              { key: 'amount', label: 'Value', align: 'right', render: (c) => kwacha(c.amountNgwee) },
              { key: 'paid', label: 'Milestones paid', align: 'right', render: (c) => (c.milestones.length ? `${c.milestones.filter((m) => m.paymentStatus === 'PAID').length} of ${c.milestones.length}` : '–') },
              { key: 'awardedAt', label: 'Awarded', nowrap: true, render: (c) => day(c.awardedAt) },
              { key: 'stage', label: 'Status', render: (c) => { const [label, tone] = contractStage(c); return <Badge tone={tone}>{label}</Badge>; } },
            ]} />
          )}
        </Card>
      </div>
    </>
  );
}
