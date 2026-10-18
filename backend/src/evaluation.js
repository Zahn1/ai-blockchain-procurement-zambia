// Evaluation method for Chapter 3, 3.5.5: technical and financial scores and the recommended award.
//
//   technical score  = average of the committee members' scores (0–100)
//   eligible         = technical score at or above the pass mark
//   financial score  = lowest eligible price ÷ this bid's price × 100
//   combined score   = technical × weight% + financial × (100 − weight)%
//   recommended      = the eligible bid with the highest combined score (ties: the lower price)
import crypto from 'node:crypto';

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * bids: [{ bidId, supplierRef, priceNgwee, technicalScores: [n, …] }]
 * Returns rows sorted best first, and the recommended bid ID (null if no bid is eligible).
 */
export function rankBids(bids, { technicalWeight = 70, passMark = 60 } = {}) {
  const rows = bids.map((b) => {
    const technical = b.technicalScores.length
      ? round2(b.technicalScores.reduce((a, s) => a + s, 0) / b.technicalScores.length) : null;
    return { bidId: b.bidId, supplierRef: b.supplierRef, priceNgwee: b.priceNgwee, technical,
      eligible: technical !== null && technical >= passMark && b.priceNgwee > 0 };
  });
  const prices = rows.filter((r) => r.eligible).map((r) => r.priceNgwee);
  const lowest = prices.length ? Math.min(...prices) : null;
  for (const r of rows) {
    r.financial = r.eligible ? round2((lowest / r.priceNgwee) * 100) : null;
    r.combined = r.eligible ? round2((r.technical * technicalWeight + r.financial * (100 - technicalWeight)) / 100) : null;
  }
  rows.sort((a, b) => (b.eligible - a.eligible) || ((b.combined ?? -1) - (a.combined ?? -1))
    || ((a.priceNgwee ?? Infinity) - (b.priceNgwee ?? Infinity)) || a.bidId.localeCompare(b.bidId));
  return { rows, recommendedBidId: rows[0]?.eligible ? rows[0].bidId : null };
}

/** JSON with keys in a fixed order, so the same report always gives the same hash. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const reportHash = (report) => crypto.createHash('sha256').update(canonicalJson(report)).digest('hex');

export const MIN_JUSTIFICATION = 50; // characters, when departing from the recommended award
