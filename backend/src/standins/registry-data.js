// FICTIONAL test records for the PACRA and ZRA stand-ins. No real companies, numbers or people.
// Each record exists to exercise one case in Chapter 3, 3.5.2.

/** Companies register at PACRA (Patents and Companies Registration Agency). */
export const pacraCompanies = [
  { registrationNumber: '120260000101', name: 'Alpha Computers Limited', type: 'Private Company Limited by Shares', status: 'ACTIVE', incorporated: '2014-03-11' },
  { registrationNumber: '120260000102', name: 'Bravo Tech Solutions Limited', type: 'Private Company Limited by Shares', status: 'ACTIVE', incorporated: '2017-08-02' },
  { registrationNumber: '120260000103', name: 'Charlie General Supplies Limited', type: 'Private Company Limited by Shares', status: 'ACTIVE', incorporated: '2019-01-23' },
  // Case: company no longer registered
  { registrationNumber: '120260000104', name: 'Delta Construction Limited', type: 'Private Company Limited by Shares', status: 'DEREGISTERED', incorporated: '2009-06-30' },
  // Case: registered, but its tax clearance has expired (see ZRA)
  { registrationNumber: '120260000105', name: 'Echo Medical Supplies Limited', type: 'Private Company Limited by Shares', status: 'ACTIVE', incorporated: '2016-11-15' },
  // Case: registered, but has no tax clearance at all (see ZRA)
  { registrationNumber: '120260000106', name: 'Foxtrot Logistics Limited', type: 'Private Company Limited by Shares', status: 'ACTIVE', incorporated: '2021-04-07' },
];

/** Taxpayers registered at ZRA (Zambia Revenue Authority), each linked to its PACRA number. */
export const zraTaxpayers = [
  { tpin: '1000000101', registrationNumber: '120260000101', clearance: { number: 'TCC-2026-0101', status: 'VALID', expiry: '2027-03-31' } },
  { tpin: '1000000102', registrationNumber: '120260000102', clearance: { number: 'TCC-2026-0102', status: 'VALID', expiry: '2027-06-30' } },
  { tpin: '1000000103', registrationNumber: '120260000103', clearance: { number: 'TCC-2026-0103', status: 'VALID', expiry: '2027-01-31' } },
  { tpin: '1000000104', registrationNumber: '120260000104', clearance: { number: 'TCC-2025-0104', status: 'VALID', expiry: '2027-02-28' } },
  { tpin: '1000000105', registrationNumber: '120260000105', clearance: { number: 'TCC-2025-0105', status: 'EXPIRED', expiry: '2026-06-30' } },
  { tpin: '1000000106', registrationNumber: '120260000106', clearance: null },
];
