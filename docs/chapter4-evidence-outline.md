# Chapter 4 evidence outline

A map for writing Chapter 4 (implementation, testing and results). For each section: what to cover, as questions
to answer in your own words; the evidence to cite; the figures and tables to include; and the numbers to quote.
Every number below comes from a file in this repository, so you can check it and cite it. Adjust the section
numbers and order to ZCAS's template.

**Before you write:** run the usability sessions (section 4.7) and regenerate the screenshots
(`node backend/system-test/screenshots.mjs`) so the figures match the final system.

---

## 4.1 Introduction

Cover:
- What this chapter shows: that the prototype was built as designed in Chapter 3, and how well it meets the
  functional (3.5.1–3.5.10) and non-functional (NFR-01 to NFR-13) requirements.
- The order of what follows: environment, implementation by component, testing at each level, results, limits.

---

## 4.2 Development environment and tools

Cover:
- The hardware and why one laptop was enough for a prototype.
- Each tool, its version and why it was chosen (link back to the Chapter 3 design).
- That Fabric runs natively on Apple silicon (arm64 images).

Evidence: `CLAUDE.md` (stack), `docs/phase0/fabric-images.txt`, `docs/phase0/smoke-test.txt`, `docs/phase0/infra-health.txt`.

Table 4.1 · Development environment

| Item | Version / detail |
|---|---|
| Laptop | MacBook Pro, Apple M1 Pro, 16 GB RAM, macOS |
| Containers | Docker in Colima |
| Blockchain | Hyperledger Fabric 2.5.16 (arm64 images), 2 organisations (ZPPA, OAG), Raft orderer |
| Chaincode | Go 1.25, fabric-contract-api-go v2 |
| Back end | Node.js 20, Express, Prisma, PostgreSQL 16, IPFS (kubo) |
| AI | Python 3.11, scikit-learn, SHAP, networkx, FastAPI; trained in Google Colab |
| Front end | React 18, Vite 6, Tailwind CSS 4 |
| CI | GitHub Actions: four jobs (chaincode, back end, AI, front end) |

---

## 4.3 Implementation

### 4.3.1 Architecture as built

Cover:
- The components and how they talk: front end → API → Fabric gateway (both organisations endorse) / IPFS / PostgreSQL /
  AI service / stand-ins (PACRA, ZRA, IFMIS, SMS).
- What goes on the ledger and what stays off it (hashes, IDs, amounts, statuses on-chain; documents, names off-chain),
  and why (the ledger rule in Chapter 3; privacy).

Figure 4.1 · Architecture as built (redraw your Chapter 3 diagram with the actual components and ports).

### 4.3.2 Blockchain network and chaincode

Cover:
- The network: organisations ZPPAMSP and OAGMSP, channel `procurement`, majority endorsement policy, one identity per role
  with the role carried in the certificate.
- The five contracts and what each enforces (tender, bid, award, milestone, alert).
- Determinism (transaction timestamp, never `time.Now()`).
- Chaincode versions: 1.0 → 1.3 (sequence 4), upgraded without losing data.

Evidence: `chaincode/contracts/*.go`, `docs/phase2/role-certificates.txt`, `docs/phase2/deploy-procurement.log`,
`docs/phase3/upgrade-procurement-1.3.log`.

Table 4.2 · Rules the chaincode enforces (e.g. no bid after closing, no opening without the quorum, no payment before
certification or while flagged high risk, payments never above the contract value).

### 4.3.3 Back end

Cover:
- Sign-in with password and authenticator code (TOTP); roles; audit log.
- Sealed bids: AES-256-GCM per bid, ciphertext on IPFS, hash on the ledger, signed receipt.
- Integration with the stand-ins, and why stand-ins were used (real PACRA/ZRA/IFMIS not available to students).
- Reports (PDF, XLSX) and notifications (e-mail, SMS).

Evidence: `backend/src/`, `docs/phase3/requirements-traceability.md` (every clause mapped to code and tests).

### 4.3.4 AI risk scoring

Cover:
- Data: public ZPPA OCDS data plus synthetic risky cases, and why synthetic data was needed (no labelled fraud cases).
- Three models combined: supervised (gradient boosting), unsupervised (Isolation Forest) and graph-based
  (co-bidding network, Louvain communities); the combined score and the alert threshold of 70.
- Explanations: SHAP, top three factors in plain English; the explanation's hash on the ledger.
- How a high score holds payment until a regulator decides.

Evidence: `docs/phase1/data-profile.md`, `docs/phase1/data-and-labelling.md`, `docs/phase4/model-evaluation.md`,
`ai/notebooks/risk_models_colab.ipynb`.

Numbers: 178,732 ZPPA contracting processes; co-bidding network of 23,928 bidders, 60,534 linked pairs, 417 groups.

