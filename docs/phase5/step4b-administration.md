# Phase 5, step 4b: administration screens

Date: 24 October 2026.

## Screens

| Screen | Path | Requirement |
|---|---|---|
| Users: search and filter by role; add staff (officer needs a procuring entity; committee, inspector and regulator users get their own ledger identity); change role; suspend or reactivate; reset a lost authenticator | `/admin/users` | 3.5.1 |
| Bidders and entities: registered companies with PACRA number, TPIN, ledger code and tax clearance (expired ones in red); check again with PACRA and ZRA; add, suspend or reactivate procuring entities | `/admin/bidders` | 3.5.1, 3.5.2 |
| Audit log: latest 100 actions, searchable, with a "failures only" filter | `/admin/audit` | 3.5.1, 3.5.8 |

Bidders cannot be created or have their role changed here: they register themselves so their company can be verified (3.5.2).
An administrator cannot suspend themselves or remove their own administrator role (enforced by the back end, and the controls are hidden).

## Live run

| Step | Result |
|---|---|
| Administrator signs in (first sign-in: authenticator set up) | Users page lists every account with role, entity, ledger identity, authenticator and status |
| "Check again" for Alpha Computers Limited | "Alpha Computers Limited is verified with PACRA and ZRA."; recorded as `supplier.reverified` in the audit log |
| Audit log | Shows the sign-in, the re-verification, the regulator's report downloads and the officer's payment |

## Automated tests (Vitest + Testing Library)

`frontend/src/__tests__/admin.test.jsx`, 6 tests, all passing (41 in the front end in total):

- bidders' roles and the administrator's own role cannot be changed; no "Suspend" on yourself
- suspending a user is sent to the server and confirmed
- a new officer needs an entity; bidders cannot be added; ledger-signing roles are explained
- an expired tax clearance stands out; checking again shows why a company is suspended
- adding a procuring entity
- the audit log can be narrowed to failures
