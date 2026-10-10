# Requirements specification

**Project:** AI and Blockchain-Based Transparent Government Procurement System for Zambia
**Author:** Zhaninge Chipeta (202204924), ZCAS University · **Status:** Draft v0.1, Phase 1

Priorities use MoSCoW: **M** must have, **S** should have, **C** could have, **W** won't have in this prototype. Every requirement has an ID so that Phase 6 test cases can trace back to it.

## 1. Scope

The system runs alongside ZPPA's e-GP system; it does not replace it. It adds three things e-GP lacks:

1. A tamper-evident record of each procurement event on a permissioned blockchain.
2. Sealed bids that cannot be opened before the closing time and a committee approval.
3. An explainable AI risk score for each tender and contract.

Out of scope: live integration with e-GP, IFMIS, PACRA or ZRA (the prototype uses stand-in versions), real payments, and production deployment.

## 2. Stakeholders and actors

| Actor | Organisation | Main needs |
|---|---|---|
| Procurement officer | Procuring entity (on ZPPA node) | Publish tenders, manage evaluation, record awards and milestones |
| Evaluation committee member | Procuring entity | Approve bid opening, score bids |
| Supplier | Private company | Submit sealed bids, track status, see award outcome |
| Regulator | ZPPA | Monitor compliance, review risk alerts |
| Auditor | Office of the Auditor General (OAG) | Verify history, investigate flagged contracts |
| Public / civil society | Anyone | Browse tenders and awards, verify a document against the ledger |
| System administrator | ZPPA | Manage users, keys and network nodes |

## 3. Functional requirements

### 3.1 Identity and access (AUTH)

| ID | Requirement | Priority |
|---|---|---|
| FR-AUTH-01 | Users sign in with email and password; passwords are stored with a slow hash (bcrypt/argon2). | M |
| FR-AUTH-02 | Officers, committee members, regulators and auditors must also use a TOTP second factor. | M |
| FR-AUTH-03 | Access is role-based (officer, committee, supplier, regulator, auditor, admin); the public portal needs no login. | M |
| FR-AUTH-04 | Each organisation's ledger identity is issued by its own Fabric CA. | M |
| FR-AUTH-05 | Supplier registration is checked against the PACRA stand-in (company number) and the ZRA stand-in (TPIN, tax clearance). | S |

### 3.2 Tenders (TND)

| ID | Requirement | Priority |
|---|---|---|
| FR-TND-01 | An officer can create a tender with reference, title, category, method, estimated value, closing time and documents. | M |
| FR-TND-02 | Publishing a tender writes a `TenderPublished` event to the ledger with the tender ID, document hashes, estimated value and closing time. | M |
| FR-TND-03 | Tender documents are stored off-chain (IPFS); the ledger stores their SHA-256 hashes. | M |
| FR-TND-04 | Amendments (addenda) are recorded as new events; the original version stays visible. | M |
| FR-TND-05 | A tender can be cancelled with a recorded reason. | S |

### 3.3 Sealed bids (BID)