### 4.3.5 Front end

Cover:
- Screens for each role; each role sees only its own functions.
- Design choices (navy and slate, Fira Sans/Fira Code, borders not shadows) and why: an institutional tool, not a
  marketing site; colour carries meaning only.
- Accessibility built in (WCAG 2.1 AA), phone layout.

Evidence: `frontend/DESIGN.md`, `docs/phase5/step*.md`, `docs/phase5/screenshots/README.md`.

Figures (from `docs/phase5/screenshots/`; pick 8–12, the rest can go in an appendix):

| Figure | File | Caption |
|---|---|---|
| 4.2 | `01-sign-in.png` | Sign-in with a second factor |
| 4.3 | `12-officer-publish-tender.png` | Publishing a tender |
| 4.4 | `13-tender-record.png` | Tender record: ledger fields, sealed bids and version history |
| 4.5 | `21-bidder-bids.png` | Bidder's view of open tenders and submitted bids |
| 4.6 | `15-evaluation.png` | Evaluation: approvals on the ledger, integrity check, 70/30 ranking |
| 4.7 | `17-contract.png` | Contract with payment schedule, certificates and IFMIS payments |
| 4.8 | `51-risk-alerts.png` | Risk alert with its plain-English reasons and the decision form |
| 4.9 | `52-procurement-history.png` | Procurement history read from the ledger |
| 4.10 | `03-public-search.png` | Public portal search |
| 4.11 | `04-public-verify.png` | Checking a document against the ledger |
| 4.12 | `70-phone-public.png` | Public portal on a phone |

---

## 4.4 Testing strategy

Cover:
- The levels and why each is needed: unit (each contract, route, model), integration (API with a real database),
  system (the whole running stack), non-functional (performance, security, privacy, accessibility), usability.
- Automation: tests run on every push in GitHub Actions.

Table 4.3 · Testing at each level (copy from `docs/phase6/evaluation-summary.md`, section 1).

| Level | Tests | Result | Coverage |
|---|---|---|---|
| Chaincode unit tests (Go) | 47 | all pass | 76.2% of statements |
| Back-end unit and integration tests (Jest) | 175 | all pass | 88.4% statements, 75.1% branches |
| AI tests (pytest) | 25 | all pass | 92% |
| Front-end tests (Vitest), including accessibility | 59 | all pass | 87.7% statements |
| System test on the live network | 77 checks | 77 pass | – |

Evidence: `docs/phase6/*-tests.txt`. Explain why `GetTenderHistory` shows 0% in the unit tests (the test mock has no
history database; the live system test covers it).

---

## 4.5 Results against the functional requirements

Cover, for each of 3.5.1–3.5.10: what was built, how it was tested, and the result. Use one row per requirement in a
table and discuss the interesting ones in the text.

Evidence: `docs/phase6/system-test-results.md` (77 checks with times), `docs/phase3/requirements-traceability.md`,
`docs/phase3/live-3.5.*-run.txt`, `docs/phase2/e2e-results.md` (30/30 at chaincode level).

Table 4.4 · Functional requirements: copy section 2 of `docs/phase6/evaluation-summary.md`.

Checks per requirement in the system test: 3.5.1: 16 · 3.5.2: 4 · 3.5.3: 5 · 3.5.4: 8 · 3.5.5: 15 · 3.5.6: 10 · 3.5.7: 2 ·
3.5.8: 4 · 3.5.9: 5 · 3.5.10: 8 (total 77, all passed).

Points worth discussing:
- Refusals are as important as successes: the ledger refused a late bid, an approval before closing, opening without the
  quorum, a second bid from one company, a double payment.
- The swapped bid file was detected at opening and not opened (tamper test).
- A high AI score held a payment until the regulator's decision, then the payment went through.

---

## 4.6 Results against the non-functional requirements

Table 4.5 · Non-functional requirements: copy section 3 of `docs/phase6/evaluation-summary.md`.

