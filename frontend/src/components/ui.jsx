// Shared building blocks, so every screen looks and behaves the same (see DESIGN.md).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, Copy, Info, Loader2, XCircle } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');

export function PageHeader({ title, description, meta, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="min-w-0">
        {meta && <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{meta}</p>}
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }) {
  return (
    <section className={cx('rounded-md border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/** One bordered strip of headline figures. `tone` only colours the figure when it needs attention. */
export function Figures({ items }) {
  const tones = { warning: 'text-warn-700', danger: 'text-red-700' };
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-white lg:grid-cols-4">
      {items.map(({ label, value, hint, tone }, i) => (
        <div key={label} className={cx('border-slate-200 px-5 py-4', i % 2 === 1 && 'border-l', i >= 2 && 'border-t lg:border-t-0', i > 0 && 'lg:border-l')}>
          <dt className="text-xs font-medium text-slate-600">{label}</dt>
          <dd className={cx('mt-1 text-2xl font-semibold', tones[tone] ?? 'text-slate-900')}>{value}</dd>
          {hint && <dd className="mt-0.5 text-xs text-slate-500">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

const buttonVariants = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/60',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-slate-700 hover:bg-slate-100',
};
const buttonClass = (variant, className) => cx('inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed',
  buttonVariants[variant], className);

export function Button({ variant = 'primary', busy, className, children, ...props }) {
  return (
    <button type="button" {...props} disabled={busy || props.disabled} className={buttonClass(variant, className)}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** A link that looks like a button, for navigation actions. */
export const ButtonLink = ({ variant = 'primary', className, ...props }) => <Link {...props} className={buttonClass(variant, className)} />;

export function Field({ label, hint, error, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

const inputClass = 'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 hover:border-slate-400 focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700';
export const Input = (props) => <input {...props} className={cx(inputClass, props.className)} />;
export const Select = ({ children, ...props }) => <select {...props} className={cx(inputClass, props.className)}>{children}</select>;
export const Textarea = (props) => <textarea {...props} className={cx(inputClass, props.className)} />;

/** Status as a dot and a word, so it reads without colour. */
export function Badge({ tone = 'default', children }) {
  const dots = { default: 'bg-slate-400', brand: 'bg-brand-700', warning: 'bg-warn-700', danger: 'bg-red-600', info: 'bg-sky-600', success: 'bg-emerald-600' };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-700">
      <span className={cx('h-1.5 w-1.5 rounded-full', dots[tone])} aria-hidden />
      {children}
    </span>
  );
}

/** A risk score: the number, with its band in words. */
export function Score({ value }) {
  const high = value >= 70;
  return (
    <span className={cx('inline-flex items-baseline gap-1.5 font-mono text-sm', high ? 'font-semibold text-red-700' : 'text-slate-700')}>
      {value}<span className="font-sans text-xs font-normal text-slate-500">{high ? 'high' : value >= 40 ? 'medium' : 'low'}</span>
    </span>
  );
}

export function Message({ tone = 'info', title, children }) {
  if (!title && !children) return null;
  const tones = {
    success: ['border-emerald-600 bg-emerald-50 text-emerald-900', CheckCircle2],
    error: ['border-red-600 bg-red-50 text-red-900', XCircle],
    warning: ['border-warn-700 bg-warn-50 text-amber-900', AlertTriangle],
    info: ['border-brand-700 bg-brand-50 text-brand-800', Info],
  };
  const [cls, Icon] = tones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-r-md border-l-4 px-4 py-3 text-sm', cls)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Table({ columns, rows, empty = 'Nothing to show yet.', rowKey }) {
  if (!rows?.length) return <p className="px-5 py-10 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-5 py-2.5 text-left text-xs font-semibold text-slate-600', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i} className="transition-colors duration-150 hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-5 py-3 align-top text-slate-800', c.align === 'right' && 'text-right',
                  c.mono && 'whitespace-nowrap font-mono text-xs text-slate-600', c.nowrap && 'whitespace-nowrap', !c.mono && !c.nowrap && c.align !== 'right' && 'min-w-[9rem]', c.wide && 'min-w-[18rem]')}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

/** Label/value pairs, for a record's details. */
export function Details({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.filter(Boolean).map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A hash or transaction ID: shortened, full value on hover, with a copy button. */
export function Hash({ value, n = 12 }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">–</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="font-mono text-xs text-slate-700" title={value}>{value.length > n ? `${value.slice(0, n)}…` : value}</code>
      <button type="button" onClick={copy} className="rounded p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
        aria-label={copied ? 'Copied' : 'Copy full value'}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  );
}

export function BackLink({ to, children }) {
  return (
    <Link to={to} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
      <ChevronLeft className="h-4 w-4" aria-hidden /> {children}
    </Link>
  );
}
