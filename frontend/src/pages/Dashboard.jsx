// Each role's home: its figures, then the list it most needs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_NAMES, day, kwacha, kwachaShort, when } from '../lib/format.js';
import { contractLink, contractStage } from './Contracts.jsx';
import { Badge, Card, Figures, Message, PageHeader, Score, Spinner, Table } from '../components/ui.jsx';

// [label, value, tone, hint]: tone only when the figure needs someone's attention
const STATS = {
  OFFICER: (f) => [
    ['Open tenders', f.openTenders],
    ['Awaiting evaluation', f.awaitingEvaluation],
    ['Active contracts', f.activeContracts, null, f.valueAwardedNgwee ? `${kwachaShort(f.valueAwardedNgwee)} awarded in total` : null],
    ['Payments held', f.paymentsHeld, f.paymentsHeld && 'warning', 'Until a regulator decides on a risk alert'],
  ],
  SUPPLIER: (f) => [
    ['Open tenders', f.openTenders],
    ['My bids', f.myBids],
    ['Contracts won', f.contractsWon, null, f.valueWonNgwee ? kwacha(f.valueWonNgwee) : null],
    ['Paid to date', kwachaShort(f.paidNgwee)],
  ],
  COMMITTEE: (f) => [
    ['My tenders', f.tenders],
    ['Awaiting my approval', f.awaitingMyApproval, f.awaitingMyApproval && 'warning', 'Closed, opening not yet approved by you'],
    ['Bids to score', f.bidsAwaitingMyScore, f.bidsAwaitingMyScore && 'warning'],
    ['Recommended', f.recommended],
  ],
  INSPECTOR: (f) => [
    ['My contracts', f.contracts],
    ['Awaiting my certificate', f.awaitingCertificate, f.awaitingCertificate && 'warning'],
    ['Milestones certified', f.certified],
  ],
  REGULATOR: (f) => [
    ['Unreviewed alerts', f.unreviewedAlerts, f.unreviewedAlerts && 'danger'],
    ['High risk, unresolved', f.highRiskAlerts, f.highRiskAlerts && 'danger', 'Score 70 or above, unreviewed or referred'],
    ['Payments held', f.paymentsHeld, f.paymentsHeld && 'warning'],
    ['Contract value', kwachaShort(f.contractValueNgwee)],
  ],
  ADMIN: (f) => [
    ['Users', f.users],
    ['Suspended', f.suspendedUsers, f.suspendedUsers && 'warning'],
    ['Bidders', f.bidders, null, `${f.procuringEntities} procuring entities`],
    ['Failed sign-ins (24 h)', f.failedSignIns24h, f.failedSignIns24h && 'warning'],
  ],
};

function OpenTenders() {
  const [tenders, setTenders] = useState(null);
  useEffect(() => { api('/tenders').then(setTenders).catch(() => setTenders([])); }, []);
  if (!tenders) return <Spinner />;
  const open = tenders.filter((t) => new Date(t.closingTime) > new Date());
  return (
    <Table rows={open} rowKey={(t) => t.reference} empty="No tenders are open at the moment." columns={[
      { key: 'reference', label: 'Reference', mono: true },
      { key: 'title', label: 'Title' },
      { key: 'closingTime', label: 'Closes', nowrap: true, render: (t) => when(t.closingTime) },
    ]} />
  );
}

function RecentTenders() {
  const [tenders, setTenders] = useState(null);
  useEffect(() => { api('/tenders').then(setTenders).catch(() => setTenders([])); }, []);
  if (!tenders) return <Spinner />;
  const now = new Date();
  return (
    <Table rows={tenders.slice(0, 8)} rowKey={(t) => t.reference} empty="No tenders yet." columns={[
      { key: 'reference', label: 'Reference', mono: true },
      { key: 'title', label: 'Title' },
      { key: 'closingTime', label: 'Closes', nowrap: true, render: (t) => when(t.closingTime) },
      { key: 'status', label: 'Status', render: (t) => (new Date(t.closingTime) > now ? <Badge tone="success">Open</Badge> : <Badge>Closed</Badge>) },
    ]} />
  );
}

function TopAlerts() {
  const [alerts, setAlerts] = useState(null);
  useEffect(() => { api('/oversight/alerts').then(setAlerts).catch(() => setAlerts([])); }, []);
  if (!alerts) return <Spinner />;
  return (
    <Table rows={alerts.filter((a) => a.status === 'OPEN').slice(0, 6)} rowKey={(a) => a.id} empty="No unreviewed alerts." columns={[
      { key: 'id', label: 'Alert', mono: true },
      { key: 'subjectId', label: 'On', render: (a) => <span><span className="text-xs text-slate-500"><span className="capitalize">{a.subjectType}</span></span><br /><span className="font-mono text-xs">{a.subjectId}</span></span> },
      { key: 'score', label: 'Score', align: 'right', render: (a) => <Score value={a.score} /> },
      { key: 'why', label: 'Main reason', wide: true, render: (a) => a.explanation?.reasons?.[0]?.text ?? <span className="text-slate-400">–</span> },
    ]} />
  );
}

