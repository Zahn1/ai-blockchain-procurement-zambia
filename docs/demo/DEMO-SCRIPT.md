# Demonstration script: the complete prototype

About 20 minutes. One procurement, from tender to payment, through every role, covering all ten functional
requirements (3.5.1–3.5.10). Sample files are in this folder (`docs/demo/`).
The earlier two-requirement demo of the basic prototype is in `DEMO-SCRIPT-prototype-v1.md`.

## Once, before the first rehearsal

1. Make the authenticator page and scan every account into Google or Microsoft Authenticator on your phone:
   ```bash
   cd ~/procurement/backend && node scripts/demo-authenticator.mjs
   ```
   Open `backend/data/live/demo-accounts.html` in a browser and scan each QR code. The page also lists the passwords.
   Keep it private: it holds the demo accounts' secrets.

## On the day, 15 minutes before

1. Start everything (also after a restart):
   ```bash
   ~/procurement/scripts/start-demo.sh
   ```
   Wait for **Ready.** If something fails, the script names it and its log is in `logs/`.
2. In one browser window, open **http://localhost:5173** in nine tabs and sign in each tab as one person. Each tab keeps
   its own session, and a session lasts 8 hours:

   | Tab | Sign in as | Role |
   |---|---|---|
   | 1 | `officer@moh.test` | Procurement officer, Ministry of Health |
   | 2 | `grace@alpha.test` | Bidder, Alpha Computers |
   | 3 | `peter@bravo.test` | Bidder, Bravo Tech |
   | 4 | `member1@moh.test` | Evaluation committee |
   | 5 | `member2@moh.test` | Evaluation committee |
   | 6 | `inspector@moh.test` | Inspector |
   | 7 | `regulator@zppa.test` | Regulator (ZPPA) |
   | 8 | `admin@zppa.test` | Administrator |
   | 9 | *(not signed in)* `/public` | Member of the public |

3. Open **http://127.0.0.1:8025** (the e-mail inbox) in a tenth tab.
4. Choose a new tender reference for this run, e.g. `ZPPA/MOH/2026/D001`. Use D002, D003 … for each rehearsal.

## 1. Who can do what · 3.5.1, 3.5.2 (2 min)

*Tab 8, administrator.*

1. **Users**: each person has one role and sees only that role's screens. Committee members, inspectors and regulators
   have their **own ledger identity**, so what they sign on the ledger is traceable to them.
2. **Bidders and entities**: companies were checked with PACRA (registration) and ZRA (tax clearance). Click
   **Check again** on Alpha Computers.
3. *Tab 9*: go to **Sign in → Register as a bidder** and try PACRA `120260000105`, TPIN `1000000105` with any name, e-mail
   and password. It is refused: *"The ZRA tax clearance expired on 30 June 2026."* Say: *"No account is created unless both
   registries confirm the company."*

## 2. Publish a tender · 3.5.3 (2 min)

*Tab 1, officer.*

1. **Tenders → Publish tender**. Reference `ZPPA/MOH/2026/D001`, value `150000`, title *Supply of 40 laptop computers*,
   **closes in 4 minutes**, document `tender-document.txt`.
2. Point at the result: the **document hash (SHA-256)**, the **IPFS address**, the **transaction** and **block**.
   Say: *"Both ZPPA and the Office of the Auditor General endorsed this. Neither can change it alone."*
3. **View tender → Check a document**: upload `tender-document.txt` → **Matches the ledger**. Upload
   `tender-document-altered.txt` → **Does not match**. Say: *"Someone changed the delivery from 30 to 60 days."*

## 3. Sealed bids · 3.5.4 (2 min, before the 4 minutes run out)

1. *Tab 2, Alpha*: **My bids** → **Submit bid** on D001 → `bid-alpha.txt`, tick the confirmation, **Submit sealed bid**.
   Point at the **signed receipt** and **Signature valid**. Say: *"The file was encrypted with its own AES-256 key. Only
   the encrypted file's hash is on the ledger. Nobody, not even ZPPA, can read the price before opening."*
