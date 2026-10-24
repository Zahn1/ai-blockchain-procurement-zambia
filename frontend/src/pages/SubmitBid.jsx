// Submit a sealed bid (3.5.4): encrypted with AES-256-GCM, stored on IPFS, its hash on the ledger, and a signed receipt back.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { when } from '../lib/format.js';
import { BackLink, Button, Card, Details, Field, Hash, Message, PageHeader, Select, Spinner, fileInputClass } from '../components/ui.jsx';
import { tenderLink } from './Tenders.jsx';

function saveReceipt(receipt) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  a.download = `receipt-${receipt.bidId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function Receipt({ receipt }) {
  const [valid, setValid] = useState(null);
  useEffect(() => { api('/receipts/verify', { body: receipt }).then((r) => setValid(r.valid)).catch(() => setValid(false)); }, [receipt]);
  return (
    <>
      <BackLink to="/bids">My bids</BackLink>
      <PageHeader title="Bid received" description="Keep this receipt. It proves what you submitted and when, and its signature can be checked by anyone." />
      <Message tone="success" title={`Bid ${receipt.bidId} is sealed and recorded on the ledger`}>
        It stays encrypted until the tender closes and the evaluation committee approves opening.
      </Message>
      <Card title="Signed receipt" className="mt-6"
        actions={valid === null ? null : valid ? <span className="text-xs font-medium text-emerald-700">Signature valid</span> : <span className="text-xs font-medium text-red-700">Signature not valid</span>}>
        <Details items={[
          ['Bid', <span className="font-mono">{receipt.bidId}</span>],
          ['Tender', <Link to={tenderLink(receipt.tenderId)} className="font-mono text-brand-700 hover:underline">{receipt.tenderId}</Link>],
          ['Bidder code', <span className="font-mono">{receipt.supplierRef}</span>],
          ['Recorded at', when(receipt.submittedAt)],
          ['Encrypted file hash (SHA-256)', <Hash value={receipt.cipherHash} n={24} />],
          ['IPFS address', <Hash value={receipt.cid} n={24} />],
          ['Transaction', <Hash value={receipt.txId} n={24} />],
          ['Block', <span className="font-mono">{receipt.block}</span>],
          ['Signed by', receipt.signer],
        ]} />
      </Card>
      <div className="mt-6 flex gap-3">
        <Button onClick={() => saveReceipt(receipt)}><Download className="h-4 w-4" aria-hidden /> Save receipt</Button>
        <Link to="/bids" className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-slate-600 hover:text-slate-900">Back to my bids</Link>
      </div>
    </>
  );
}

export default function SubmitBid() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [tenders, setTenders] = useState(null);
  const [tenderId, setTenderId] = useState(params.get('tender') ?? '');
  const [file, setFile] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  useEffect(() => { api('/tenders').then((all) => setTenders(all.filter((t) => new Date(t.closingTime) > new Date()))).catch((e) => setError(e.message)); }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData();
    data.set('tenderId', tenderId);
    data.set('bid', file);
    try {
      setReceipt(await api('/bids', { form: data }));
    } catch (err) {
      setError(err.fromLedger ? `The ledger refused this bid: ${err.message}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  if (receipt) return <Receipt receipt={receipt} />;
  const chosen = tenders?.find((t) => t.reference === tenderId);

  return (
    <>
      <BackLink to="/bids">My bids</BackLink>
      <PageHeader title="Submit a sealed bid" description={`Submitting for ${user.companyName} under the code ${user.supplierRef}.`} />
      {!tenders ? <Spinner /> : (
        <form onSubmit={submit} className="max-w-2xl">
          <Card>
            <div className="space-y-5">
              <Field label="Tender" id="tender" hint={chosen ? `Closes ${when(chosen.closingTime)}. After that the ledger refuses bids.` : null}>
                <Select id="tender" required value={tenderId} onChange={(e) => setTenderId(e.target.value)}>
                  <option value="">Choose an open tender</option>
                  {tenders.map((t) => <option key={t.reference} value={t.reference}>{t.reference} – {t.title}</option>)}
                </Select>
              </Field>
              {tenderId && !chosen && <Message tone="warning">{tenderId} is not open for bids.</Message>}
              <Field label="Bid document" id="bid" hint="Your full technical and financial bid, up to 20 MB.">
                <input id="bid" type="file" required onChange={(e) => setFile(e.target.files[0] ?? null)}
                  className={fileInputClass} />
              </Field>
              <div className="flex gap-3 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <p>Your file is encrypted with its own AES-256 key as soon as it arrives. Only the encrypted file's hash goes on the ledger.
                  Nobody, including ZPPA staff, can read it before the closing time and the committee's approval.</p>
              </div>
              <label className="flex items-start gap-3 text-sm text-slate-800">
                <input type="checkbox" required checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-700" />
                I confirm this is the final bid for {user.companyName}. A submitted bid cannot be changed or withdrawn.
              </label>
            </div>
          </Card>
          {error && <div className="mt-4"><Message tone="error">{error}</Message></div>}
          <div className="mt-6 flex gap-3">
            <Button type="submit" busy={busy} disabled={!chosen}>{busy ? 'Encrypting and recording…' : 'Submit sealed bid'}</Button>
            <Link to="/bids" className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</Link>
          </div>
        </form>
      )}
    </>
  );
}
