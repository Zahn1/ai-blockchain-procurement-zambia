// One tender's evaluation (3.5.5): committee, opening approvals signed on the ledger, opening with the hash check,
// each member's scores, the 70/30 ranking, and the recommendation (with a written justification when departing from it).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, LockOpen, PenLine } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { kwacha, when } from '../lib/format.js';
import { BackLink, Badge, Button, Card, Details, Field, Hash, Input, Message, PageHeader, Select, Spinner, Steps, Table, Textarea } from '../components/ui.jsx';
import { tenderLink } from './Tenders.jsx';

const MIN_JUSTIFICATION = 50; // as the back end requires

/** Runs an action, then reloads; returns [run, busy, error, done]. */
function useAction(reload) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError('');
    setDone(null);
    try { setDone(await fn()); await reload(); } catch (err) { setError(err.fromLedger ? `The ledger refused this: ${err.message}` : err.message); } finally { setBusy(false); }
  };
  return [run, busy, error, done];
}

/** FR-BID-07: the member's key share, collected once and handed back at opening (only when the key is split). */
function KeyShare({ ev, reload }) {
  const o = ev.opening;
  const mine = o.mine;
  const [share, setShare] = useState('');
  const [paste, setPaste] = useState('');
  const [copied, setCopied] = useState(false);
  const [run, busy, error] = useAction(reload);
  if (!mine) return null;
  const opened = ev.bids.length > 0 && ev.bids.every((b) => b.integrity);
  const me = ev.committee.find((m) => m.id === ev.me.id);

  const save = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${share}\n`], { type: 'text/plain' }));
    a.download = `key-share-${ev.reference.replace(/\//g, '-')}-${mine.index}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <p className="text-sm font-medium text-slate-800">Your key share <span className="font-normal text-slate-500">({mine.index} of {o.shares})</span></p>
      {share ? (
        <>
          <Message tone="warning" title="Save this now. It is shown only once.">
            The opening key exists only as the committee's shares; nobody can issue yours again. You need it to open the bids.
          </Message>
          <Textarea aria-label="Your key share" readOnly rows={3} value={share} className="font-mono text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(share); setCopied(true); } catch { /* clipboard blocked */ } }}>{copied ? 'Copied' : 'Copy'}</Button>
            <Button variant="secondary" onClick={save}>Save as file</Button>
          </div>
        </>
      ) : !mine.collectedAt ? (
        <>
          <p className="text-sm text-slate-600">The tender's opening key is split among the committee: any {o.threshold} of {o.shares} shares can open the bids. Collect yours and keep it safe.</p>
          <Button variant="secondary" busy={busy} onClick={() => run(async () => { const r = await api(`/evaluation/share?reference=${encodeURIComponent(ev.reference)}`); setShare(r.share); return r; })}>
            Collect my key share
          </Button>
        </>
      ) : (
        <p className="text-sm text-slate-600">Collected {when(mine.collectedAt)}.</p>
      )}
      {!opened && me?.approvedAt && !mine.provided && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => api('/evaluation/share', { body: { reference: ev.reference, share: paste } })); }}>
          <Field label="Provide your key share to open the bids" id="share-paste">
            <Textarea id="share-paste" rows={3} required value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="ZPPA-SHARE:…" className="font-mono text-xs" />
          </Field>
          <Button type="submit" busy={busy}>Provide key share</Button>
        </form>
      )}
      {!opened && <p className="text-xs text-slate-600">{o.provided} of {o.threshold} shares needed to open have been provided{mine.provided ? ', including yours' : ''}.</p>}
      {error && <Message tone="error">{error}</Message>}
    </div>
  );
}