| ID | Requirement | Priority |
|---|---|---|
| FR-BID-01 | A supplier submits a bid before the closing time; later submissions are rejected by the chaincode using the transaction timestamp. | M |
| FR-BID-02 | The bid file is encrypted with AES-256-GCM before it leaves the back end; the ciphertext goes to IPFS. | M |
| FR-BID-03 | The ledger records only the bid ID, tender ID, a supplier pseudonym, the ciphertext hash and the submission time. | M |
| FR-BID-04 | The supplier receives a receipt (transaction ID and hash) that proves the bid was submitted on time. | M |
| FR-BID-05 | Bids can be opened only after the closing time **and** a recorded committee approval; the chaincode enforces both. | M |
| FR-BID-06 | Opening a bid writes a `BidOpened` event; any party can check the decrypted file against the stored hash. | M |
| FR-BID-07 | The bid decryption key is split among committee members (Shamir's secret sharing). | C (stretch) |

### 3.4 Evaluation and award (AWD)

| ID | Requirement | Priority |
|---|---|---|
| FR-AWD-01 | Committee members record evaluation scores; the summary hash goes on the ledger. | M |
| FR-AWD-02 | An officer records the award (supplier, amount); this writes an `AwardMade` event. | M |
| FR-AWD-03 | A standstill period follows each award, during which bidders may lodge a challenge. | S |
| FR-AWD-04 | The contract is signed and its hash recorded (`ContractSigned`). | M |

### 3.5 Contract implementation (MIL)

| ID | Requirement | Priority |
|---|---|---|
| FR-MIL-01 | An officer defines contract milestones with amounts and due dates. | M |
| FR-MIL-02 | Completion of a milestone is recorded with evidence hashes (`MilestoneCompleted`). | M |
| FR-MIL-03 | Payment against a milestone is recorded after a check with the IFMIS stand-in (`PaymentRecorded`). | M |
| FR-MIL-04 | The chaincode rejects a payment that would push total payments above the contract value without a recorded variation. | M |

### 3.6 AI risk scoring (AI)

| ID | Requirement | Priority |
|---|---|---|
| FR-AI-01 | Each tender and contract receives a risk score from 0 to 100 from a supervised model combined with an Isolation Forest. | M |
| FR-AI-02 | Each score comes with a plain-English explanation of its top contributing factors (SHAP). | M |
| FR-AI-03 | Scores above a set threshold raise an alert; the alert's hash and score are written to the ledger (`AlertRaised`). | M |
| FR-AI-04 | Regulators and auditors can mark an alert as reviewed, dismissed or escalated, with a reason. | M |
| FR-AI-05 | The model is trained only on public ZPPA OCDS data and synthetic data. | M |
| FR-AI-06 | Supplier-network analysis with a graph neural network (GNN). | C (stretch) |

### 3.7 Portals and transparency (PUB)

| ID | Requirement | Priority |
|---|---|---|
| FR-PUB-01 | The public portal lists tenders, awards and contracts with their status and ledger transaction IDs. | M |
| FR-PUB-02 | Anyone can upload a document and check whether its hash matches the ledger. | M |
| FR-PUB-03 | Regulator and auditor portals show the full event history of a procurement as a timeline. | M |
| FR-PUB-04 | The regulator portal shows a risk dashboard: alerts by entity, category and month. | S |
| FR-PUB-05 | Data can be exported in OCDS format. | C |

### 3.8 Audit (AUD)

| ID | Requirement | Priority |
|---|---|---|
| FR-AUD-01 | Any change to off-chain data that has an on-chain hash is detected when the two are compared. | M |
| FR-AUD-02 | Back-end administrative actions are logged with the user, time and action. | M |

## 4. Non-functional requirements

| ID | Category | Requirement (measurable target) | Priority |
|---|---|---|---|
| NFR-01 | Integrity | Changing any recorded event or document is detected in 100% of tampering test cases. | M |
| NFR-02 | Confidentiality | No bid content can be read before opening; tested by attempting early decryption. | M |
| NFR-03 | Privacy | The ledger holds only hashes, IDs, amounts and statuses, with no personal data; checked by scanning the ledger. | M |
| NFR-04 | Determinism | All chaincode endorses identically on every peer (no `time.Now()`; map keys sorted). | M |
| NFR-05 | Performance | A bid submission is committed within 5 s on the prototype network (median, 2 orgs). | S |
| NFR-06 | Performance | A risk score with its explanation returns within 2 s. | S |
| NFR-07 | Explainability | Each alert lists its top 3 factors in plain English. | M |
| NFR-08 | Model quality | The supervised model reaches ROC-AUC ≥ 0.80 on held-out data. | S |
| NFR-09 | Security | All API routes need a valid JWT except public ones; TLS is used between all Fabric nodes. | M |
| NFR-10 | Usability | UI text is in UK English and pages meet WCAG 2.1 AA colour contrast. | S |
| NFR-11 | Testability | Unit tests exist for every contract, API route and AI endpoint. | M |
| NFR-12 | Scalability | The network can grow to 4 organisations (adding MoFNP and ACC). | C (stretch) |
| NFR-13 | Benchmarking | Throughput and latency are measured with Hyperledger Caliper. | C (stretch) |

## 5. Ledger event model

Each event is written by one contract. Fields are limited to hashes, IDs, amounts, statuses and timestamps, in line with NFR-03.

| Event | Contract | Main fields |
|---|---|---|
| TenderPublished / TenderAmended / TenderCancelled | TenderContract | tenderId, docHashes[], estValue, closingTime, status |
| BidSubmitted | BidContract | bidId, tenderId, supplierRef (pseudonym), cipherHash, txTime |
| OpeningApproved / BidOpened | BidContract | tenderId, approverRefs[], bidId, plainHash |
| AwardMade / ContractSigned | AwardContract | awardId, tenderId, supplierRef, amount, contractHash |
| MilestoneCompleted / PaymentRecorded | MilestoneContract | contractId, milestoneId, amount, evidenceHash, ifmisRef |
| AlertRaised / AlertReviewed | AlertContract | alertId, subjectId, score, modelVersion, explanationHash, status |

## 6. Assumptions and constraints

- The prototype runs on a single MacBook (M1 Pro, 16 GB) with 2 organisations (ZPPA and OAG).
- The ZPPA OCDS data has no implementation (milestone or payment) records, so contract-stage risk features use synthetic data.
- IFMIS, PACRA and ZRA are simulated by stand-in services with realistic responses.
- The end-to-end demo must work by 22 November 2026.