| NFR | Number to quote | Evidence |
|---|---|---|
| NFR-01 Integrity | 5 of 5 tampering cases detected | `system-test-results.md` |
| NFR-02 Confidentiality | bids sealed until closing and quorum | `system-test-results.md` |
| NFR-03 Privacy | 61 ledger records scanned, 0 personal values found | `privacy-scan.md` |
| NFR-04 Determinism | every write endorsed identically by both organisations | `system-test-results.md`, chaincode |
| NFR-05 Bid commit ≤ 5 s | about 2.05 s median (the orderer's 2 s batch timeout) | `performance.md`, `system-test-results.md` |
| NFR-06 Score ≤ 2 s | `/explain` median 210 ms, p95 235 ms | `performance.md` |
| NFR-07 Explainability | top 3 SHAP factors in sentences | `ai/risk/model.py`, `51-risk-alerts.png` |
| NFR-08 ROC-AUC ≥ 0.80 | 0.991 tenders; 1.000 contracts | `model-evaluation.md` |
| NFR-09 Security | 13 refusals without a session or with the wrong role; Fabric TLS | `system-test-results.md` |
| NFR-10 Usability, WCAG AA | 19 screens, 0 violations after 3 fixes | `accessibility.md` |
| NFR-11 Testability | 306 automated tests | test outputs |
| NFR-12, NFR-13 (stretch) | not done / own load test instead of Caliper | `performance.md` |

### Performance (subsection)

Figure 4.13 · Bar chart of median latency per operation (from `docs/phase6/performance.md`).
Table 4.6 · Performance results (copy the table).

Numbers: ledger read 3 ms (one at a time), 11 ms with 20 at once; a lone write about 2,035 ms; concurrent writes
34–54 ms each, 272–408 per second; API screens 18–31 ms median; AI `/score` 172 ms, `/explain` 210 ms.

Explain: the 2 s single write is the orderer waiting to fill a block (`BatchTimeout: 2s`, `MaxMessageCount: 10`), not
slowness; all 160 test writes were checked on the ledger afterwards.

---

## 4.7 Usability evaluation  *(to complete after the sessions)*

Cover:
- Participants (number, background), method (think-aloud, 8 tasks, SUS), ethics/consent.
- Mean SUS with SD and adjective rating (68 is average); task success rates and median times; what caused the failures;
  representative quotes.
- What you would change as a result.

Evidence: `docs/phase6/usability/` (session pack, `results.csv`, `results.md` from `score.py`).

Table 4.7 · SUS per participant. Table 4.8 · Task success.

---

## 4.8 AI model evaluation

Cover:
- How the models were evaluated (held-out synthetic tenders with known patterns; comparison with the Phase 1 rules).
- Results per pattern; what the graph model detects (an injected cartel) and what the control shows.
- The leakage check and the two data problems it found and fixed (a good example of SHAP being useful in practice).
- Honest limits (synthetic labels, easier than real life).

Evidence: `docs/phase4/model-evaluation.md`, `docs/phase4/train-output.txt`, `docs/phase4/live-3.5.7-run.txt`.

Table 4.9 · Model results

| Measure | Combined model | Rules only |
|---|---|---|
| ROC-AUC (tenders) | 0.991 | – |
| Recall | 90.6% | 43.7% |
| False positives | 2.2% | 0.0% |

Numbers: per pattern recall (favoured supplier 99.3%, rushed tender 99.7%, split purchase 92.0%, single bidder 90.3%,
inflated award 71.7%); contracts ROC-AUC 1.000, recall 100%, false positives 0.3%; injected cartel in the top 5% of
graph risk in 100% of cases versus 0% for the control; leakage check ROC-AUC 0.644; on real ZPPA data the model would
flag 4.4% of tenders (7,909) for review.

---

## 4.9 Defects found and fixed

Table 4.10 · copy section 4 of `docs/phase6/evaluation-summary.md` (IFMIS stand-in repeating references after a
restart; three accessibility issues; front-end issues found while testing). Testing finding real defects is evidence
that it was worth doing; say how each was fixed and re-tested.

---

## 4.10 Discussion and limitations

Cover (see section 5 of `docs/phase6/evaluation-summary.md`):
- Synthetic labels inflate the AI's measured accuracy; real labelled cases would be needed.
- The likely false positive in the system test (a two-bidder award scored 82 because one supplier had won most demo
  awards), and why a regulator, not the score, decides.
- One laptop: the performance figures show the design's behaviour, not production capacity.
- Stand-ins for PACRA, ZRA, IFMIS and SMS.
- Stretch goals not done (4 organisations, Caliper, Shamir key splitting, GNN) and what they would add.

---

## 4.11 Summary

Cover: all ten functional requirements met and demonstrated live; eleven of thirteen non-functional requirements met
(two stretch goals); key numbers (77/77, 5/5 tampering, 0 personal data, 2 s commit, 0.991 AUC, SUS once measured).

---

## Careful with these claims

| Avoid saying | Say instead |
|---|---|
| "The AI detects corruption with 99% accuracy" | It detects the injected synthetic patterns with ROC-AUC 0.991; real performance is unknown without labelled cases |
| "The system is tamper-proof" | Changes are detected (tamper-evident): 5 of 5 tampering cases detected |
| "It handles 400 transactions per second" | On one laptop, with 25 writes in flight, it committed about 408 per second |
| "The system integrates with PACRA, ZRA and IFMIS" | It integrates with stand-ins built to their interfaces; the real services can replace them by URL |
| "Users found it easy to use" | Only after the sessions, and quoting the SUS score and task success rates |