function Committee({ ev, reload }) {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState(null);
  const [chosen, setChosen] = useState(() => new Set(ev.committee.map((m) => m.id)));
  const [run, busy, error, done] = useAction(reload);
  const canAppoint = user.role === 'OFFICER' && !ev.committee.some((m) => m.approvedAt) && !ev.recommendation;
  useEffect(() => { if (canAppoint) api('/evaluation/candidates').then(setCandidates).catch(() => setCandidates([])); }, [canAppoint]);
  const mine = ev.committee.find((m) => m.id === user.id);
  const toggle = (id) => { const next = new Set(chosen); next.has(id) ? next.delete(id) : next.add(id); setChosen(next); };

  return (
    <Card title="Committee" description={`Opening needs ${ev.quorum} approvals, each signed on the ledger with the member's own identity.`}>
      <div className="space-y-4">
        {ev.committee.length ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {ev.committee.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium text-slate-900">{m.name}{m.id === user.id && <span className="ml-1 font-normal text-slate-500">(you)</span>}</span>
                {m.approvedAt ? <span className="flex items-center gap-2"><Badge tone="success">Approved {when(m.approvedAt)}</Badge><Hash value={m.approvalTxId} n={8} /></span>
                  : <Badge>Not yet approved</Badge>}
              </li>
            ))}
          </ul>
        ) : <Message tone="warning">No committee has been appointed for this tender.</Message>}

        {mine && !mine.approvedAt && (ev.closed
          ? <Button busy={busy} onClick={() => run(() => api('/evaluation/approve', { body: { reference: ev.reference } }))}><PenLine className="h-4 w-4" aria-hidden /> Approve opening</Button>
          : <p className="text-sm text-slate-600">You can approve opening after the tender closes on {when(ev.closingTime)}. Before then the ledger refuses it.</p>)}

        {canAppoint && candidates && (
          <fieldset className="space-y-2 border-t border-slate-200 pt-4">
            <legend className="mb-2 text-sm font-medium text-slate-800">{ev.committee.length ? 'Change the committee' : 'Appoint the committee'}</legend>
            {candidates.map((c) => (
              <label key={c.id} className="flex items-center gap-3 text-sm text-slate-800">
                <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-brand-700" />
                {c.name} <span className="text-slate-500">{c.email}</span>
              </label>
            ))}
            <Button variant="secondary" busy={busy} disabled={chosen.size < ev.quorum}
              onClick={() => run(() => api('/evaluation/committee', { body: { reference: ev.reference, memberIds: [...chosen] } }))}>
              Appoint {chosen.size} member{chosen.size === 1 ? '' : 's'}
            </Button>
            {chosen.size < ev.quorum && <p className="text-xs text-slate-500">Choose at least {ev.quorum}.</p>}
          </fieldset>
        )}
        {error && <Message tone="error">{error}</Message>}
        {done?.txId && <Message tone="success">Your approval is on the ledger in block {done.block}.</Message>}
        {ev.opening?.mode === 'SHAMIR' && <KeyShare ev={ev} reload={reload} />}
      </div>
    </Card>
  );
}

function ScoreBid({ ev, bid, reload, onClose }) {
  const [price, setPrice] = useState(bid.priceNgwee ? String(bid.priceNgwee / 100) : '');
  const [score, setScore] = useState(bid.myScore?.technicalScore ?? '');
  const [comment, setComment] = useState(bid.myScore?.comment ?? '');
  const [run, busy, error, done] = useAction(reload);
  const locked = !!ev.recommendation;

  return (
    <Card title={`Evaluating ${bid.bidId}`} description={`Bidder code ${bid.supplierRef}. Your technical score is your own; the price is shared by the committee.`}
      actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        <Button variant="secondary" onClick={() => download(`/evaluation/bid-file?bidId=${encodeURIComponent(bid.bidId)}`)}>
          <Download className="h-4 w-4" aria-hidden /> Open bid document
        </Button>
        <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => { e.preventDefault(); run(() => api('/evaluation/price', { body: { bidId: bid.bidId, priceKwacha: price } })); }}>
          <Field label="Bid price (K)" id="price" hint="As stated in the bid document">
            <Input id="price" type="number" min="0.01" step="0.01" required disabled={locked} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" busy={busy} disabled={locked}>Save price</Button>
        </form>
        <form className="space-y-3 border-t border-slate-200 pt-5"
          onSubmit={(e) => { e.preventDefault(); run(() => api('/evaluation/score', { body: { bidId: bid.bidId, technicalScore: Number(score), comment } })); }}>
          <Field label="Your technical score (0 to 100)" id="score" hint={`Pass mark ${ev.passMark}`}>
            <Input id="score" type="number" min="0" max="100" step="1" required disabled={locked} value={score} onChange={(e) => setScore(e.target.value)} className="max-w-32" />
          </Field>
          <Field label="Comment" id="comment" hint="Why this score: kept in the evaluation report">
            <Textarea id="comment" rows={3} required disabled={locked} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button type="submit" busy={busy} disabled={locked}>Save my score</Button>
        </form>
        {error && <Message tone="error">{error}</Message>}
        {done && <Message tone="success">Saved.</Message>}
      </div>
    </Card>
  );
}

