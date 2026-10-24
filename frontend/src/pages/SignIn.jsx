// Sign-in (3.5.1): password, then the one-time code; first sign-in shows the QR code for the authenticator app.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Field, Input, Message } from '../components/ui.jsx';

export default function SignIn() {
  const { complete, notice } = useAuth();
  const [step, setStep] = useState('password'); // password | code | setup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [stepToken, setStepToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (step === 'password') {
        const r = await api('/auth/login', { body: { email, password } });
        setPassword('');
        setStepToken(r.stepToken);
        if (r.next === 'setup') { setSetup(r); setStep('setup'); } else setStep('code');
      } else {
        complete(await api(step === 'setup' ? '/auth/setup' : '/auth/code', { body: { stepToken, code: code.trim() } }));
      }
    } catch (err) {
      setCode('');
      if (/expired|sign in again/i.test(err.message)) setStep('password');
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-slate-900 p-12 text-slate-300 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-brand-700 p-1.5 text-white"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
          <span className="text-sm font-semibold text-white">Transparent Procurement</span>
        </div>
        <div>
          <h1 className="max-w-md text-3xl font-semibold leading-tight text-white">Public procurement that can be checked, not just trusted.</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
            Tenders, sealed bids, awards and payments are recorded on a ledger shared by ZPPA and the Office of the Auditor General.
            Risk is scored by AI and every alert comes with its reasons.
          </p>
        </div>
        <p className="text-xs text-slate-500">ZCAS University · BSc Information Technology final-year project</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <form onSubmit={submit} className="space-y-5">
            {step === 'password' && (
              <>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
                  <p className="mt-1 text-sm text-slate-600">With your email and password, then the code from your authenticator app.</p>
                </div>
                {notice && <Message tone="info">{notice}</Message>}
                <Field label="Email" id="email"><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Password" id="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              </>
            )}
            {step === 'code' && (
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Enter your code</h2>
                <p className="mt-1 text-sm text-slate-600">Open your authenticator app and enter the 6-digit code for this system.</p>
              </div>
            )}
            {step === 'setup' && (
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Set up your authenticator</h2>
                <p className="mt-1 text-sm text-slate-600">First sign-in: scan this with Google Authenticator or Microsoft Authenticator, then enter the code it shows.</p>
                <img src={setup.qr} alt="QR code to add this account to an authenticator app" className="mx-auto mt-4 h-48 w-48 rounded-lg border border-slate-200" />
                <p className="mt-2 text-center text-xs text-slate-500">Cannot scan? Enter this key: <code className="break-all">{setup.secret}</code></p>
              </div>
            )}
            {step !== 'password' && (
              <Field label="6-digit code" id="code">
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus
                  value={code} onChange={(e) => setCode(e.target.value)} className="text-center text-xl tracking-[0.5em]" />
              </Field>
            )}
            {error && <Message tone="error">{error}</Message>}
            <Button type="submit" busy={busy} className="w-full">{step === 'password' ? 'Continue' : 'Sign in'}</Button>
          </form>
          <div className="mt-8 space-y-2 border-t border-slate-200 pt-6 text-sm text-slate-600">
            <p>A supplier without an account? <Link className="font-medium text-brand-700 hover:underline" to="/register">Register as a bidder</Link></p>
            <p>Anyone can <Link className="font-medium text-brand-700 hover:underline" to="/public">search and verify public records</Link> without signing in.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
