# Phase 5, step 4a: regulator and reports screens

Date: 24 October 2026. Front end at http://localhost:5173, back end at :3000, Fabric network `procurement` channel.

## Screens

| Screen | Path | Roles | Requirement |
|---|---|---|---|
| Risk alerts: queue by status (to review, referred, monitor, cleared), the AI's reasons in plain words with their weight and source model, the ledger hash check, past decisions, and the decision form | `/oversight` | Regulator | 3.5.7, 3.5.8 |
| Procurement history: every step from tender publication to final payment, grouped by day, with ledger transactions; search by tender reference or award ID | `/oversight/history?ref=…` | Regulator | 3.5.8 |
| Reports: procurement, payment and alert reports as PDF or spreadsheet, by role | `/reports` | Officer, regulator | 3.5.10 |

The decision form offers only what the chaincode allows next: an unreviewed alert can be cleared, monitored or referred;
a monitored one cleared or referred; a referred one only cleared. The reason must be at least 20 characters.

The history layout follows the "Activity Timeline" pattern from 21st.dev (events grouped by day along a rail), rebuilt in the
project's own components and colours.

## Back-end changes

- `GET /api/oversight/history` also accepts an award ID, since alerts on a contract name the award. Test: *can be found from the award ID*.
- **Bug found and fixed:** the IFMIS stand-in kept its counter in memory, so after the laptop restarted it issued
  `IFMIS-2026-000001` a second time (to `AWD-1823F9` MS-1; first used for `AWD-191E9F` MS-1 on 18 October). The stand-in now
  keeps its records in `backend/data/ifmis-standin.json`, as the real system would, and carries on numbering after a restart.
  Test: *keeps its records, so payment references carry on after a restart instead of repeating*. The repeated reference
  stays on the ledger as recorded; it can be traced to this bug in the stand-in, not the real IFMIS.

Back end: 175 tests passing.

## Live run (continuing tender `ZPPA/MOH/2026/F0001`, award `AWD-1823F9`)

| Step | Who | Result |
|---|---|---|
| Review alert `ALT-19EC4822` (score 83: one bidder, supplier has won every award from this buyer) | Regulator | Decision **Monitor** with a written reason; record hash `e15468c8…` signed on the ledger with the regulator's identity |
| Retry the held payment for MS-1 | Officer | Paid through IFMIS; K41,000.00 recorded on the ledger; contract shows 1 of 2 milestones paid, no unresolved alerts |
| Procurement history for `AWD-1823F9` | Regulator | Shows the tender, the sealed bid, both approvals, opening, recommendation, award, signing, certificate, alert, decision and payment, grouped by day |
| Reports | Regulator | All six downloads (three reports, PDF and XLSX) returned 200 |

## Automated tests (Vitest + Testing Library)

`frontend/src/__tests__/oversight-reports.test.jsx`, 6 tests, all passing (35 in the front end in total):

- unreviewed alerts come first, with the AI's reasons in plain words and the ledger hash check
- only the decisions the ledger allows next are offered; a cleared alert is final
- a decision needs a 20-character reason and is sent to be recorded on the ledger
- the history is grouped by day, amounts are in kwacha, off-chain steps are labelled
- each role sees only the reports it may download; the chosen format is downloaded