function Bids({ ev, reload }) {
  const { user } = useAuth();
  const [selected, setSelected] = useState(null);
  const [run, busy, error, done] = useAction(reload);
  const member = ev.me.onCommittee;
  const unopened = ev.bids.filter((b) => !b.integrity).length;
  const sharesShort = ev.opening?.mode === 'SHAMIR' && ev.opening.provided < ev.opening.threshold;
  const canOpen = ev.openingApproved && unopened > 0 && !sharesShort && (member || user.role === 'OFFICER');
  const bid = ev.bids.find((b) => b.bidId === selected);
  const integrity = { MATCH: ['Opened, hash matches', 'success'], MISMATCH: ['Failed integrity check', 'danger'] };

  return (
    <>
      <Card title={`Bids (${ev.bids.length})`} padded={false}
        actions={sharesShort && ev.openingApproved && unopened > 0
          ? <span className="text-sm text-slate-600">Waiting for key shares: {ev.opening.provided} of {ev.opening.threshold}</span>
          : canOpen && <Button busy={busy} onClick={() => run(() => api('/evaluation/open', { body: { reference: ev.reference } }))}>
          <LockOpen className="h-4 w-4" aria-hidden /> Open {unopened} bid{unopened === 1 ? '' : 's'}</Button>}>
        {(error || done) && (
          <div className="border-b border-slate-200 p-4">
            {error && <Message tone="error">{error}</Message>}
            {done?.results && <Message tone={done.results.some((r) => r.integrity !== 'MATCH') ? 'warning' : 'success'} title="Bids opened">
              {done.results.map((r) => <div key={r.bidId}>{r.bidId}: {r.integrity === 'MATCH' ? 'matches its ledger hash; opening recorded on the ledger' : r.reason}</div>)}
            </Message>}
          </div>
        )}
        <Table rows={ev.bids} rowKey={(b) => b.bidId} empty="No bids were received." columns={[
          { key: 'bidId', label: 'Bid', mono: true },
          { key: 'supplierRef', label: 'Bidder code', mono: true },
          { key: 'submittedAt', label: 'Submitted', nowrap: true, render: (b) => when(b.submittedAt) },
          { key: 'integrity', label: 'Status', render: (b) => { const [label, tone] = integrity[b.integrity] ?? ['Sealed', 'default']; return <Badge tone={tone}>{label}</Badge>; } },
          { key: 'price', label: 'Price', align: 'right', render: (b) => (b.priceNgwee ? kwacha(b.priceNgwee) : '–') },
          { key: 'scores', label: 'Scores in', align: 'right', render: (b) => (b.integrity === 'MATCH' ? `${b.scoresIn} of ${ev.committee.length}` : '–') },
          ...(member ? [
            { key: 'mine', label: 'My score', align: 'right', render: (b) => b.myScore?.technicalScore ?? '–' },
            { key: 'action', label: '', align: 'right', render: (b) => b.integrity === 'MATCH' && (
              <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={() => setSelected(b.bidId)}>{b.myScore ? 'Review' : 'Evaluate'}</Button>) },
          ] : []),
        ]} />
      </Card>
      {bid && <ScoreBid key={bid.bidId} ev={ev} bid={bid} reload={reload} onClose={() => setSelected(null)} />}
    </>
  );
}

function Ranking({ ev }) {
  const rows = ev.ranking.rows;
  if (!rows.length) return null;
  return (
    <Card title="Ranking" description={`Technical ${ev.technicalWeight}%, financial ${100 - ev.technicalWeight}%. The financial score compares each eligible price with the lowest. Pass mark ${ev.passMark}.`} padded={false}>
      <Table rows={rows} rowKey={(r) => r.bidId} columns={[
        { key: 'rank', label: 'Rank', align: 'right', render: (r) => (r.eligible ? rows.indexOf(r) + 1 : '–') },
        { key: 'bidId', label: 'Bid', mono: true, render: (r) => <>{r.bidId}{r.bidId === ev.ranking.recommendedBidId && <span className="ml-2 font-sans text-xs font-medium text-brand-700">Recommended</span>}</> },
        { key: 'technical', label: 'Technical', align: 'right', render: (r) => r.technical ?? '–' },
        { key: 'financial', label: 'Financial', align: 'right', render: (r) => r.financial ?? '–' },
        { key: 'combined', label: 'Combined', align: 'right', render: (r) => (r.combined === null ? '–' : <strong>{r.combined}</strong>) },
        { key: 'eligible', label: 'Eligible', render: (r) => (r.eligible ? <Badge tone="success">Passes</Badge> : <Badge>{r.technical === null ? 'Not scored' : 'Below pass mark'}</Badge>) },
      ]} />
    </Card>
  );
}

