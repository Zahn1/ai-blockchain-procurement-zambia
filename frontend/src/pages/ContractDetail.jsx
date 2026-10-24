// One contract (3.5.6): award and signature on the ledger, the milestone payment schedule, the inspector's certificates,
// and each payment through IFMIS, or why it is held.
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { day, kwacha, when } from '../lib/format.js';
import { BackLink, Badge, Button, Card, Details, Field, Figures, Hash, Input, Message, PageHeader, Score, Select, Spinner, Table, fileInputClass } from '../components/ui.jsx';
import { contractStage } from './Contracts.jsx';
import { tenderLink } from './Tenders.jsx';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lusaka' }); // YYYY-MM-DD in Zambia
const errorText = (err) => (err.fromLedger ? `The ledger refused this: ${err.message}` : err.message);

function SignContract({ c, reload }) {
  const [inspectors, setInspectors] = useState(null);
  const [inspectorId, setInspectorId] = useState('');
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([{ description: '', amountKwacha: String(c.amountNgwee / 100), dueDate: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/contracts/inspectors').then(setInspectors).catch(() => setInspectors([])); }, []);

  const total = Math.round(rows.reduce((s, r) => s + (Number(r.amountKwacha) || 0), 0) * 100);
  const balanced = total === c.amountNgwee;
  const inStandstill = new Date(c.standstillEnds) > new Date();
  const set = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData();
    data.set('awardId', c.awardId);
    data.set('inspectorId', inspectorId);
    data.set('milestones', JSON.stringify(rows));
    data.set('contract', file);
    try { await api('/contracts/sign', { form: data }); await reload(); } catch (err) { setError(errorText(err)); setBusy(false); }
  }

  return (
    <Card title="Sign the contract" description="Records the signed contract's hash and the payment schedule on the ledger, and names the inspector who certifies each milestone.">
      {inStandstill && <div className="mb-5"><Message tone="warning" title="Standstill period">Unsuccessful bidders can challenge the award until {when(c.standstillEnds)}. The contract can be signed after that.</Message></div>}
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-800">Milestones (payment schedule)</legend>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_9rem_10rem_auto] sm:items-end">
                <Field label={`Milestone ${i + 1}`} id={`ms-desc-${i}`}><Input id={`ms-desc-${i}`} required value={r.description} onChange={set(i, 'description')} placeholder="e.g. Delivery of 20 kits" /></Field>
                <Field label="Amount (K)" id={`ms-amt-${i}`}><Input id={`ms-amt-${i}`} type="number" min="0.01" step="0.01" required value={r.amountKwacha} onChange={set(i, 'amountKwacha')} /></Field>
                <Field label="Due" id={`ms-due-${i}`}><Input id={`ms-due-${i}`} type="date" min={today()} required value={r.dueDate} onChange={set(i, 'dueDate')} /></Field>
                <Button variant="ghost" className="px-2" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove milestone ${i + 1}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" disabled={rows.length >= 12} onClick={() => setRows([...rows, { description: '', amountKwacha: '', dueDate: '' }])}>
              <Plus className="h-4 w-4" aria-hidden /> Add milestone
            </Button>
            <p className={`text-sm ${balanced ? 'text-slate-600' : 'font-medium text-warn-700'}`}>
              Total {kwacha(total)} of {kwacha(c.amountNgwee)}{balanced ? '' : ': must equal the contract value'}
            </p>
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Inspector" id="inspector">
            <Select id="inspector" required value={inspectorId} onChange={(e) => setInspectorId(e.target.value)}>
              <option value="">Choose an inspector</option>
              {(inspectors ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Signed contract" id="contract-file" hint="Its SHA-256 hash goes on the ledger">
            <input id="contract-file" type="file" required onChange={(e) => setFile(e.target.files[0] ?? null)} className={fileInputClass} />
          </Field>
        </div>
        {error && <Message tone="error">{error}</Message>}
        <Button type="submit" busy={busy} disabled={!balanced || inStandstill}>{busy ? 'Recording on the ledger…' : 'Sign contract'}</Button>
      </form>
    </Card>
  );
}

function Certify({ c, m, reload, onClose }) {
  const [file, setFile] = useState(null);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData();
    data.set('awardId', c.awardId);
    data.set('milestoneId', m.milestoneId);
    data.set('completionDate', date);
    data.set('certificate', file);
    try { setResult(await api('/contracts/certify', { form: data })); await reload(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  if (result) {
    const paid = result.payment.status === 'PAID';
    return (
      <Card title={`${m.milestoneId} certified`} actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        <div className="space-y-4">
          <Message tone={paid ? 'success' : 'warning'} title={paid ? `Paid through IFMIS: ${result.payment.ifmisRef}` : 'Payment held'}>
            {paid ? 'The IFMIS payment reference is recorded on the ledger.' : result.payment.reason}
          </Message>
          <Details items={[
            ['Certificate hash (SHA-256)', <Hash value={result.certificateHash} n={20} />],
            ['Certificate transaction', <Hash value={result.certifyTxId} n={20} />],
            result.risk && ['Contract risk score', <Score value={result.risk.score} />],
          ]} />
        </div>
      </Card>
    );
  }
  return (
    <Card title={`Certify ${m.milestoneId}: ${m.description}`} description={`${kwacha(m.amountNgwee)}, due ${day(m.dueDate)}. The ledger checks the certificate against these terms.`}
      actions={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Signed completion certificate" id="certificate"><input id="certificate" type="file" required onChange={(e) => setFile(e.target.files[0] ?? null)} className={fileInputClass} /></Field>
          <Field label="Completion date" id="completion"><Input id="completion" type="date" max={today()} required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {error && <Message tone="error">{error}</Message>}
        <Button type="submit" busy={busy}>{busy ? 'Checking on the ledger…' : 'Certify and request payment'}</Button>
      </form>
    </Card>
  );
}

function PaymentStatus({ m }) {
  if (m.paymentStatus === 'PAID') return <span className="flex flex-col gap-0.5"><Badge tone="success">Paid {day(m.paidAt)}</Badge><span className="font-mono text-xs text-slate-500">{m.ifmisRef}</span></span>;
  if (m.paymentStatus === 'HELD') return <span className="flex flex-col gap-0.5"><Badge tone="danger">Held</Badge><span className="text-xs text-slate-600">{m.paymentNote}</span></span>;
  if (m.certifyTxId) return <Badge tone="info">Certified</Badge>;
  return <Badge>Not yet certified</Badge>;
}

export default function ContractDetail() {
  const { user } = useAuth();
  const { state } = useLocation();
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  const [certifying, setCertifying] = useState(null);
  const [retry, setRetry] = useState({});
  const load = useCallback(() => api(`/contracts/detail?awardId=${encodeURIComponent(id)}`).then(setC).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !c) return <><BackLink to="/contracts">Contracts</BackLink><Message tone="error">{error}</Message></>;
  if (!c) return <Spinner />;

  const [stage, tone] = contractStage(c);
  const officer = user.role === 'OFFICER';
  const inspector = user.role === 'INSPECTOR';
  const unresolved = c.alerts.filter((a) => a.score >= 70 && ['OPEN', 'REFERRED'].includes(a.status));
  const awarded = state?.awarded?.awardId === c.awardId ? state.awarded : null;
  const ms = c.milestones.find((m) => m.milestoneId === certifying);

  async function pay(m) {
    setRetry({ ...retry, [m.milestoneId]: 'busy' });
    try {
      const r = await api('/contracts/pay', { body: { awardId: c.awardId, milestoneId: m.milestoneId } });
      setRetry({ ...retry, [m.milestoneId]: r.status === 'PAID' ? `Paid: ${r.ifmisRef}` : `Still held: ${r.reason}` });
      await load();
    } catch (err) { setRetry({ ...retry, [m.milestoneId]: errorText(err) }); }
  }

  return (
    <>
      <BackLink to="/contracts">Contracts</BackLink>
      <PageHeader meta={<span className="font-mono normal-case tracking-normal">{c.awardId}</span>} title={c.title}
        description={<span className="flex flex-wrap items-center gap-3"><Badge tone={tone}>{stage}</Badge>
          <Link to={tenderLink(c.tenderRef)} className="font-mono text-xs text-brand-700 hover:underline">{c.tenderRef}</Link></span>} />

      {awarded && (
        <div className="mb-6"><Message tone={awarded.risk?.alert ? 'warning' : 'success'} title="Award recorded on the ledger">
          The standstill period runs until {when(awarded.standstillEnds)}.
          {awarded.risk && <> The AI risk score for this award is {awarded.risk.score}{awarded.risk.alert ? `; alert ${awarded.risk.alertId} was raised and payments on this contract are held until a regulator decides.` : '.'}</>}
        </Message></div>
      )}
      {unresolved.length > 0 && (
        <div className="mb-6"><Message tone="error" title="Payments on this contract are held">
          {unresolved.map((a) => `${a.id} (${a.subjectType}, score ${a.score}, ${a.status.toLowerCase()})`).join('; ')}. A regulator must clear the alert or decide to monitor it.
        </Message></div>
      )}

      <Figures items={[
        { label: 'Contract value', value: kwacha(c.amountNgwee) },
        { label: 'Paid to date (ledger)', value: kwacha(c.ledger.paidTotal) },
        { label: 'Milestones paid', value: c.milestones.length ? `${c.milestones.filter((m) => m.paymentStatus === 'PAID').length} of ${c.milestones.length}` : '–' },
        { label: 'Unresolved high-risk alerts', value: unresolved.length, tone: unresolved.length ? 'danger' : null },
      ]} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {officer && c.status === 'AWARDED' && <SignContract c={c} reload={load} />}
          {c.status !== 'AWARDED' && (
            <Card title="Milestones" padded={false}>
              <Table rows={c.milestones} rowKey={(m) => m.milestoneId} columns={[
                { key: 'milestoneId', label: 'ID', mono: true },
                { key: 'description', label: 'Milestone', wide: true },
                { key: 'amount', label: 'Amount', align: 'right', render: (m) => kwacha(m.amountNgwee) },
                { key: 'dueDate', label: 'Due', nowrap: true, render: (m) => day(m.dueDate) },
                { key: 'certificate', label: 'Certificate', render: (m) => (m.certificateHash ? <span className="flex flex-col gap-0.5"><Hash value={m.certificateHash} n={10} /><span className="text-xs text-slate-500">{m.certifiedBy}, {day(m.completionDate)}</span></span> : '–') },
                { key: 'payment', label: 'Payment', wide: true, render: (m) => <PaymentStatus m={m} /> },
                ...(inspector || officer ? [{ key: 'action', label: '', align: 'right', render: (m) => {
                  if (inspector && !m.certifyTxId) return <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setCertifying(m.milestoneId)}>Certify</Button>;
                  if (officer && m.paymentStatus === 'HELD') {
                    return <span className="flex flex-col items-end gap-1"><Button variant="secondary" className="min-h-8 px-3 py-1" busy={retry[m.milestoneId] === 'busy'} onClick={() => pay(m)}>Retry payment</Button>
                      {retry[m.milestoneId] && retry[m.milestoneId] !== 'busy' && <span className="max-w-[16rem] text-right text-xs text-slate-600">{retry[m.milestoneId]}</span>}</span>;
                  }
                  return null;
                } }] : []),
              ]} />
            </Card>
          )}
          {ms && <Certify key={ms.milestoneId} c={c} m={ms} reload={load} onClose={() => setCertifying(null)} />}
        </div>

        <Card title="Ledger record">
          <dl className="space-y-3 text-sm">
            {[
              ['Bid', <span className="font-mono">{c.bidId}</span>],
              ['Bidder code', <span className="font-mono">{c.supplierRef}</span>],
              ['Ledger status', <span className="font-mono text-xs">{c.ledger.status}</span>],
              ['Awarded', when(c.awardedAt)],
              ['Award transaction', <Hash value={c.awardTxId} />],
              ['Evaluation report hash', <Hash value={c.evalHash} />],
              ['Standstill ends', when(c.standstillEnds)],
              c.signedAt && ['Signed', when(c.signedAt)],
              c.contractHash && ['Contract hash', <Hash value={c.contractHash} />],
              c.signTxId && ['Signing transaction', <Hash value={c.signTxId} />],
              c.inspector && ['Inspector', c.inspector.name],
            ].filter(Boolean).map(([k, v]) => (
              <div key={k}><dt className="text-xs font-medium text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
            ))}
          </dl>
          {c.alerts.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">Risk alerts</p>
              <ul className="space-y-2 text-sm">
                {c.alerts.map((a) => <li key={a.id} className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{a.id}</span><Score value={a.score} /><span className="text-xs text-slate-600">{a.status.toLowerCase()}</span></li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
