# Phase 6 system test

Run `MVMDI2ZT` on 24 October 2026 at 14:26 · tender `ZPPA/MOH/2026/ST-MVMDI2ZT` · award `AWD-D077DB`

One full procurement through the running system: the API, the Fabric network (ZPPA and OAG peers, majority endorsement), IPFS,
PostgreSQL, the AI risk service and the stand-ins for PACRA, ZRA and IFMIS. Script: `backend/system-test/run.mjs`.

**Result: 77 passed, 0 failed** (77 checks)

| # | Req. | Check | Result | Detail | Time (ms) |
|---|---|---|---|---|---|
| 1 | 3.5.1 | Every role signs in with password and one-time code | PASS | 9 users |  |
| 2 | 3.5.1 | Wrong password is refused | PASS | 401; Email or password is incorrect. | 290 |
| 3 | 3.5.1 | Correct password but wrong one-time code is refused | PASS | 401; That code is not valid. Check the time on your phone and try again. | 7 |
| 4 | 3.5.1 | No session: dashboard refused | PASS | 401; Please sign in. | 2 |
| 5 | 3.5.1 | Bidder cannot publish a tender | PASS | 403; Your role does not allow this action. | 5 |
| 6 | 3.5.1 | Bidder cannot see risk alerts | PASS | 403; Your role does not allow this action. | 6 |
| 7 | 3.5.1 | Bidder cannot see the evaluation | PASS | 403; Your role does not allow this action. | 4 |
| 8 | 3.5.1 | Officer cannot see risk alerts | PASS | 403; Your role does not allow this action. | 5 |
| 9 | 3.5.1 | Officer cannot submit a bid | PASS | 403; Your role does not allow this action. | 5 |
| 10 | 3.5.1 | Officer cannot manage users | PASS | 403; Your role does not allow this action. | 4 |
| 11 | 3.5.1 | Committee member cannot publish a tender | PASS | 403; Your role does not allow this action. | 4 |
| 12 | 3.5.1 | Committee member cannot certify a milestone | PASS | 403; Your role does not allow this action. | 4 |
| 13 | 3.5.1 | Inspector cannot see the evaluation | PASS | 403; Your role does not allow this action. | 4 |
| 14 | 3.5.1 | Inspector cannot award | PASS | 403; Your role does not allow this action. | 4 |
| 15 | 3.5.1 | Regulator cannot publish a tender | PASS | 403; Your role does not allow this action. | 5 |
| 16 | 3.5.1 | Administrator cannot see risk alerts | PASS | 403; Your role does not allow this action. | 4 |
| 17 | 3.5.2 | Company with an expired ZRA tax clearance is refused | PASS | 422; The ZRA tax clearance expired on 30 June 2026. | 13 |
| 18 | 3.5.2 | Company deregistered at PACRA is refused | PASS | 422; PACRA lists Delta Construction Limited as deregistered. | 8 |
| 19 | 3.5.2 | A company that is already registered cannot register again | PASS | 409; Alpha Computers Limited is already registered. Ask your company's existing user to contact the system administrator for another account. | 4 |
| 20 | 3.5.2 | TPIN that does not belong to the company is refused | PASS | 422; Registration could not be verified. | 11 |
| 21 | 3.5.3 | Officer publishes a tender; hash and closing time go on the ledger | PASS | 201; block 113 | 2075 |
| 22 | 3.5.3 | The ledger holds the document's SHA-256 hash | PASS | e241f952ad599c3d |  |
| 23 | 3.5.3 | The published document matches the ledger | PASS |  | 10 |
| 24 | 3.5.3 | An altered copy does not match | PASS | one figure changed |  |
| 25 | 3.5.3 | The same reference cannot be published twice | PASS | 409; tender ZPPA/MOH/2026/ST-MVMDI2ZT already exists | 18 |
| 26 | 3.5.4 | Alpha submits a sealed bid; signed receipt returned | PASS | 201; BID-96B2443C, block 114 | 2049 |
| 27 | 3.5.4 | Bravo submits a sealed bid; signed receipt returned | PASS | 201; BID-A20C2BEF, block 115 | 2050 |
| 28 | 3.5.4 | Charlie submits a sealed bid; signed receipt returned | PASS | 201; BID-F989DB69, block 116 | 2049 |
| 29 | 3.5.4 | Only the encrypted file's hash is on the ledger, not the bid | PASS | cipher hash ≠ plain hash |  |
| 30 | 3.5.4 | The receipt's signature checks out | PASS |  | 5 |
| 31 | 3.5.4 | A receipt with a changed time fails the check | PASS |  |  |
| 32 | 3.5.4 | The same company cannot bid twice | PASS | 409; supplier SUP-FS9373 has already bid on tender ZPPA/MOH/2026/ST-MVMDI2ZT | 14 |
| 33 | 3.5.4 | Bids stay sealed before closing | PASS | 3 sealed |  |
| 34 | 3.5.5 | Officer appoints a committee of two | PASS | 200; 2 candidates | 21 |
| 35 | 3.5.5 | Approval to open before closing is refused by the ledger | PASS | 409; bids for tender ZPPA/MOH/2026/ST-MVMDI2ZT cannot be approved for opening before closing at 2026-10-24T12:28:40Z | 15 |
| 36 | 3.5.5 | Opening without the committee's approvals is refused | PASS | 409; Opening needs 2 committee approvals on the ledger; it has 0. | 13 |
| 37 | 3.5.5 | Tamper test: Charlie's stored bid file swapped in the database | PASS | cid replaced with another file |  |
| 38 | 3.5.5 | A late bid after closing is refused by the ledger | PASS | 409; bidding for tender ZPPA/MOH/2026/ST-MVMDI2ZT closed at 2026-10-24T12:28:40Z | 37 |
| 39 | 3.5.5 | Committee member 1 approves opening (signed with own identity) | PASS | 200 | 2041 |
| 40 | 3.5.5 | The same member cannot approve twice | PASS | 409; You have already approved opening for this tender. | 10 |
| 41 | 3.5.5 | Committee member 2 approves; quorum reached | PASS | 200 | 2049 |
| 42 | 3.5.5 | Bids open; each checked against its ledger hash | PASS |  | 4118 |
| 43 | 3.5.5 | The swapped bid fails the integrity check and is not opened | PASS | The stored file does not match the hash recorded on the ledger. |  |
| 44 | 3.5.5 | A technical score outside 0–100 is refused | PASS | 400; The technical score is a whole number from 0 to 100. | 7 |
| 45 | 3.5.5 | Ranking: 70% technical, 30% financial | PASS | BID-96B2443C 84.98, BID-A20C2BEF 80.4 |  |
| 46 | 3.5.5 | Departing from the ranking without a justification is refused | PASS | 400; This departs from the recommended bid (BID-96B2443C). Write a justification of at least 50 characters. | 10 |
| 47 | 3.5.5 | The committee recommends the top-ranked bid; report hash recorded | PASS | 201; 337d3338526cd3dd | 14 |
| 48 | 3.5.5 | After the recommendation, scores cannot change | PASS | 409; The committee has already made its recommendation; the evaluation is closed. | 7 |
| 49 | 3.5.6 | Officer awards to the recommended bid; evaluation hash on the ledger | PASS | 201; AWD-D077DB, 132000 K | 4156 |
| 50 | 3.5.7 | The award is scored by the AI service | PASS | score 82, alert ALT-C44A394C |  |
| 51 | 3.5.6 | Milestones that do not add up to the contract value are refused | PASS | 400; The milestones add up to K1, but the contract is for K132,000. | 14 |
| 52 | 3.5.6 | Officer signs the contract: hash and payment schedule on the ledger | PASS | 200; 2 milestones, inspector of 1 | 6115 |
| 53 | 3.5.6 | Payment before an inspector certifies is refused | PASS | 409; An inspector has not certified this milestone yet. | 9 |
| 54 | 3.5.6 | Inspector certifies MS-1 with a signed certificate | PASS | 200; payment HELD | 2087 |
| 55 | 3.5.7 | The contract is scored by the AI before payment | PASS | score 0 |  |
| 56 | 3.5.6 | The same milestone cannot be certified twice | PASS | 409; This milestone is already certified. | 9 |
| 57 | 3.5.6 | Flagged as high risk: the ledger holds the payment | PASS | tender ZPPA/MOH/2026/ST-MVMDI2ZT is flagged as high risk (alert ALT-C44A394C, score 82, OPEN); payment is held until a regulator clears or decides to monitor it |  |
| 58 | 3.5.8 | Regulator decides "monitor" on ALT-C44A394C (score 82) | PASS | 201; record hash 024cb1e6ade6903f | 2042 |
| 59 | 3.5.8 | A decision the ledger does not allow next is refused | PASS | 409; an alert that is MONITOR cannot become "MONITOR" | 17 |
| 60 | 3.5.6 | After the decision the payment goes through | PASS | IFMIS-2026-000003 | 2045 |
| 61 | 3.5.6 | The IFMIS payment reference is recorded on the ledger | PASS | IFMIS-2026-000003 |  |
| 62 | 3.5.6 | The same milestone cannot be paid twice | PASS | 409; This milestone is already paid. | 9 |
| 63 | 3.5.8 | The regulator sees the whole history, from publication to payment | PASS | 16 events | 36 |
| 64 | 3.5.8 | The history is in time order | PASS |  |  |
| 65 | 3.5.9 | Anyone can find the tender, contract and payment without signing in | PASS |  | 26 |
| 66 | 3.5.9 | No personal data or bid contents in public results | PASS |  |  |
| 67 | 3.5.9 | The signed contract can be checked against the ledger | PASS |  |  |
| 68 | 3.5.9 | An altered completion certificate does not match | PASS |  |  |
| 69 | 3.5.9 | OCDS release includes the award, milestones and the payment | PASS | ocds-zmproc-ZPPA-MOH-2026-ST-MVMDI2ZT | 27 |
| 70 | 3.5.10 | procurement report as PDF | PASS | 2557 bytes | 59 |
| 71 | 3.5.10 | procurement report as XLSX | PASS | 7385 bytes | 57 |
| 72 | 3.5.10 | payments report as PDF | PASS | 2583 bytes | 24 |
| 73 | 3.5.10 | payments report as XLSX | PASS | 7347 bytes | 18 |
| 74 | 3.5.10 | alerts report as PDF | PASS | 2841 bytes | 16 |
| 75 | 3.5.10 | alerts report as XLSX | PASS | 7587 bytes | 16 |
| 76 | 3.5.10 | A bidder cannot download reports | PASS | 403; Your role does not allow this report. | 5 |
| 77 | 3.5.10 | E-mail notifications sent for the award and the payment | PASS | 2 new messages in Mailpit |  |

## Checks per requirement

| Requirement | Checks | Passed |
|---|---|---|
| 3.5.1 | 16 | 16 |
| 3.5.2 | 4 | 4 |
| 3.5.3 | 5 | 5 |
| 3.5.4 | 8 | 8 |
| 3.5.5 | 15 | 15 |
| 3.5.6 | 10 | 10 |
| 3.5.7 | 2 | 2 |
| 3.5.8 | 4 | 4 |
| 3.5.9 | 5 | 5 |
| 3.5.10 | 8 | 8 |

Median response time of the 59 timed calls: 14 ms.
