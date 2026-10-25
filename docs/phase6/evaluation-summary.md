# Phase 6: testing and evaluation summary

24 October 2026. Everything here was run on the working prototype: Hyperledger Fabric 2.5 with ZPPA and OAG peers,
IPFS, PostgreSQL, the AI risk service and the React front end, on one MacBook Pro (M1 Pro, 16 GB).

## 1. Testing at each level

| Level | What | Tests | Result | Coverage | Evidence |
|---|---|---|---|---|---|
| Unit | Chaincode (Go): tender, bid, award, milestone and alert contracts | 47 | all pass | 76.2% of statements | `chaincode-tests.txt` |
| Unit and integration | Back-end API (Jest + Supertest, real PostgreSQL, fake ledger) | 189 | all pass | 88.8% statements, 76.9% branches | `backend-tests.txt` |
| Unit | AI service and models (pytest), including the bidder-network model | 25 | all pass | 92% (training script excluded) | `ai-tests.txt` |
| Component | Front end (Vitest + Testing Library), including accessibility | 62 | all pass | 87.8% statements, 80.9% branches | `frontend-tests.txt` |
| System | One full procurement through the running system, all ten requirements | 77 checks | 77 pass | – | `system-test-results.md` |
| Performance | Ledger reads and writes, API, AI service; Hyperledger Caliper | 14 measurements; 7 Caliper rounds | 0 failures | – | `performance.md`, `caliper.md` |
| Security and privacy | Tampering, early opening, late bids, role access, ledger scan | in the system test, plus the scan | all pass | – | `system-test-results.md`, `privacy-scan.md` |
| Accessibility | WCAG 2.1 A and AA, automated and in a real browser | 19 screens | 0 violations after fixes | – | `accessibility.md` |
| Usability | Tasks and SUS with participants | kit ready | **to be run** | – | `usability/` |

`GetTenderHistory` shows 0% in the chaincode unit tests because it reads the peer's history database, which the test
mock does not provide; it is exercised on the live network by the system test and the regulator's history screen.

## 2. Functional requirements (Chapter 3)

| Requirement | Screens | System test checks | Status |
|---|---|---|---|
| 3.5.1 User authentication and role management | Sign-in with authenticator, Users, Audit log | 16: every role signs in with password and one-time code; wrong password and wrong code refused; 12 role-access checks refused | Met |
| 3.5.2 Supplier registration and verification | Register as a bidder, Bidders and entities | 4: expired tax clearance, deregistered company, duplicate company and mismatched TPIN all refused | Met |
| 3.5.3 Tender publication | Tenders, Publish tender, Tender record | 5: hash and closing time on the ledger; genuine copy matches, altered copy does not; duplicate refused | Met |
| 3.5.4 Encrypted bid submission | My bids, Submit a sealed bid, receipt | 8: three sealed bids; only the ciphertext hash on the ledger; receipt signature valid, forged receipt invalid; second bid refused; bids stay sealed | Met |
| 3.5.5 Bid opening and evaluation | Evaluation | 15: committee appointed; approval before closing and opening without quorum refused; late bid refused; two approvals, double approval refused; bids opened against their hashes, swapped bid file detected; out-of-range score refused; 70/30 ranking, justification rule, recommendation, scores locked | Met |
| 3.5.6 Smart contract award and milestone payment | Contracts, Contract | 10: award with evaluation hash; schedule must equal the contract value; no payment before certification; high-risk payment held, then released; IFMIS reference on the ledger; no double certification or payment | Met |
| 3.5.7 AI risk scoring and explained alerts | Risk alerts, award and certificate results | 2: award and contract scored by the AI service; alert (score 82) held the payment | Met |
| 3.5.8 Alert review and audit trail | Risk alerts, Procurement history | 4: decision signed on the ledger; disallowed decision refused; history complete from publication to payment and in time order | Met |
| 3.5.9 Public verification portal and open data | Public records (search, check a document, open data) | 5: public search finds tender, contract and payment; no personal data or bid contents; contract matches, altered certificate does not; OCDS release complete | Met |
| 3.5.10 Reporting and notifications | Reports; e-mail and SMS | 8: three reports as PDF and XLSX; bidder refused; e-mails sent for award and payment | Met |

## 3. Non-functional requirements

