// Formatting in UK English and Zambian time.
export const kwacha = (ngwee) => (ngwee == null ? '–'
  : `K${(Number(ngwee) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const kwachaShort = (ngwee) => {
  const k = Number(ngwee) / 100;
  if (k >= 1e6) return `K${(k / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })}m`;
  if (k >= 1e3) return `K${(k / 1e3).toLocaleString('en-GB', { maximumFractionDigits: 0 })}k`;
  return `K${k.toLocaleString('en-GB')}`;
};
export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lusaka' }) : '–');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'Africa/Lusaka' }) : '–');
export const short = (hash, n = 10) => (hash ? `${hash.slice(0, n)}…` : '–');
export const ROLE_NAMES = { ADMIN: 'Administrator', OFFICER: 'Procurement officer', SUPPLIER: 'Bidder', REGULATOR: 'Regulator',
  COMMITTEE: 'Evaluation committee', INSPECTOR: 'Inspector' };

/** Where a tender stands, in words. `ledger` is the ledger record when we have it; the list only knows the closing time. */
export function tenderStage(closingTime, ledger) {
  if (ledger?.status === 'AWARDED') return ['Awarded', 'brand'];
  if (ledger?.status === 'CANCELLED') return ['Cancelled', 'default'];
  if (new Date(closingTime) > new Date()) return ['Open for bids', 'success'];
  if (ledger?.openingApproved) return ['Bids opened', 'info'];
  return ['Closed', 'default'];
}
