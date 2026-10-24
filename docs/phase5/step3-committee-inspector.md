# Phase 5, step 3: committee, award and inspector screens

Date: 24 October 2026. Front end at http://localhost:5173, back end at :3000, Fabric network `procurement` channel.

## Screens

| Screen | Path | Roles | Requirement |
|---|---|---|---|
| Tenders to evaluate, with the next step for each | `/evaluation` | Officer (all), committee member (own) | 3.5.5 |
| Evaluation: progress steps, committee and its ledger-signed approvals, opening with the hash check, scoring, 70/30 ranking, recommendation | `/evaluation/tender?ref=…` | Officer, appointed members | 3.5.5 |
| Contracts: tenders ready to award, and every contract with its status | `/contracts` | Officer (all), inspector (own) | 3.5.6 |
| Contract: ledger record, risk alerts, signing with the payment schedule, milestones, certificates, payments or why they are held | `/contracts/detail?id=…` | Officer, assigned inspector | 3.5.6, 3.5.7 |

New API route: `GET /api/evaluation/tenders` (officer: every tender; member: only those they are appointed to).
Back-end test: *a member sees only the tenders they are appointed to, with where each stands*. Back end: 173 tests passing.

## Live run on the network (tender `ZPPA/MOH/2026/F0001`, continuing from step 2)

| Step | Who | Result |
|---|---|---|
| Appoint committee | Officer | Chanda Mwape and Joseph Tembo appointed |
| Approve opening | Each member | Two approvals signed with each member's own identity; quorum 2 of 2 (block 103) |
| Open bids | Member | `BID-7A13001F`: stored file matches its ledger hash; opening recorded on the ledger |
| Price and scores | Members | Price K82,000.00; technical 78 and 72 with comments |
| Ranking | System | Technical 75, financial 100, combined 82.5, passes the mark of 60 |
| Recommendation | Member | Top-ranked bid recommended; evaluation report hash `7d84c43d…` |
| Award | Officer | `AWD-1823F9`; AI risk score 83 (single bidder), alert `ALT-19EC4822` raised; payments held |
| Sign | Officer | Two milestones of K41,000.00 (20 Nov and 18 Dec 2026), inspector Bwalya Kunda; contract hash on the ledger |
| Certify MS-1 | Inspector | Certificate hash recorded; payment **held** by the ledger: "tender … is flagged as high risk (alert ALT-19EC4822, score 83, OPEN)" |

The held payment is released in step 4, when a regulator reviews the alert.

## Automated tests (Vitest + Testing Library)

`frontend/src/__tests__/evaluation-contracts.test.jsx`, 12 tests, all passing (29 in the front end in total):

- evaluation and contract stages in words
- a member approves opening, signed on the ledger
- bids cannot be opened before the quorum; the integrity result is shown after opening, including a failed check
- a member records their own technical score with a comment
- the top-ranked bid is preselected; choosing another needs a 50-character justification
- after the recommendation the report hash is shown and scoring is closed
- the officer signs only when the milestones add up to the contract value, and not during the standstill
- the officer sees why a payment is held and can retry it
- the inspector certifies a milestone and sees the IFMIS payment reference
- an inspector cannot reach the evaluation
