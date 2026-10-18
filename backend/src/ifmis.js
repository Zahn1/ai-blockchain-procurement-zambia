// Client for IFMIS payment instructions (Chapter 3, 3.5.6), reached over HTTP like the real system.
export function ifmisClient({ url, fetchImpl = fetch }) {
  return {
    async instruct(instruction) {
      let res;
      try {
        res = await fetchImpl(`${url}/api/payment-instructions`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(instruction), signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error('IFMIS could not be reached');
      }
      const body = await res.json();
      if (!res.ok) throw new Error(`IFMIS refused the instruction: ${body.error ?? res.status}`);
      return body;
    },
  };
}
