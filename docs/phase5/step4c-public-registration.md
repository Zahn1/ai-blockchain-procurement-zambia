# Phase 5, step 4c: public portal and bidder registration

Date: 24 October 2026. Both work without signing in; signed-in users reach the portal from the sidebar.

## Screens

| Screen | Path | Requirement |
|---|---|---|
| Public portal, *Search records*: tenders, contracts and payments by reference, title, company or IFMIS reference; per-record "Check document" and OCDS download | `/public` | 3.5.9 |
| Public portal, *Check a document*: tender document, signed contract or completion certificate, hashed and compared with the ledger; the file is not stored | `/public?tab=verify` | 3.5.9 |
| Public portal, *Open data*: all procurements as OCDS 1.1 JSON (CC BY 4.0), with what is and is not published | `/public?tab=data` | 3.5.9 |
| Register as a bidder: PACRA number and ZRA TPIN, account details; refused with reasons if PACRA or ZRA cannot confirm the company | `/register` | 3.5.2 |

Sign-in, registration and the public portal share one public frame (`PublicShell`). The placeholder page used during
Phase 5 is removed: every section in the sidebar is now built.

## Live run

| Step | Result |
|---|---|
| Search "solar", signed out | 1 tender, 1 contract (Alpha Computers Limited, K82,000.00, 1 of 2 paid), 1 payment; no people's names |
| Check the MS-1 completion certificate for `AWD-1823F9` | Genuine file: "Matches the ledger" (SHA-256 `2dea4643…9760` on both sides) |
| Same certificate with one character changed | "Does not match … It may have been altered." |
| Register Echo Medical Supplies Limited (stand-in: tax clearance expired) | Refused: "The ZRA tax clearance expired on 30 June 2026." No account created |
| Register Charlie General Supplies Limited | Registered; ledger code `SUP-UW6ATU`; first sign-in will set up the authenticator |

## Automated tests (Vitest + Testing Library)

`frontend/src/__tests__/public-register.test.jsx`, 6 tests, all passing (47 in the front end in total):

- signed-out search across tenders, contracts and payments, in the public frame
- "Check certificate" fills in the record; a mismatch is reported as possibly altered
- open data states that bid contents and personal data are not published
- registration: passwords must match; a company PACRA or ZRA cannot confirm is refused with reasons; a verified one gets its ledger code
