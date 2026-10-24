// Each role's home: its figures, then the list it most needs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, Building2, ClipboardCheck, FileSignature, Gavel, Hourglass, Send, ShieldAlert, Trophy, UserX, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { day, kwacha, kwachaShort, when } from '../lib/format.js';
import { Badge, Card, Message, PageHeader, Spinner, Stat, Table } from '../components/ui.jsx';

const STATS = {
  OFFICER: (f) => [
    ['Open tenders', f.openTenders, Gavel, 'brand'],
    ['Awaiting evaluation', f.awaitingEvaluation, Hourglass, 'default'],
    ['Active contracts', f.activeContracts, FileSignature, 'default'],
    ['Payments held', f.paymentsHeld, AlertTriangle, f.paymentsHeld ? 'warning' : 'default', 'Until a regulator decides on a risk alert'],
  ],
  SUPPLIER: (f) => [
    ['Open tenders', f.openTenders, Gavel, 'brand'],
    ['My bids', f.myBids, Send, 'default'],
    ['Contracts won', f.contractsWon, Trophy, 'default', f.valueWonNgwee ? kwacha(f.valueWonNgwee) : null],
    ['Paid to date', kwachaShort(f.paidNgwee), Banknote, 'default'],
  ],
  COMMITTEE: (f) => [
    ['My tenders', f.tenders, ClipboardCheck, 'brand'],
    ['Awaiting my approval', f.awaitingMyApproval, Hourglass, f.awaitingMyApproval ? 'warning' : 'default', 'Tenders closed, opening not yet approved by you'],
    ['Bids to score', f.bidsAwaitingMyScore, ClipboardCheck, f.bidsAwaitingMyScore ? 'warning' : 'default'],
    ['Recommended', f.recommended, Trophy, 'default'],
  ],
  INSPECTOR: (f) => [
    ['My contracts', f.contracts, FileSignature, 'brand'],
    ['Awaiting my certificate', f.awaitingCertificate, Hourglass, f.awaitingCertificate ? 'warning' : 'default'],
    ['Milestones certified', f.certified, ClipboardCheck, 'default'],
  ],
  REGULATOR: (f) => [
    ['Unreviewed alerts', f.unreviewedAlerts, ShieldAlert, f.unreviewedAlerts ? 'danger' : 'default'],
    ['High-risk, unresolved', f.highRiskAlerts, AlertTriangle, f.highRiskAlerts ? 'danger' : 'default', 'Score 70+ and unreviewed or referred'],
    ['Payments held', f.paymentsHeld, Banknote, f.paymentsHeld ? 'warning' : 'default'],
    ['Contract value', kwachaShort(f.contractValueNgwee), FileSignature, 'brand'],
  ],
  ADMIN: (f) => [
    ['Users', f.users, Users, 'brand'],
    ['Suspended', f.suspendedUsers, UserX, f.suspendedUsers ? 'warning' : 'default'],
    ['Bidders', f.bidders, Building2, 'default'],
    ['Failed sign-ins (24 h)', f.failedSignIns24h, AlertTriangle, f.failedSignIns24h ? 'warning' : 'default'],
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
      { key: 'closingTime', label: 'Closes', render: (t) => when(t.closingTime) },
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
      { key: 'closingTime', label: 'Closes', render: (t) => when(t.closingTime) },
      { key: 'status', label: 'Status', render: (t) => (new Date(t.closingTime) > now ? <Badge tone="brand">Open</Badge> : <Badge>Closed</Badge>) },
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
      { key: 'subjectId', label: 'On', render: (a) => <span><span className="text-slate-500">{a.subjectType}</span> {a.subjectId}</span> },
      { key: 'score', label: 'Score', align: 'right', render: (a) => <Badge tone={a.score >= 70 ? 'danger' : 'default'}>{a.score}</Badge> },
      { key: 'why', label: 'Main reason', wide: true, render: (a) => a.explanation?.reasons?.[0]?.text ?? <span className="text-slate-400">–</span> },
    ]} />
  );
}

function MyBids() {
  const [bids, setBids] = useState(null);
  useEffect(() => { api('/bids/mine').then(setBids).catch(() => setBids([])); }, []);
  if (!bids) return <Spinner />;
  const tone = { Won: 'brand', Open: 'info', 'Under evaluation': 'default', 'Not successful': 'default' };
  return (
    <Table rows={bids.slice(0, 6)} rowKey={(b) => b.bidId} empty="You have not bid yet." columns={[
      { key: 'title', label: 'Tender', render: (b) => <span>{b.title}<br /><span className="font-mono text-xs text-slate-500">{b.tenderRef}</span></span> },
      { key: 'submittedAt', label: 'Submitted', render: (b) => day(b.submittedAt) },
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
      { key: 'at', label: 'When', render: (r) => when(r.at) },
      { key: 'action', label: 'Action', mono: true },
      { key: 'user', label: 'User', render: (r) => r.user ?? <span className="text-slate-400">system</span> },
    ]} />
  );
}

const PANELS = {
  OFFICER: ['Recent tenders', RecentTenders, '/tenders'],
  SUPPLIER: ['My recent bids', MyBids, '/bids'],
  COMMITTEE: ['Tenders', RecentTenders, '/evaluation'],
  INSPECTOR: ['Tenders', RecentTenders, '/contracts'],
  REGULATOR: ['Unreviewed alerts', TopAlerts, '/oversight'],
  ADMIN: ['Recent activity', AuditTrail, '/admin/users'],
};

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/dashboard').then(setData).catch((e) => setError(e.message)); }, []);
  const [title, Panel, more] = PANELS[user.role];
  const firstName = user.name.split(' ')[0];
  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${firstName}`}
        description={user.role === 'SUPPLIER' ? `Bidding for ${user.companyName} as ${user.supplierRef}.` : 'Here is where things stand today.'} />
      {error && <Message tone="error">{error}</Message>}
      {!data ? <Spinner /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STATS[user.role](data.figures).map(([label, value, icon, tone, hint]) => (
            <Stat key={label} label={label} value={value} icon={icon} tone={tone} hint={hint} />
          ))}
        </div>
      )}
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={title} padded={false} actions={<Link to={more} className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
          <Panel />
        </Card>
        {user.role === 'SUPPLIER' ? (
          <Card title="Open tenders" padded={false}><OpenTenders /></Card>
        ) : (
          <Card title="How records are protected">
            <ul className="space-y-3 text-sm text-slate-600">
              <li>Every tender, bid, award, certificate and payment is a transaction on the ledger, endorsed by both ZPPA and the Office of the Auditor General.</li>
              <li>Documents stay off the ledger; their SHA-256 fingerprints do not, so any change is detected.</li>
              <li>The AI scores each award and contract; a high score holds payment until a regulator decides.</li>
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
