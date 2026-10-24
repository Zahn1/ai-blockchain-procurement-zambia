// Publish a tender (3.5.3): the document goes to IPFS; its hash, the estimate and the closing time go on the ledger.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { kwacha, when } from '../lib/format.js';
import { BackLink, Button, ButtonLink, Card, Details, Field, Hash, Input, Message, PageHeader, Select, fileInputClass } from '../components/ui.jsx';
import { tenderLink } from './Tenders.jsx';

const UNITS = { minutes: 1, hours: 60, days: 60 * 24 };

export default function PublishTender() {
  const [form, setForm] = useState({ reference: '', title: '', estValueKwacha: '', closesIn: '14', unit: 'days' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const minutes = Number(form.closesIn) * UNITS[form.unit];

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData();
    data.set('reference', form.reference.trim());
    data.set('title', form.title.trim());
    data.set('estValueKwacha', form.estValueKwacha);
    data.set('closesInMinutes', String(minutes));
    data.set('document', file);
    try {
      setDone(await api('/tenders', { form: data }));
    } catch (err) {
      setError(err.fromLedger ? `The ledger refused this tender: ${err.message}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <BackLink to="/tenders">Tenders</BackLink>
        <PageHeader title="Tender published" description={done.title} />
        <Message tone="success" title={`${done.reference} is on the ledger`}>Bidders can now submit sealed bids until {when(done.closingTime)}.</Message>
        <Card title="Ledger record" className="mt-6">
          <Details items={[
            ['Reference', <span className="font-mono">{done.reference}</span>],
            ['Closes', when(done.closingTime)],
            ['Estimated value', kwacha(Math.round(Number(form.estValueKwacha) * 100))],
            ['Document', done.fileName],
            ['Document hash (SHA-256)', <Hash value={done.docHash} n={24} />],
            ['IPFS address', <Hash value={done.cid} n={24} />],
            ['Transaction', <Hash value={done.txId} n={24} />],
            ['Block', <span className="font-mono">{done.block}</span>],
          ]} />
        </Card>
        <div className="mt-6 flex gap-3">
          <ButtonLink to={tenderLink(done.reference)}>View tender</ButtonLink>
          <Button variant="secondary" onClick={() => { setDone(null); setFile(null); setForm({ ...form, reference: '', title: '', estValueKwacha: '' }); }}>Publish another</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <BackLink to="/tenders">Tenders</BackLink>
      <PageHeader title="Publish tender" description="Once published, the closing time and document hash cannot be changed. Any change would show on the ledger." />
      <form onSubmit={submit} className="max-w-2xl">
        <Card>
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Tender reference" id="reference" hint="Letters, digits and . _ / - only">
                <Input id="reference" required value={form.reference} onChange={set('reference')} placeholder="ZPPA/MOH/2026/001" className="font-mono" />
              </Field>
              <Field label="Estimated value (K)" id="est" hint="In kwacha">
                <Input id="est" type="number" min="0.01" step="0.01" required inputMode="decimal" value={form.estValueKwacha} onChange={set('estValueKwacha')} />
              </Field>
            </div>
            <Field label="Title" id="title" hint="Kept off the ledger, in the system's database">
              <Input id="title" required maxLength={200} value={form.title} onChange={set('title')} />
            </Field>
            <Field label="Closes in" id="closesIn" hint={minutes >= 1 ? `Closes about ${when(new Date(Date.now() + minutes * 60_000).toISOString())}` : 'Between 1 minute and 90 days'}>
              <div className="flex gap-2">
                <div className="w-28"><Input id="closesIn" type="number" min="1" required value={form.closesIn} onChange={set('closesIn')} /></div>
                <div className="w-36">
                  <Select aria-label="Unit" value={form.unit} onChange={set('unit')}>
                    {Object.keys(UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
              </div>
            </Field>
            <Field label="Tender document" id="document" hint="PDF or Word, up to 20 MB. Stored on IPFS; its SHA-256 hash goes on the ledger.">
              <input id="document" type="file" required onChange={(e) => setFile(e.target.files[0] ?? null)}
                className={fileInputClass} />
            </Field>
          </div>
        </Card>
        {error && <div className="mt-4"><Message tone="error">{error}</Message></div>}
        <div className="mt-6 flex gap-3">
          <Button type="submit" busy={busy}>{busy ? 'Recording on the ledger…' : 'Publish tender'}</Button>
          <Link to="/tenders" className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</Link>
        </div>
      </form>
    </>
  );
}
