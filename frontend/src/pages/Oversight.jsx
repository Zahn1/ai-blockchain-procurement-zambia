// Risk alerts (3.5.7, 3.5.8): the AI's flags with their plain-English reasons, and the regulator's decision on each.
// Each decision's hash is signed on the ledger with the regulator's own identity.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { api } from '../lib/api.js';
import { when } from '../lib/format.js';
import { Badge, Button, Card, Field, Hash, Message, PageHeader, Score, Spinner, Textarea } from '../components/ui.jsx';

export const historyLink = (reference) => `/oversight/history?ref=${encodeURIComponent(reference)}`;
const MIN_REASON = 20; // as the back end requires

const STATUS = {
  OPEN: ['Not reviewed', 'danger'], REFERRED: ['Referred', 'warning'], MONITOR: ['Monitor', 'info'], CLEARED: ['Cleared', 'success'],
};
// Which decisions may follow which, as the chaincode enforces
const NEXT = { OPEN: ['CLEARED', 'MONITOR', 'REFERRED'], MONITOR: ['CLEARED', 'REFERRED'], REFERRED: ['CLEARED'] };
const DECISION = {
  CLEARED: ['Clear', 'No concern. Payments held by this alert are released.'],
  MONITOR: ['Monitor', 'Keep watching. Payments may proceed.'],
  REFERRED: ['Refer', 'Refer for investigation, for example to the ACC. Payments stay held.'],
};
const TABS = [['review', 'To review', (a) => a.status === 'OPEN'], ['referred', 'Referred', (a) => a.status === 'REFERRED'],
  ['monitor', 'Monitor', (a) => a.status === 'MONITOR'], ['cleared', 'Cleared', (a) => a.status === 'CLEARED'], ['all', 'All', () => true]];
const MODEL = { supervised: 'Learned from past cases', unsupervised: 'Unusual pattern', graph: 'Bidder network' };

function Decide({ alert, onDone }) {
  const options = NEXT[alert.status] ?? [];
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!options.length) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/oversight/alerts/decide', { body: { alertId: alert.id, subjectId: alert.subjectId, decision, reason } });
      setDecision('');
      setReason('');
      await onDone(r);
    } catch (err) { setError(err.fromLedger ? `The ledger refused this: ${err.message}` : err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-slate-200 pt-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-800">Your decision</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {options.map((d) => (
            <label key={d} className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition-colors duration-150 ${decision === d ? 'border-brand-700 bg-brand-50' : 'border-slate-300 hover:border-slate-400'}`}>
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} required className="accent-brand-700" />
                {DECISION[d][0]}
              </span>
              <span className="text-xs text-slate-600">{DECISION[d][1]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Reason" id="reason" hint={`${reason.trim().length} of at least ${MIN_REASON} characters. Its hash is recorded on the ledger with your decision.`}>
        <Textarea id="reason" rows={3} required minLength={MIN_REASON} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Message tone="error">{error}</Message>}
      <Button type="submit" busy={busy} disabled={!decision || reason.trim().length < MIN_REASON}>Record decision on the ledger</Button>
    </form>
  );
}

function AlertDetail({ alert, reload, keep }) {
  const [done, setDone] = useState(null);
  const [label, tone] = STATUS[alert.status] ?? [alert.status, 'default'];
  const reasons = alert.explanation?.reasons ?? [];
  const top = Math.max(...reasons.map((r) => Math.abs(r.impact)), 1);

  return (
    <Card title={<span className="font-mono">{alert.id}</span>} description={`Raised ${when(alert.raisedAt)} · model ${alert.modelVersion}`}
      actions={<Badge tone={tone}>{label}</Badge>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Risk score</p>
            <p className="mt-1 text-3xl font-semibold"><Score value={alert.score} /></p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500 capitalize">{alert.subjectType}</p>
            <p className="mt-1 font-mono text-sm">{alert.subjectId}</p>
            <Link to={historyLink(alert.subjectId)} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              <History className="h-4 w-4" aria-hidden /> Full history
            </Link>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-800">Why it was flagged</p>
          {reasons.length ? (
            <ol className="space-y-3">
              {reasons.map((r, i) => (
                <li key={i} className="text-sm">
                  <p className="text-slate-900">{r.text}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className="block h-full rounded-full bg-slate-500" style={{ width: `${(Math.abs(r.impact) / top) * 100}%` }} />
                    </span>
                    <span className="w-40 shrink-0 text-xs text-slate-500">{MODEL[r.model] ?? r.model}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-slate-500">No explanation is stored for this alert.</p>}
          {alert.explanation && (
            <p className={`mt-3 text-xs ${alert.explanation.matchesLedger ? 'text-slate-500' : 'font-medium text-red-700'}`}>
              {alert.explanation.matchesLedger ? 'This explanation matches the hash recorded on the ledger.' : 'Warning: this explanation does not match the hash on the ledger.'}
            </p>
          )}
        </div>

        {alert.decisions.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">Decisions</p>
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {alert.decisions.map((d) => (
                <li key={d.txId} className="space-y-1 px-4 py-3 text-sm">
                  <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{DECISION[d.decision]?.[0] ?? d.decision} · {d.by}</span><span className="text-xs text-slate-500">{when(d.at)}</span></p>
                  <p className="text-slate-700">{d.reason}</p>
                  <p className="flex items-center gap-2 text-xs text-slate-500">Record hash <Hash value={d.recordHash} n={10} /></p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {done && <Message tone="success">Decision recorded on the ledger. Record hash {done.recordHash.slice(0, 16)}…</Message>}
        <Decide key={alert.status} alert={alert} onDone={async (r) => { setDone(r); keep(); await reload(); }} />
      </div>
    </Card>
  );
}

export default function Oversight() {
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('review');
  const [selected, setSelected] = useState(null);
  const load = useCallback(() => api('/oversight/alerts').then(setAlerts).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const filter = TABS.find(([k]) => k === tab)[2];
  const shown = (alerts ?? []).filter(filter);
  const current = alerts?.find((a) => a.id === selected) ?? shown[0];

  return (
    <>
      <PageHeader title="Risk alerts" description="Raised by the AI on awards and contracts. An unreviewed or referred alert with a score of 70 or above holds payment." />
      {error && <Message tone="error">{error}</Message>}
      {!alerts ? <Spinner /> : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <Card padded={false} className="xl:col-span-2">
            <div role="tablist" aria-label="Filter alerts" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2">
              {TABS.map(([k, label, f]) => (
                <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setSelected(null); }}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${tab === k ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                  {label} <span className="ml-1 text-xs text-slate-500">{alerts.filter(f).length}</span>
                </button>
              ))}
            </div>
            {!shown.length ? <p className="px-5 py-10 text-center text-sm text-slate-500">No alerts here.</p> : (
              <ul className="divide-y divide-slate-100">
                {shown.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setSelected(a.id)} aria-current={current?.id === a.id}
                      className={`flex w-full items-start gap-4 px-5 py-3 text-left transition-colors duration-150 ${current?.id === a.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                      <span className="w-20 shrink-0 pt-0.5"><Score value={a.score} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs text-slate-600">{a.subjectId}</span>
                        <span className="mt-0.5 block text-sm text-slate-900">{a.explanation?.reasons?.[0]?.text ?? 'No explanation stored'}</span>
                        <span className="mt-1 block text-xs text-slate-500">{when(a.raisedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="xl:col-span-3">
            {current ? <AlertDetail key={current.id} alert={current} reload={load} keep={() => setSelected(current.id)} /> : null}
          </div>
        </div>
      )}
    </>
  );
}
