// The complete history of one procurement (3.5.8), from tender publication to final payment, grouped by day.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { day, when } from '../lib/format.js';
import { Badge, Button, Card, Hash, Input, Message, PageHeader, Spinner } from '../components/ui.jsx';

const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' });
// Amounts on the ledger are in ngwee; show them in kwacha
const readable = (text) => text.replace(/(\d+) ngwee/g, (_, n) => `K${(Number(n) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`)
  .replace(/\b([0-9a-f]{64})\b/g, (h) => `${h.slice(0, 12)}…`)
  .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, (iso) => when(iso));

const KIND = (what) => {
  if (/alert/i.test(what)) return 'bg-red-600';
  if (/decision/i.test(what)) return 'bg-warn-700';
  if (/payment/i.test(what)) return 'bg-emerald-600';
  return 'bg-brand-700';
};

export default function ProcurementHistory() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [query, setQuery] = useState(ref);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    if (ref) api(`/oversight/history?reference=${encodeURIComponent(ref)}`).then(setData).catch((e) => setError(e.message));
  }, [ref]);

  const days = [];
  for (const e of data?.events ?? []) {
    const d = day(e.at);
    if (days.at(-1)?.[0] !== d) days.push([d, []]);
    days.at(-1)[1].push(e);
  }

  return (
    <>
      <PageHeader title="Procurement history" description="Every recorded step of a procurement, read from the ledger. Steps kept off the ledger are labelled, with their hash recorded on it." />
      <form className="mb-6 flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); navigate(`?ref=${encodeURIComponent(query.trim())}`); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input aria-label="Tender reference or award ID" placeholder="Tender reference or award ID" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 font-mono" required />
        </div>
        <Button type="submit" variant="secondary">Show history</Button>
      </form>

      {error && <Message tone="error">{error}</Message>}
      {ref && !data && !error && <Spinner />}
      {data && (
        <Card title={data.title} description={<span className="font-mono">{data.reference}</span>}
          actions={data.fullyPaid ? <Badge tone="brand">Fully paid</Badge> : <Badge>In progress</Badge>}>
          <ol className="space-y-6">
            {days.map(([d, events]) => (
              <li key={d}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{d}</p>
                <ol className="relative ml-1.5 space-y-5 border-l border-slate-200 pl-6">
                  {events.map((e, i) => (
                    <li key={i} className="relative">
                      <span className={`absolute top-1.5 -left-[1.72rem] h-2.5 w-2.5 rounded-full ring-4 ring-white ${KIND(e.what)}`} aria-hidden />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-sm font-medium text-slate-900">{e.what}</p>
                        <span className="text-xs text-slate-500">{time(e.at)}</span>
                      </div>
                      {e.detail && <p className="mt-0.5 break-words text-sm text-slate-600">{readable(e.detail)}</p>}
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {e.txId ? <>Transaction <Hash value={e.txId} n={10} /></> : <span>{e.source === 'ledger' ? 'Read from the ledger' : e.source}</span>}
                      </p>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
