# Requirements traceability: Chapter 3 to the prototype

Each requirement from Chapter 3 is split into its clauses. Every clause points to the code that implements it and the tests that prove it. Status: ✅ done · 🟡 partly · ⬜ not started.

## 3.5.1 User Authentication and Role Management

> *"The system must authenticate every user with a password and a one-time code, and give each user access only to the functions of their role: system administrator, procurement officer, bidder or regulator. The administrator must be able to create, suspend and assign roles to users and procuring entities."*

| Clause | Status | How it is met | Code | Tests |
|---|---|---|---|---|
| Authenticate every user with a **password** | ✅ | Password checked against a bcrypt hash (cost 12); 5 wrong attempts lock the account for 15 minutes | `backend/src/auth.js` `login()` | `auth.test.js`: *Wrong passwords and lockout* (3 tests) |
| … **and a one-time code** | ✅ | 6-digit TOTP code (RFC 6238, works with Google and Microsoft Authenticator). Required at every sign-in; set up with a QR code at the first. A code cannot be reused. Secret stored encrypted (AES-256-GCM) | `auth.js` `confirmSetup()`, `verifyCode()` | *Password and one-time code* (7 tests) |
| Every user | ✅ | No route that changes data works without a full sign-in (password **and** code); the password step alone gives no access | `auth.js` `requireAuth` | *the password step alone never gives access*; *3.5.1 Roles on tenders and bids* |
| Access **only to the functions of their role** | ✅ | Every protected route names its roles; the page shows only that role's tabs | `auth.js` `requireRole`; `app.js`; `public/index.html` `enter()` | *publishing needs a signed-in officer*; *bidding needs a signed-in bidder*; *a … cannot use the admin screens* (5 roles) |
| Roles: **system administrator, procurement officer, bidder, regulator** | ✅ | Roles `ADMIN`, `OFFICER`, `SUPPLIER` (shown as *Bidder*), `REGULATOR`. Two more come from later requirements: `COMMITTEE` (3.5.5 *evaluation committee members*) and `INSPECTOR` (3.5.6 *authorised inspector*). No other roles | `prisma/schema.prisma` `enum Role` | — |
| Administrator can **create** users | ✅ | Add a user with name, email, role, procuring entity and starting password; bidders get a random ledger code name | `auth-routes.js` `POST /admin/users` | *creates a procuring entity and an officer in it*; *a new bidder gets a random ledger pseudonym*; *rejects invalid user* (4) |
| … **suspend** users | ✅ | Suspend and reactivate; a suspension ends an existing session at once | `PATCH /admin/users/:id`; `requireAuth` | *changes a role and suspends and reactivates a user*; *suspension ends an existing session at once*; *a suspended user cannot sign in* |
| … **assign roles** | ✅ | Change a user's role from the user list; an administrator cannot remove their own role or suspend themselves | `PATCH /admin/users/:id` | *changes a role …*; *cannot suspend themselves …* |
| … create, suspend and assign users to **procuring entities** | ✅ | Add procuring entities (e.g. MOH), suspend them, and assign officers to them | `POST/PATCH /admin/entities` | *creates a procuring entity …*; *suspends a procuring entity* |

Supporting non-functional requirements met here: **3.6.3 Security** (least privilege, multi-factor authentication for all internal users, encrypted secrets) and the audit trail used in **3.5.8** (every sign-in, failure and administrative change is logged and shown to the administrator).

## 3.5.2 Supplier Registration and Verification

> *"The system must allow suppliers to register and must verify their company registration and tax compliance against the Patents and Companies Registration Agency (PACRA) and the Zambia Revenue Authority (ZRA), using the integrations ZPPA has already built for the e-GP system. Every supplier record must be keyed to its PACRA registration number."*