| NFR | Target | Measured | Status |
|---|---|---|---|
| NFR-01 Integrity | Every change to a recorded event or document detected | 5 of 5 tampering cases detected on the live system: altered tender document, swapped bid file, forged receipt time, altered certificate, altered public copy | Met |
| NFR-02 Confidentiality | No bid readable before opening | Bids sealed before closing; opening refused before the committee quorum and before closing; only ciphertext on IPFS | Met |
| NFR-03 Privacy | Ledger holds only hashes, IDs, amounts and statuses | Scan of 61 ledger records against 45 known personal values and patterns: nothing found. Signers appear as certificate fingerprints, bidders as `SUP-…` codes | Met |
| NFR-04 Determinism | Same result on every peer | No `time.Now()` in the chaincode (transaction timestamp only); every write endorsed identically by ZPPA and OAG under the majority policy | Met |
| NFR-05 Performance | Bid committed within 5 s (median) | About 2.05 s; the 2 s is the orderer's batch timeout. Under load 34–54 ms per write, 272–408 per second | Met |
| NFR-06 Performance | Score with explanation within 2 s | `/explain` median 210 ms, 95th percentile 235 ms | Met |
| NFR-07 Explainability | Top 3 factors in plain English | Top 3 SHAP factors of the supervised model in sentences, plus one line from the bidder-network or unusualness model when it contributes | Met |
| NFR-08 Model quality | ROC-AUC ≥ 0.80 on held-out data | 0.991 (see the synthetic-data caveat in section 5) | Met |
| NFR-09 Security | JWT on every non-public route; TLS between Fabric nodes | 13 refusals without a session or with the wrong role; Fabric network runs with TLS | Met |
| NFR-10 Usability | UK English; WCAG 2.1 AA contrast | 19 screens, 0 violations after three fixes | Met (SUS to follow) |
| NFR-11 Testability | Unit tests for every contract, route and AI endpoint | 323 automated tests across the four layers | Met |
| NFR-12 Scalability | Grow to 4 organisations | Not attempted (stretch goal) | Not done |
| NFR-13 Benchmarking | Hyperledger Caliper | Caliper 0.7.1: 21,000 transactions, 0 failed; about 440 writes per second at saturation (`caliper.md`) | Met (stretch) |

## 4. Defects found by testing, and fixed

| Found by | Defect | Fix |
|---|---|---|
| Live run after a restart | The IFMIS stand-in issued `IFMIS-2026-000001` a second time, because it kept its counter in memory | It now keeps its records in a file and continues numbering; test added. The repeated reference stays on the ledger, traceable to this stand-in fault |
| Browser accessibility check | Light grey text at 2.63:1 (audit log, dashboard) | Darker grey, 4.76:1 |
| Browser accessibility check | Grey text on the selected alert row at 4.32:1 | Darker grey on highlighted rows |
| Browser accessibility check | Wide tables could not be scrolled with the keyboard | Scroll area can take focus, with a focus ring |
| Front-end checks (Phase 5) | Recommended bid not preselected; recommendation form shown before opening; both "Risk alerts" and "Procurement history" highlighted | Fixed in the screens |
| Usability kit review | A task asked for who certified a milestone, which the history does not show | Task changed to something the history shows |

## 5. Limits of this evaluation

- **Synthetic data.** The AI was trained on public ZPPA OCDS data plus synthetic risky cases, so a ROC-AUC of 0.991
  partly reflects how distinct the synthetic cases are. A leakage check (`docs/phase4/model-evaluation.md`) found the
  synthetic data hard to tell from real (ROC-AUC 0.644), but real labelled fraud cases would be needed for a fair figure.
- **A likely false positive.** In the system test the AI scored a two-bidder award 82 and held its payment, largely because
  the demo has few suppliers and Alpha Computers had won most earlier awards. In a real market with many suppliers this
  factor would carry less weight. It shows why a regulator's decision, not the score alone, releases or stops payment.
- **One laptop.** All peers, the orderer and the services share one machine, so the performance figures show the
  design's behaviour (batching, read speed) rather than production capacity.
- **Stand-ins.** PACRA, ZRA, IFMIS and the SMS gateway are stand-ins with fictional records; the real services were not
  available to a student project.
- **Usability.** Not yet measured with participants; the kit is ready (`usability/`).

## 6. Stretch goals

| Goal | Status | Evidence |
|---|---|---|
| Caliper benchmark (NFR-13) | Done: 21,000 transactions, 0 failed, saturation about 440 writes per second | `caliper.md` |
| Shamir key splitting (FR-BID-07) | Done, behind a setting (off by default): a quorum of committee shares is needed to open bids; 16/16 live checks | `key-splitting.md`, `shamir-live.md` |
| Four organisations (NFR-12) | Not attempted, to keep the demonstration network stable | – |
| Graph neural network | Not attempted; the graph model uses Louvain communities instead | `docs/phase4/model-evaluation.md` |
