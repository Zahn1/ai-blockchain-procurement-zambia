// Verifies a supplier against PACRA and ZRA (Chapter 3, 3.5.2). Talks to the registries over HTTP only.

/** A certificate valid "until 30 June" lasts to the end of that day in Zambia (UTC+2). */
export const endOfDayInZambia = (isoDate) => new Date(`${isoDate}T23:59:59+02:00`);

/** e.g. "30 June 2026", always in Zambian time. */
export const zambianDate = (d) => d.toLocaleDateString('en-GB',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lusaka' });

/** Clients for the two registries. Returns null when a record does not exist. */
export function registryClients({ pacraUrl, zraUrl, fetchImpl = fetch }) {
  async function get(url) {
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new Error('registry unreachable');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`registry returned ${res.status}`);
    return res.json();
  }
  return {
    company: (registrationNumber) => get(`${pacraUrl}/api/companies/${encodeURIComponent(registrationNumber)}`),
    taxpayer: (tpin) => get(`${zraUrl}/api/taxpayers/${encodeURIComponent(tpin)}`),
  };
}

/**
 * Checks a PACRA number and TPIN. Returns { ok, problems, company, clearance }.
 * Every problem is a sentence a bidder can act on.
 */
export async function verifySupplier(registries, pacraNumber, tpin, now = new Date()) {
  const problems = [];
  let company;
  let taxpayer;
  try {
    [company, taxpayer] = await Promise.all([registries.company(pacraNumber), registries.taxpayer(tpin)]);
  } catch {
    return { ok: false, unavailable: true, problems: ['PACRA or ZRA could not be reached. Please try again later.'] };
  }

  // Company registration (PACRA)
  if (!company) problems.push('PACRA has no company with that registration number.');
  else if (company.status !== 'ACTIVE') problems.push(`PACRA lists ${company.name} as ${company.status.toLowerCase()}.`);

  // Tax compliance (ZRA)
  const clearance = taxpayer?.clearance;
  if (!taxpayer) {
    problems.push('ZRA has no taxpayer with that TPIN.');
  } else if (taxpayer.registrationNumber !== pacraNumber) {
    problems.push('That TPIN belongs to a different company at ZRA.');
  } else if (!clearance) {
    problems.push('ZRA has no tax clearance certificate for this company.');
  } else if (clearance.status !== 'VALID' || endOfDayInZambia(clearance.expiry) < now) {
    problems.push(`The ZRA tax clearance expired on ${zambianDate(endOfDayInZambia(clearance.expiry))}.`);
  }

  return { ok: problems.length === 0, problems, company, clearance };
}