function Recommendation({ ev, reload }) {
  const eligible = ev.ranking.rows.filter((r) => r.eligible);
  const [bidId, setBidId] = useState(ev.ranking.recommendedBidId ?? '');
  const [justification, setJustification] = useState('');
  const [run, busy, error] = useAction(reload);
  const rec = ev.recommendation;

  if (rec) {
    return (
      <Card title="Recommendation">
        <Details items={[
          ['Recommended bid', <span className="font-mono">{rec.bidId}</span>],
          ['Top-ranked bid', <span className="font-mono">{rec.recommendedBidId}</span>],
          ['Decided', when(rec.createdAt)],
          ['Evaluation report hash', <Hash value={rec.reportHash} n={14} />],
          rec.justification && ['Justification for departing from the ranking', rec.justification],
        ]} />
        <p className="mt-4 text-sm text-slate-600">The report hash goes on the ledger with the award, so the evaluation cannot be changed afterwards.</p>
      </Card>
    );
  }
  if (!ev.me.onCommittee || !ev.bids.length || ev.bids.some((b) => !b.integrity)) return null;
  const departs = bidId && bidId !== ev.ranking.recommendedBidId;

  return (
    <Card title="Make the recommendation" description="Once made, scores and prices are locked.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => api('/evaluation/recommend', { body: { reference: ev.reference, bidId, justification } })); }}>
        <Field label="Recommended bid" id="rec-bid">
          <Select id="rec-bid" required value={bidId} onChange={(e) => setBidId(e.target.value)}>
            <option value="">Choose an eligible bid</option>
            {eligible.map((r) => <option key={r.bidId} value={r.bidId}>{r.bidId} ({r.supplierRef}): combined {r.combined}{r.bidId === ev.ranking.recommendedBidId ? ', top-ranked' : ''}</option>)}
          </Select>
        </Field>
        {departs && (
          <Field label="Justification" id="justification" hint={`${justification.trim().length} of at least ${MIN_JUSTIFICATION} characters`}>
            <Textarea id="justification" rows={4} required minLength={MIN_JUSTIFICATION} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </Field>
        )}
        {departs && <Message tone="warning">This departs from the top-ranked bid ({ev.ranking.recommendedBidId}). A written justification is required and goes into the evaluation report.</Message>}
        {error && <Message tone="error">{error}</Message>}
        <Button type="submit" busy={busy} disabled={!bidId || (departs && justification.trim().length < MIN_JUSTIFICATION)}>Record recommendation</Button>
      </form>
    </Card>
  );
}

export default function EvaluationTender() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [ev, setEv] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(`/evaluation?reference=${encodeURIComponent(ref)}`).then(setEv).catch((e) => setError(e.message)), [ref]);
  useEffect(() => { load(); }, [load]);

  if (error && !ev) return <><BackLink to="/evaluation">Evaluation</BackLink><Message tone="error">{error}</Message></>;
  if (!ev) return <Spinner />;

  const opened = ev.bids.filter((b) => b.integrity === 'MATCH');
  const approvals = ev.committee.filter((m) => m.approvedAt).length;
  const scored = opened.length > 0 && opened.every((b) => b.priceNgwee && b.scoresIn === ev.committee.length);

  return (
    <>
      <BackLink to="/evaluation">Evaluation</BackLink>
      <PageHeader meta={<span className="font-mono normal-case tracking-normal">{ev.reference}</span>} title={ev.title}
        description={<>Closed {when(ev.closingTime)} · <Link to={tenderLink(ev.reference)} className="font-medium text-brand-700 hover:underline">Ledger record</Link></>} />
      <Steps steps={[
        ['Committee appointed', ev.committee.length >= ev.quorum, ev.committee.length ? `${ev.committee.length} members` : null],
        ['Opening approved', ev.openingApproved, `${approvals} of ${ev.quorum} on the ledger${ev.opening?.mode === 'SHAMIR' && !ev.bids.every((b) => b.integrity) ? ` · ${ev.opening.provided} of ${ev.opening.threshold} key shares` : ''}`],
        ['Bids opened', ev.bids.length > 0 && ev.bids.every((b) => b.integrity), `${ev.bids.filter((b) => b.integrity).length} of ${ev.bids.length}`],
        ['Scored', scored, null],
        ['Recommended', !!ev.recommendation, ev.recommendation ? ev.recommendation.bidId : null],
      ]} />
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Bids ev={ev} reload={load} />
          <Ranking ev={ev} />
        </div>
        <div className="space-y-6">
          <Committee key={ev.committee.map((m) => m.id).join()} ev={ev} reload={load} />
          <Recommendation key={ev.ranking.recommendedBidId ?? 'none'} ev={ev} reload={load} />
        </div>
      </div>
    </>
  );
}