2. *Tab 3, Bravo*: the same with `bid-bravo.txt`.
3. *Tab 1, officer*: open the tender. The bids are listed by **code only** (`SUP-…`) and marked **Sealed**.

## 4. Opening and evaluation · 3.5.5 (4 min)

1. *Tab 1, officer*: **Evaluation → D001** → tick both members → **Appoint 2 members**.
2. *Tab 4, member 1*: **Approve opening**. If the tender has not closed yet, the screen says the ledger will refuse it;
   say so and point at the closing time. This is the ledger enforcing the rule, not the screen.
3. Once closed: *Tab 3, Bravo* tries `bid-late.txt` on D001 → it is no longer offered (and the ledger would refuse it).
4. *Tab 4* and *Tab 5*: **Approve opening** in each. The steps show **2 of 2 on the ledger**.
5. *Tab 4*: **Open 2 bids** → *"matches its ledger hash"* for each.
6. *Tab 4*: **Evaluate** Alpha: price `138500`, score `80`, a comment; Bravo: price `142000`, score `76`. *Tab 5*: score
   Alpha `78`, Bravo `74`, with comments.
7. Point at the **Ranking** (70% technical, 30% financial). Choose the other bid in **Recommended bid** to show that a
   **written justification** is required, then switch back and **Record recommendation**. Point at the **report hash**.

## 5. Award, AI risk score, contract and payment · 3.5.6, 3.5.7 (4 min)

1. *Tab 1, officer*: **Contracts → Ready to award → Award**. The AI scores the award at once.
   - With the demo data it usually raises an alert (Alpha has won most earlier awards): *"Payments on this contract are
     held."* Say: *"The AI does not block anything by itself; it holds the money until a regulator looks."*
2. **Sign the contract**: two milestones (e.g. `Delivery of 40 laptops` K69,250 and `Installation and training`
   K69,250, due dates in November), inspector, file `contract-signed.txt` → **Sign contract**.
3. *Tab 6, inspector*: **Contracts → (the award) → Certify** milestone 1 with `certificate-milestone-1.txt` → if flagged,
   **Payment held** with the ledger's reason; if not, **Paid through IFMIS** with its reference.

## 6. Regulator · 3.5.7, 3.5.8 (3 min)

*Tab 7, regulator.*

1. **Risk alerts**: open the new alert. Point at **why it was flagged**, in plain words, and *"This explanation matches the
   hash recorded on the ledger."*
2. Choose **Monitor**, write a reason → **Record decision on the ledger**. Only the decisions the ledger allows next are
   offered.
3. *Tab 1, officer*: on the contract, **Retry payment** → **Paid**, with the IFMIS reference.
4. *Tab 7*: **Procurement history**, enter the award ID → every step from publication to payment, by day, each with its
   ledger transaction.

## 7. The public · 3.5.9, 3.5.10 (2 min)

1. *Tab 9, public*: **Search records** for `D001` → the tender, contract and payment, with the winning company but no
   people's names and no bid contents.
2. **Check certificate** → upload `certificate-milestone-1.txt` → **Matches the ledger**; then
   `certificate-milestone-1-altered.txt` (38 laptops instead of 40) → **Does not match**.
3. **Open data** → **Download all procurements**: the OCDS file that journalists and watchdogs can use.
4. *Tab 7, regulator*: **Reports** → download the procurement report as **PDF** and as a **spreadsheet**.
5. E-mail inbox tab: the award and payment notifications.

## If something goes wrong

| Problem | What to do |
|---|---|
| A page says the session has ended | Sign that tab in again (sessions last 8 hours) |
| "That code is not valid" | Wait for the next code in the authenticator app; each code works once |
| The ledger refuses an action | Read the message aloud: it is the chaincode enforcing a rule (e.g. before closing). That is part of the demonstration |
| A service did not start | Run `~/procurement/scripts/start-demo.sh` again; check `logs/` |
| Nothing works after a restart | `colima start`, then the start script; the ledger and database keep their data |

## Back-up evidence

If the live demo fails, the same procurement has been run automatically: `docs/phase6/system-test-results.md`
(77 of 77 checks), and each screen's live run is written up in `docs/phase5/`.
