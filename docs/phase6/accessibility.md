# Phase 6 accessibility check (NFR-10: WCAG 2.1 AA)

Date: 24 October 2026. Tool: axe-core 4.10.2, the engine behind most accessibility checkers, with the WCAG 2.0 and 2.1
level A and AA rules (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`).

## Two layers

1. **Automated, in the test suite** (`frontend/src/__tests__/accessibility.test.jsx`): ten screens rendered with test data
   and checked on every run, plus a control that proves the check catches problems (an image with no text and an
   unlabelled field must fail). jsdom has no layout, so colour contrast cannot be measured there.
2. **In a real browser** on the running system, at 1280 × 900, with live data, which also measures colour contrast.

## Results in the browser

First run: 19 screens across four roles and the public pages. Findings, then fixed:

| Finding | Where | WCAG | Fix |
|---|---|---|---|
| Light grey text ("system", "–") at 2.63:1 | Audit log, dashboard activity | 1.4.3 Contrast (minimum), 4.5:1 | Darker grey (slate-500, 4.76:1); also placeholders and the copy icon |
| Grey text on the selected (light blue) row at 4.32:1 | Risk alerts list | 1.4.3 | Slate-600 for secondary text there and in the risk score's band |
| Tables that scroll sideways could not be reached by keyboard | Every wide table on a narrow screen | 2.1.1 Keyboard | The scroll area can take focus, with a visible focus ring |

After the fixes, every screen passes:

| Screen | Role | Text elements passing contrast | Violations |
|---|---|---|---|
| Sign in | – | 17 | 0 |
| Register as a bidder | – | 32 | 0 |
| Public records | – | 97 | 0 |
| Dashboard | Regulator | 50 | 0 |
| Risk alerts | Regulator | 61 | 0 |
| Procurement history | Regulator | 83 | 0 |
| Reports | Regulator | 28 | 0 |
| Dashboard | Officer | 66 | 0 |
| Tenders | Officer | 57 | 0 |
| Publish tender | Officer | 37 | 0 |
| Tender record | Officer | 76 | 0 |
| Evaluation | Officer | 53 | 0 |
| Evaluation of one tender | Officer | 73 | 0 |
| Contracts | Officer | 66 | 0 |
| Contract | Officer | 72 | 0 |
| Dashboard | Administrator | 62 | 0 |
| Users | Administrator | 102 | 0 |
| Bidders and entities | Administrator | 62 | 0 |
| Audit log | Administrator | 499 | 0 |

## Limits

Automated tools find roughly a third to a half of accessibility problems. They cannot judge whether labels make sense,
whether the order of a task is clear, or how a screen reader user experiences a page. Those are covered by the usability
sessions (`docs/phase6/usability/`), and a full audit with a screen reader user would be the next step.