| Clause | Status | How it is met | Code | Tests |
|---|---|---|---|---|
| Allow suppliers to **register** | ✅ | Public *Register as a bidder* form: PACRA number, TPIN, name, email, password. Bidders cannot be created by the administrator | `supplier-routes.js` `POST /register/supplier`; `index.html` | *a company that PACRA and ZRA both confirm is registered …*; *cannot create bidders …* |
| Verify **company registration** against **PACRA** | ✅ | The company must exist at PACRA and be ACTIVE. The company name is taken from PACRA, not typed | `registries.js` `verifySupplier()` | *refused: unknown company*; *refused: company deregistered at PACRA* |
| Verify **tax compliance** against **ZRA** | ✅ | The TPIN must exist, belong to the same PACRA number, and have a valid tax clearance in date (end of day, Zambian time) | `verifySupplier()` | *refused: tax clearance expired*; *no tax clearance*; *unknown TPIN*; *TPIN of another company*; *Dates follow Zambian time* |
| Using the **integrations ZPPA has already built** | ✅ (stand-in) | PACRA and ZRA are separate HTTP services reached only through `PACRA_API_URL` and `ZRA_API_URL`. The prototype runs fictional stand-ins; setting those URLs to ZPPA's real integrations replaces them with no code change. If a registry cannot be reached, nothing is created | `standins/services.js`; `registries.js` `registryClients()`; `config.js` | Registration tests call the stand-ins over HTTP; *if PACRA or ZRA cannot be reached …* |
| Every supplier record **keyed to its PACRA registration number** | ✅ | `Supplier` table's primary key is `pacraNumber`; each bidder account links to it; one registration per company. The ledger code name belongs to the company, so its staff cannot bid twice on one tender | `schema.prisma` `model Supplier`; migration `…_suppliers` | *the supplier record is keyed to its PACRA registration number*; *a company can register only once* |

Beyond the wording, following from it: a bidder's company is checked again **when they bid** (still verified, tax clearance still in date), and the administrator can **re-verify** a company, which suspends it if PACRA or ZRA no longer confirm it (*Staying verified*, 5 tests; *a bidder whose company tax clearance has expired cannot bid*).

## 3.5.5 Bid Opening and Evaluation

> *"The system must open bids only after the closing time and only with the digital signatures of the required evaluation committee members. On opening, each bid must be checked against its recorded hash. The system must record technical and financial scores, and must require a written justification whenever the committee departs from the recommended award."*

| Clause | Status | How it is met | Code | Tests and evidence |
|---|---|---|---|---|
| Open bids **only after the closing time** | ✅ | The chaincode refuses opening approvals before the closing time, using the transaction timestamp | `chaincode/contracts/bid.go` `ApproveOpening`; `evaluation-routes.js` `/evaluation/approve` | Go: *TestApproveOpening_BeforeClosingRejected*; Jest: *approval before the closing time is refused by the ledger*; live run: refused before closing |
| … **only with the digital signatures of the required evaluation committee members** | ✅ | The officer appoints the committee for each tender (at least the quorum, 2). Each member has their own enrolled ledger identity, so each approval is a transaction signed with that member's own key. The chaincode counts each signer once and refuses to open until the quorum has signed | `auth-routes.js` (one ledger identity per committee user); `evaluation-routes.js` `/evaluation/committee`, `/evaluation/approve`, `/evaluation/open`; `bid.go` `OpenBid` | *each member signs the approval with their own ledger identity*; *bids cannot be opened until the quorum has signed*; *only appointed members can see or act*; *each committee user gets their own ledger identity*; live ledger shows two distinct approver hashes |
| **On opening, each bid checked against its recorded hash** | ✅ | Each encrypted bid is fetched from IPFS and its SHA-256 compared with the hash on the ledger; AES-GCM decryption also detects tampering. A bid that fails is not opened and is flagged in the audit log. For each bid that passes, the hash of the opened file is recorded on the ledger | `evaluation-routes.js` `/evaluation/open`, `/evaluation/bid-file` | *on opening, each bid is checked against its ledger hash …*; *a bid whose stored file was altered is not opened and is flagged*; live run: both bids *MATCH*, opened-file hashes on the ledger |
| **Record technical and financial scores** | ✅ | Each member records a technical score (0–100) and comment per bid. The bid price is recorded from the opened document; the financial score = lowest eligible price ÷ price × 100. Combined = 70% technical + 30% financial; technical pass mark 60 | `evaluation.js` `rankBids()`; `/evaluation/score`, `/evaluation/price` | *Scoring method* (5 tests); *records each member's technical score and the bid price …*; *rejects an invalid score* (3) |
| **Written justification whenever the committee departs from the recommended award** | ✅ | The ranking gives the recommended award. Choosing any other eligible bid is refused unless a written justification (at least 50 characters) is given. The full evaluation, with the justification, is stored and its SHA-256 hash recorded for the award transaction (3.5.6) | `/evaluation/recommend`; `evaluation.js` `reportHash()` | *departing from the recommended award requires a written justification*; *recommending the top-ranked bid needs no justification*; live run: refused without, accepted with |

