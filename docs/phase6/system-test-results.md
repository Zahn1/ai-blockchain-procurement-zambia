# Phase 6 system test

Run `MVNNC0SK` on 25 October 2026 at 11:49 · tender `ZPPA/MOH/2026/ST-MVNNC0SK` · award `AWD-13DDE3`

One full procurement through the running system: the API, the Fabric network (ZPPA and OAG peers, majority endorsement), IPFS,
PostgreSQL, the AI risk service and the stand-ins for PACRA, ZRA and IFMIS. Script: `backend/system-test/run.mjs`.

**Result: 77 passed, 0 failed** (77 checks)

| # | Req. | Check | Result | Detail | Time (ms) |
|---|---|---|---|---|---|
| 1 | 3.5.1 | Every role signs in with password and one-time code | PASS | 9 users |  |
| 2 | 3.5.1 | Wrong password is refused | PASS | 401; Email or password is incorrect. | 380 |
| 3 | 3.5.1 | Correct password but wrong one-time code is refused | PASS | 401; That code is not valid. Check the time on your phone and try again. | 6 |
| 4 | 3.5.1 | No session: dashboard refused | PASS | 401; Please sign in. | 4 |
| 5 | 3.5.1 | Bidder cannot publish a tender | PASS | 403; Your role does not allow this action. | 6 |
| 6 | 3.5.1 | Bidder cannot see risk alerts | PASS | 403; Your role does not allow this action. | 5 |
| 7 | 3.5.1 | Bidder cannot see the evaluation | PASS | 403; Your role does not allow this action. | 7 |
| 8 | 3.5.1 | Officer cannot see risk alerts | PASS | 403; Your role does not allow this action. | 4 |
| 9 | 3.5.1 | Officer cannot submit a bid | PASS | 403; Your role does not allow this action. | 5 |
| 10 | 3.5.1 | Officer cannot manage users | PASS | 403; Your role does not allow this action. | 5 |
| 11 | 3.5.1 | Committee member cannot publish a tender | PASS | 403; Your role does not allow this action. | 4 |
| 12 | 3.5.1 | Committee member cannot certify a milestone | PASS | 403; Your role does not allow this action. | 6 |
| 13 | 3.5.1 | Inspector cannot see the evaluation | PASS | 403; Your role does not allow this action. | 6 |
| 14 | 3.5.1 | Inspector cannot award | PASS | 403; Your role does not allow this action. | 4 |
| 15 | 3.5.1 | Regulator cannot publish a tender | PASS | 403; Your role does not allow this action. | 5 |
| 16 | 3.5.1 | Administrator cannot see risk alerts | PASS | 403; Your role does not allow this action. | 4 |
| 17 | 3.5.2 | Company with an expired ZRA tax clearance is refused | PASS | 422; The ZRA tax clearance expired on 30 June 2026. | 54 |
| 18 | 3.5.2 | Company deregistered at PACRA is refused | PASS | 422; PACRA lists Delta Construction Limited as deregistered. | 9 |
| 19 | 3.5.2 | A company that is already registered cannot register again | PASS | 409; Alpha Computers Limited is already registered. Ask your company's existing user to contact the system administrator for another account. | 5 |
| 20 | 3.5.2 | TPIN that does not belong to the company is refused | PASS | 422; Registration could not be verified. | 9 |
| 21 | 3.5.3 | Officer publishes a tender; hash and closing time go on the ledger | PASS | 201; block 2361 | 2185 |
| 22 | 3.5.3 | The ledger holds the document's SHA-256 hash | PASS | d3eb035bf4b66fcf |  |
| 23 | 3.5.3 | The published document matches the ledger | PASS |  | 11 |
| 24 | 3.5.3 | An altered copy does not match | PASS | one figure changed |  |
| 25 | 3.5.3 | The same reference cannot be published twice | PASS | 409; tender ZPPA/MOH/2026/ST-MVNNC0SK already exists | 19 |
| 26 | 3.5.4 | Alpha submits a sealed bid; signed receipt returned | PASS | 201; BID-7A49AA6B, block 2362 | 2086 |
| 27 | 3.5.4 | Bravo submits a sealed bid; signed receipt returned | PASS | 201; BID-9F66623B, block 2363 | 2051 |
| 28 | 3.5.4 | Charlie submits a sealed bid; signed receipt returned | PASS | 201; BID-5BD6F56A, block 2364 | 2047 |
| 29 | 3.5.4 | Only the encrypted file's hash is on the ledger, not the bid | PASS | cipher hash ≠ plain hash |  |
| 30 | 3.5.4 | The receipt's signature checks out | PASS |  | 5 |
| 31 | 3.5.4 | A receipt with a changed time fails the check | PASS |  |  |
| 32 | 3.5.4 | The same company cannot bid twice | PASS | 409; supplier SUP-FS9373 has already bid on tender ZPPA/MOH/2026/ST-MVNNC0SK | 17 |
| 33 | 3.5.4 | Bids stay sealed before closing | PASS | 3 sealed |  |
| 34 | 3.5.5 | Officer appoints a committee of two | PASS | 200; 2 candidates | 26 |
| 35 | 3.5.5 | Approval to open before closing is refused by the ledger | PASS | 409; bids for tender ZPPA/MOH/2026/ST-MVNNC0SK cannot be approved for opening before closing at 2026-10-25T09:51:41Z | 17 |
| 36 | 3.5.5 | Opening without the committee's approvals is refused | PASS | 409; Opening needs 2 committee approvals on the ledger; it has 0. | 12 |
| 37 | 3.5.5 | Tamper test: Charlie's stored bid file swapped in the database | PASS | cid replaced with another file |  |
| 38 | 3.5.5 | A late bid after closing is refused by the ledger | PASS | 409; bidding for tender ZPPA/MOH/2026/ST-MVNNC0SK closed at 2026-10-25T09:51:41Z | 44 |
| 39 | 3.5.5 | Committee member 1 approves opening (signed with own identity) | PASS | 200 | 2062 |
| 40 | 3.5.5 | The same member cannot approve twice | PASS | 409; You have already approved opening for this tender. | 15 |
| 41 | 3.5.5 | Committee member 2 approves; quorum reached | PASS | 200 | 2070 |
| 42 | 3.5.5 | Bids open; each checked against its ledger hash | PASS |  | 4142 |
| 43 | 3.5.5 | The swapped bid fails the integrity check and is not opened | PASS | The stored file does not match the hash recorded on the ledger. |  |
| 44 | 3.5.5 | A technical score outside 0–100 is refused | PASS | 400; The technical score is a whole number from 0 to 100. | 6 |
| 45 | 3.5.5 | Ranking: 70% technical, 30% financial | PASS | BID-7A49AA6B 84.98, BID-9F66623B 80.4 |  |
| 46 | 3.5.5 | Departing from the ranking without a justification is refused | PASS | 400; This departs from the recommended bid (BID-7A49AA6B). Write a justification of at least 50 characters. | 12 |
| 47 | 3.5.5 | The committee recommends the top-ranked bid; report hash recorded | PASS | 201; b5268998afef1919 | 20 |
| 48 | 3.5.5 | After the recommendation, scores cannot change | PASS | 409; The committee has already made its recommendation; the evaluation is closed. | 8 |
| 49 | 3.5.6 | Officer awards to the recommended bid; evaluation hash on the ledger | PASS | 201; AWD-13DDE3, 132000 K | 4198 |
| 50 | 3.5.7 | The award is scored by the AI service | PASS | score 87, alert ALT-2F7F9A77 |  |
| 51 | 3.5.6 | Milestones that do not add up to the contract value are refused | PASS | 400; The milestones add up to K1, but the contract is for K132,000. | 10 |
| 52 | 3.5.6 | Officer signs the contract: hash and payment schedule on the ledger | PASS | 200; 2 milestones, inspector of 1 | 6139 |
| 53 | 3.5.6 | Payment before an inspector certifies is refused | PASS | 409; An inspector has not certified this milestone yet. | 7 |
| 54 | 3.5.6 | Inspector certifies MS-1 with a signed certificate | PASS | 200; payment HELD | 2087 |
| 55 | 3.5.7 | The contract is scored by the AI before payment | PASS | score 0 |  |
| 56 | 3.5.6 | The same milestone cannot be certified twice | PASS | 409; This milestone is already certified. | 9 |
| 57 | 3.5.6 | Flagged as high risk: the ledger holds the payment | PASS | tender ZPPA/MOH/2026/ST-MVNNC0SK is flagged as high risk (alert ALT-2F7F9A77, score 87, OPEN); payment is held until a regulator clears or decides to monitor it |  |
| 58 | 3.5.8 | Regulator decides "monitor" on ALT-2F7F9A77 (score 87) | PASS | 201; record hash 7b20913043aa2ffc | 2048 |
| 59 | 3.5.8 | A decision the ledger does not allow next is refused | PASS | 409; an alert that is MONITOR cannot become "MONITOR" | 13 |
| 60 | 3.5.6 | After the decision the payment goes through | PASS | IFMIS-2026-000004 | 2066 |
| 61 | 3.5.6 | The IFMIS payment reference is recorded on the ledger | PASS | IFMIS-2026-000004 |  |
| 62 | 3.5.6 | The same milestone cannot be paid twice | PASS | 409; This milestone is already paid. | 17 |
| 63 | 3.5.8 | The regulator sees the whole history, from publication to payment | PASS | 16 events | 49 |
| 64 | 3.5.8 | The history is in time order | PASS |  |  |
| 65 | 3.5.9 | Anyone can find the tender, contract and payment without signing in | PASS |  | 33 |
| 66 | 3.5.9 | No personal data or bid contents in public results | PASS |  |  |
| 67 | 3.5.9 | The signed contract can be checked against the ledger | PASS |  |  |
| 68 | 3.5.9 | An altered completion certificate does not match | PASS |  |  |
| 69 | 3.5.9 | OCDS release includes the award, milestones and the payment | PASS | ocds-zmproc-ZPPA-MOH-2026-ST-MVNNC0SK | 32 |
| 70 | 3.5.10 | procurement report as PDF | PASS | 2762 bytes | 81 |
| 71 | 3.5.10 | procurement report as XLSX | PASS | 7548 bytes | 86 |
| 72 | 3.5.10 | payments report as PDF | PASS | 2744 bytes | 34 |
| 73 | 3.5.10 | payments report as XLSX | PASS | 7456 bytes | 24 |
| 74 | 3.5.10 | alerts report as PDF | PASS | 2947 bytes | 20 |
| 75 | 3.5.10 | alerts report as XLSX | PASS | 7665 bytes | 19 |
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

Median response time of the 59 timed calls: 17 ms.
