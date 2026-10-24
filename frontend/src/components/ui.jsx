// Shared building blocks, so every screen looks and behaves the same.
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = 'default' }) {
  const tones = {
    default: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-50 text-brand-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {Icon && <span className={cx('rounded-lg p-2', tones[tone])}><Icon className="h-4 w-4" aria-hidden /></span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Button({ variant = 'primary', busy, className, children, ...props }) {
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/60',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    danger: 'bg-red-700 text-white hover:bg-red-800',
    ghost: 'text-slate-700 hover:bg-slate-100',
  };
  return (
    <button
      type="button"
      {...props}
      disabled={busy || props.disabled}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant], className)}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

const inputClass = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
export const Input = (props) => <input {...props} className={cx(inputClass, props.className)} />;
export const Select = ({ children, ...props }) => <select {...props} className={cx(inputClass, props.className)}>{children}</select>;
export const Textarea = (props) => <textarea {...props} className={cx(inputClass, props.className)} />;

export function Badge({ tone = 'default', children }) {
  const tones = {
    default: 'bg-slate-100 text-slate-700 ring-slate-200',
    brand: 'bg-brand-50 text-brand-800 ring-brand-100',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    danger: 'bg-red-50 text-red-800 ring-red-200',
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone])}>{children}</span>;
}

export function Message({ tone = 'info', title, children }) {
  if (!title && !children) return null;
  const tones = {
    success: ['border-brand-100 bg-brand-50 text-brand-800', CheckCircle2],
    error: ['border-red-200 bg-red-50 text-red-800', XCircle],
    warning: ['border-amber-200 bg-amber-50 text-amber-800', AlertTriangle],
    info: ['border-sky-200 bg-sky-50 text-sky-800', Info],
  };
  const [cls, Icon] = tones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-lg border p-4 text-sm', cls)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Table({ columns, rows, empty = 'Nothing to show yet.', rowKey }) {
  if (!rows?.length) return <p className="px-5 py-8 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i} className="hover:bg-slate-50/60">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-5 py-3 align-top text-slate-700', c.align === 'right' && 'text-right tabular-nums',
                  c.mono && 'whitespace-nowrap font-mono text-xs', !c.mono && c.align !== 'right' && 'min-w-[9rem]', c.wide && 'min-w-[18rem]')}>
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
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