Related rules: a recommendation waits until every member has scored every opened bid; a bid below the pass mark cannot be recommended; after the recommendation, scores and prices are locked.

Live evidence on the network: `docs/phase3/live-3.5.5-run.txt` (the run) and `docs/phase3/live-3.5.5-ledger.json` (the ledger read back).

## 3.5.6 Smart Contract Award and Milestone Payment

> *"On award, the system must create a smart contract that encodes the contract milestones, amounts and payment schedule. When an authorised inspector uploads a signed completion certificate, the smart contract must check it against the milestone terms and, if valid and not flagged as high risk, send a payment instruction to IFMIS. The payment reference must be recorded on the ledger."*

| Clause | Status | How it is met | Code | Tests and evidence |
|---|---|---|---|---|
| **On award, create a smart contract** | ✅ | The officer awards the committee's recommended bid; the award transaction carries the evaluation report hash (3.5.5). Signing records the signed contract's hash | `contract-routes.js` `/contracts/award`, `/contracts/sign`; `award.go` `MakeAward`, `SignContract` | *awards the recommended bid, with the evaluation report hash on the ledger*; live run |
| … that **encodes the contract milestones, amounts and payment schedule** | ✅ | Each milestone is a ledger record with its amount and due date. The milestones must add up to the contract value; the ledger also refuses milestones above it | `/contracts/sign`; `milestone.go` `AddMilestone` | *signing records the contract hash and each milestone with its amount and due date*; *rejects an invalid schedule* (4) |
| An **authorised inspector** uploads a **signed completion certificate** | ✅ | The officer assigns an inspector to each contract. Only that inspector can certify; the certificate is stored on IPFS and its hash recorded in a ledger transaction signed with the inspector's own key. The chaincode accepts only the inspector role | `/contracts/certify`; `milestone.go` `CompleteMilestone` (role `inspector`) | Jest: *the certificate is signed with the inspector's own ledger identity …*; *only the inspector assigned …*; Go: *TestCompleteMilestone_OnlyAnInspector*; live: officer refused |
| The smart contract **checks it against the milestone terms** | ✅ | The certificate states the amount certified and the completion date. The chaincode refuses a certificate whose amount differs from the milestone's, or whose date is before the contract signature or in the future | `CompleteMilestone` | Go: *TestCompleteMilestone_CertificateCheckedAgainstTerms*; live: wrong amount refused |
| **If valid and not flagged as high risk** | ✅ | Before any instruction, the back end asks the ledger (`CheckPayable`). The chaincode holds payment while the contract or its tender has an alert scoring 70 or more that is unreviewed or referred; a regulator's decision to clear or monitor releases it. The same rule is applied again when the payment is recorded | `milestone.go` `CheckPayable`, `payBlocker`, `RecordPayment`; `alert.go` `highRiskFlag` | Go: *…BlockedWhileFlaggedHighRisk*, *…TenderAlertAlsoBlocks*, *…MonitoredOrLowScoreDoesNotBlock*; Jest: *a contract flagged as high risk is not paid: no instruction goes to IFMIS*; live: payment held, then paid after *monitor* |
| **Send a payment instruction to IFMIS** | ✅ (stand-in) | IFMIS is a separate HTTP service reached through `IFMIS_API_URL`; the prototype runs a stand-in. A payment ID gets the same reference if the instruction is resent, so a retry is never paid twice | `ifmis.js`; `standins/services.js` `ifmisStandIn` | *a valid certificate … is paid*; *IFMIS gives the same reference if an instruction is sent twice* |
| **The payment reference must be recorded on the ledger** | ✅ | The IFMIS reference is recorded with the payment in `RecordPayment` | `RecordPayment` | Jest: *… the IFMIS reference goes on the ledger*; live: `IFMIS-2026-000001` and `…000002` on the ledger |

