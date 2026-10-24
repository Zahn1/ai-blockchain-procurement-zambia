// Bidder registration (3.5.2): nothing is created unless PACRA confirms the company and ZRA its tax clearance.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, ButtonLink, Card, Field, Input, Message, PageHeader } from '../components/ui.jsx';
import PublicShell from '../components/PublicShell.jsx';

const MIN_PASSWORD = 10; // as the back end requires

export default function Register() {
  const [form, setForm] = useState({ pacraNumber: '', tpin: '', name: '', email: '', phone: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const mismatch = form.confirm && form.password !== form.confirm;

  async function submit(e) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    const { confirm, ...body } = form;
    try { setDone(await api('/register/supplier', { body })); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {done ? (
          <Card>
            <div className="space-y-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
              <h1 className="text-xl font-semibold text-slate-900">{done.companyName} is registered</h1>
              <p className="text-sm text-slate-700">PACRA confirmed the company and ZRA its tax clearance. On the ledger your company bids
                under the code <span className="font-mono font-medium">{done.supplierRef}</span>, never its name.</p>
              <p className="text-sm text-slate-700">Sign in with {done.email}. At your first sign-in you will set up an authenticator app such as Google or Microsoft Authenticator.</p>
              <ButtonLink to="/">Sign in</ButtonLink>
            </div>
          </Card>
        ) : (
          <>
            <PageHeader title="Register as a bidder" description="For companies registered with PACRA and holding a valid ZRA tax clearance. Both are checked before the account is created." />
            <form onSubmit={submit} className="space-y-6">
              <Card title="Company">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="PACRA registration number" id="r-pacra" hint="12 digits, from your certificate of incorporation">
                    <Input id="r-pacra" required inputMode="numeric" pattern="[0-9 ]{12,15}" value={form.pacraNumber} onChange={set('pacraNumber')} className="font-mono" />
                  </Field>
                  <Field label="ZRA TPIN" id="r-tpin" hint="10 digits">
                    <Input id="r-tpin" required inputMode="numeric" pattern="[0-9 ]{10,13}" value={form.tpin} onChange={set('tpin')} className="font-mono" />
                  </Field>
                </div>
              </Card>
              <Card title="Your account" description="You can add colleagues later through the system administrator.">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Full name" id="r-name"><Input id="r-name" required autoComplete="name" value={form.name} onChange={set('name')} /></Field>
                  <Field label="Email" id="r-email"><Input id="r-email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></Field>
                  <Field label="Mobile number" id="r-phone" hint="For SMS notifications, e.g. +260971234567. Optional.">
                    <Input id="r-phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
                  </Field>
                  <div className="hidden sm:block" />
                  <Field label="Password" id="r-password" hint={`At least ${MIN_PASSWORD} characters`}>
                    <Input id="r-password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" value={form.password} onChange={set('password')} />
                  </Field>
                  <Field label="Confirm password" id="r-confirm" error={mismatch ? 'The passwords do not match.' : null}>
                    <Input id="r-confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} aria-invalid={mismatch || undefined} />
                  </Field>
                </div>
              </Card>
              {error && (
                <Message tone="error" title={error.problems ? 'Your company could not be verified' : error.message}>
                  {error.problems && <ul className="list-disc space-y-1 pl-5">{error.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                </Message>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" busy={busy} disabled={mismatch}>{busy ? 'Checking with PACRA and ZRA…' : 'Register'}</Button>
                <p className="text-sm text-slate-600">Already registered? <Link to="/" className="font-medium text-brand-700 hover:underline">Sign in</Link></p>
              </div>
            </form>
          </>
        )}
      </div>
    </PublicShell>
  );
}
