// Calls to the back end. The session token lives in this browser tab only (sessionStorage).
const TOKEN = 'procurement.token';

export const getToken = () => sessionStorage.getItem(TOKEN);
export const setToken = (t) => (t ? sessionStorage.setItem(TOKEN, t) : sessionStorage.removeItem(TOKEN));

/** An error from the API, with the server's message (and whether the ledger refused it). */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.fromLedger = body?.source === 'ledger';
    this.problems = body?.problems;
  }
}

let onSessionEnd = () => {};
export const whenSessionEnds = (fn) => { onSessionEnd = fn; };

export async function api(path, { method, body, form, raw } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: method ?? (body || form ? 'POST' : 'GET'),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && token && path !== '/auth/me') onSessionEnd();
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return res;
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Downloads a file from the API (with the session) under the server's file name. */
export async function download(path) {
  const res = await api(path, { raw: true });
  const name = (res.headers.get('content-disposition') ?? '').match(/filename="?([^";]+)/)?.[1] ?? 'download';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
