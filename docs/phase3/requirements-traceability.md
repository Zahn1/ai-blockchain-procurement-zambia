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

## Summary of all functional requirements

| Requirement | Status | Where |
|---|---|---|
| 3.5.1 User Authentication and Role Management | ✅ | Phase 3, step 1 |
| 3.5.2 Supplier Registration and Verification | ⬜ | Phase 3, step 2 |
| 3.5.3 Tender Publication | ✅ | Prototype; ledger in Phase 2 |
| 3.5.4 Encrypted Bid Submission | ✅ | Prototype; ledger in Phase 2 |
| 3.5.5 Bid Opening and Evaluation | 🟡 | Ledger rules done (Phase 2); screens in Phase 3, step 3 |
| 3.5.6 Smart Contract Award and Milestone Payment | 🟡 | Ledger rules done; inspector, IFMIS and risk check in Phase 3, step 4 |
| 3.5.7 AI Risk Scoring and Explained Alerts | 🟡 | Data ready (Phase 1); models in Phase 4 |
| 3.5.8 Alert Review and Audit Trail | 🟡 | Ledger alerts done; decision names to align to *cleared / monitor / refer*; Phase 3, step 5 |
| 3.5.9 Public Verification Portal and Open Data | 🟡 | Public document and receipt checks work without signing in; search and OCDS download in Phase 3, step 5 |
| 3.5.10 Reporting and Notifications | ⬜ | Phase 3, step 5 |