Live evidence on the network: `docs/phase3/live-3.5.6-run.txt`; chaincode 1.2 upgrade log; end-to-end scenario (30 of 30 steps) in `docs/phase3/e2e-console-chaincode-1.2.txt`.

## 3.5.8 Alert Review and Audit Trail

> *"The system must allow regulators to review each alert and record a decision (cleared, monitor or refer) together with the reason, and must record the hash of that decision on the ledger. Authorised regulators must be able to view the complete history of any procurement, from tender publication to final payment."*

| Clause | Status | How it is met | Code | Tests and evidence |
|---|---|---|---|---|
| Regulators **review each alert** | ✅ | The Oversight tab lists every alert on the ledger (new chaincode function `GetAllAlerts`, version 1.3), unreviewed first, with earlier decisions and reasons. Only regulators can see it | `oversight-routes.js` `/oversight/alerts`; `alert.go` `GetAllAlerts` | *lists every alert on the ledger, unreviewed first*; *only regulators can see or decide alerts*; Go: *TestGetAllAlerts* |
| Record a **decision (cleared, monitor or refer)** | ✅ | The ledger's alert statuses are exactly OPEN, CLEARED, MONITOR and REFERRED. The chaincode controls which decision may follow which; cleared is final | `alert.go` `ReviewAlert`; `/oversight/alerts/decide` | Go: *TestReviewAlert_DecisionsAndFinality*; Jest: *the ledger decides which decisions may follow: cleared is final*; live: refused to change a cleared alert |
| … **together with the reason** | ✅ | A reason of at least 20 characters is required and stored with the decision | `/oversight/alerts/decide` | *rejects {"reason":"Fine."}* |
| **Record the hash of that decision on the ledger** | ✅ | The decision record (alert, subject, score, previous status, decision, reason, regulator, time) is hashed with SHA-256; the hash goes on the ledger with the decision, signed with the regulator's own enrolled identity | `/oversight/alerts/decide`; `evaluation.js` `reportHash()` | *… puts the decision record's hash on the ledger, signed by the regulator*; *a changed reason would no longer match the hash on the ledger*; live: hash `d6c96d9b…` on the ledger |
| Authorised regulators view the **complete history of any procurement, from tender publication to final payment** | ✅ | A timeline built from the ledger: every tender version, bids, committee approvals, openings, award, contract signature, milestone certificates, payments with IFMIS references, alerts and decisions, each with its transaction ID. The committee recommendation, which is off-chain, is labelled as such | `/oversight/history` | *runs from tender publication to final payment, in time order, with ledger transactions*; live: 17 events for `ZPPA/MOH/2026/E3932` |

Notes: alerts raised before the decision names were aligned keep their old status on the ledger (for example ESCALATED), because ledger records cannot be changed. Decisions made directly on the ledger rather than through the Oversight tab appear in the ledger but without a stored reason.

Live evidence: `docs/phase3/live-3.5.8-run.txt`; chaincode 1.3 upgrade log.

## Summary of all functional requirements

| Requirement | Status | Where |
|---|---|---|
| 3.5.1 User Authentication and Role Management | ✅ | Phase 3, step 1 |
| 3.5.2 Supplier Registration and Verification | ✅ | Phase 3, step 2 (PACRA and ZRA stand-ins) |
| 3.5.3 Tender Publication | ✅ | Prototype; ledger in Phase 2 |
| 3.5.4 Encrypted Bid Submission | ✅ | Prototype; ledger in Phase 2 |
| 3.5.5 Bid Opening and Evaluation | ✅ | Phase 3, step 3 (ledger rules from Phase 2) |
| 3.5.6 Smart Contract Award and Milestone Payment | ✅ | Phase 3, step 4 (IFMIS stand-in) |
| 3.5.7 AI Risk Scoring and Explained Alerts | 🟡 | Data ready (Phase 1); models in Phase 4 |
| 3.5.8 Alert Review and Audit Trail | ✅ | Phase 3, step 5a (chaincode 1.3) |
| 3.5.9 Public Verification Portal and Open Data | 🟡 | Public document and receipt checks work without signing in; search and OCDS download in Phase 3, step 5 |
| 3.5.10 Reporting and Notifications | ⬜ | Phase 3, step 5 |
