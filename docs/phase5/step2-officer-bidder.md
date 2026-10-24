# Phase 5, step 2: officer and bidder screens

Date: 24 October 2026. Front end at http://localhost:5173, back end at :3000, Fabric network `procurement` channel.

## Screens

| Screen | Path | Role | Requirement |
|---|---|---|---|
| Tender register (search, filter by open/closed) | `/tenders` | Procurement officer | 3.5.3 |
| Publish tender (reference, value, title, closing time, document) | `/tenders/new` | Procurement officer | 3.5.3 |
| Tender record: ledger fields, sealed bids, version history, document check | `/tender?id=…` | All signed-in roles | 3.5.3, 3.5.4 |
| My bids: open tenders and bids submitted, with status | `/bids` | Bidder | 3.5.4 |
| Submit sealed bid, then signed receipt with signature check and download | `/bids/new` | Bidder | 3.5.4 |

## Live run on the network

| Step | Result |
|---|---|
| Officer publishes `ZPPA/MOH/2026/F0001` (K86,500.00, closes in 4 minutes, `tender-F0001.txt`) | Recorded in block 100; document hash `466138ef…6c60c69` |
| Bidder Alpha Computers (code `SUP-FS9373`) submits a sealed bid | `BID-7A13001F` recorded in block 101; receipt signature checked as valid |
| Tender record page | Shows "Open for bids", committee approvals 0 of 2, the bid as "Sealed" and "(yours)"; the bid button is hidden once the bidder has bid |
| Document check with an identical copy | "Matches the ledger" |

## Automated tests (Vitest + Testing Library)

`frontend/src/__tests__/tenders-bids.test.jsx`, 11 tests, all passing (17 in the front end in total):

- tender stage in words: open, closed, bids opened, awarded
- officer sees the register and can filter to open tenders
- officer publishes a tender: closing time sent in minutes, value in kwacha, document attached
- a ledger refusal is shown as such
- officer cannot reach the bid form
- bidder sees only open tenders to bid on, and their own bids with status
- bidder submits a sealed bid only after confirming, and gets a receipt whose signature is checked
- bidder is not offered a second bid on a tender already bid on