function MyBids() {
  const [bids, setBids] = useState(null);
  useEffect(() => { api('/bids/mine').then(setBids).catch(() => setBids([])); }, []);
  if (!bids) return <Spinner />;
  const tone = { Won: 'success', Open: 'info', 'Under evaluation': 'default', 'Not successful': 'default' };
  return (
    <Table rows={bids.slice(0, 6)} rowKey={(b) => b.bidId} empty="You have not bid yet." columns={[
      { key: 'title', label: 'Tender', render: (b) => <span>{b.title}<br /><span className="font-mono text-xs text-slate-500">{b.tenderRef}</span></span> },
      { key: 'submittedAt', label: 'Submitted', nowrap: true, render: (b) => day(b.submittedAt) },
      { key: 'outcome', label: 'Status', render: (b) => <Badge tone={tone[b.outcome]}>{b.outcome}</Badge> },
    ]} />
  );
}

function AuditTrail() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/admin/audit').then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <Spinner />;
  return (
    <Table rows={rows.slice(0, 8)} empty="No activity yet." columns={[
      { key: 'at', label: 'When', nowrap: true, render: (r) => when(r.at) },
      { key: 'action', label: 'Action', mono: true },
      { key: 'user', label: 'User', render: (r) => r.user ?? <span className="text-slate-400">system</span> },
    ]} />
  );
}

function MyContracts() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/contracts').then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <Spinner />;
  return (
    <Table rows={rows.slice(0, 8)} rowKey={(c) => c.awardId} empty="You have not been assigned a contract yet." columns={[
      { key: 'awardId', label: 'Award', mono: true, render: (c) => <Link to={contractLink(c.awardId)} className="font-medium text-brand-700 hover:underline">{c.awardId}</Link> },
      { key: 'title', label: 'Tender' },
      { key: 'todo', label: 'To certify', align: 'right', render: (c) => c.milestones.filter((m) => !m.certifyTxId).length },
      { key: 'stage', label: 'Status', render: (c) => { const [label, tone] = contractStage(c); return <Badge tone={tone}>{label}</Badge>; } },
    ]} />
  );
}

const PANELS = {
  OFFICER: ['Recent tenders', RecentTenders, '/tenders'],
  SUPPLIER: ['My recent bids', MyBids, '/bids'],
  COMMITTEE: ['Tenders', RecentTenders, '/evaluation'],
  INSPECTOR: ['My contracts', MyContracts, '/contracts'],
  REGULATOR: ['Unreviewed alerts', TopAlerts, '/oversight'],
  ADMIN: ['Recent activity', AuditTrail, '/admin/audit'],
};

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/dashboard').then(setData).catch((e) => setError(e.message)); }, []);
  const [title, Panel, more] = PANELS[user.role];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lusaka' });
  return (
    <>
      <PageHeader meta={today} title="Dashboard"
        description={user.role === 'SUPPLIER' ? `${user.companyName} · bidder reference ${user.supplierRef}` : `${ROLE_NAMES[user.role]} · ${user.name}`} />
      {error && <Message tone="error">{error}</Message>}
      {!data ? <Spinner /> : (
        <Figures items={STATS[user.role](data.figures).map(([label, value, tone, hint]) => ({ label, value, tone, hint }))} />
      )}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={title} padded={false} actions={<Link to={more} className="text-sm font-medium text-brand-700 hover:text-brand-800 hover:underline">View all</Link>}>
          <Panel />
        </Card>
        {user.role === 'SUPPLIER' ? (
          <Card title="Open tenders" padded={false}><OpenTenders /></Card>
        ) : (
          <Card title="Record integrity">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="font-medium text-slate-900">Shared ledger</dt>
                <dd className="mt-0.5 text-slate-600">Every tender, bid, award, certificate and payment is a transaction endorsed by both ZPPA and the Office of the Auditor General.</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Document fingerprints</dt>
                <dd className="mt-0.5 text-slate-600">Documents stay off the ledger; their SHA-256 hashes are on it, so any change is detected.</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Risk scoring</dt>
                <dd className="mt-0.5 text-slate-600">Each award and contract is scored. A score of 70 or above holds payment until a regulator decides.</dd>
              </div>
            </dl>
          </Card>
        )}
      </div>
    </>
  );
}
