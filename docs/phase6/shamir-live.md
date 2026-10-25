# Live test: Shamir key splitting (FR-BID-07)

Run `MVNLU7KH` on 25 October 2026 at 11:09, back end started with `SHAMIR_OPENING=on`, tender `ZPPA/MOH/2026/SH-MVNLU7KH`.
Script: `backend/system-test/shamir-live.mjs`.

**Result: 16 of 16 checks passed**

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | Officer publishes a tender | PASS | block 2354 |
| 2 | alpha submits a sealed bid | PASS | BID-F3018805 |
| 3 | bravo submits a sealed bid | PASS | BID-47AE7F63 |
| 4 | Before the split, the back end holds both bid keys | PASS |  |
| 5 | Appointing the committee splits the opening key | PASS | {"threshold":2,"shares":2} |
| 6 | The back end no longer holds the bid keys | PASS | removed from data/bid-keys.json |
| 7 | The committee can no longer be changed | PASS |  |
| 8 | Each member collects their share | PASS | share 1 and share 2 of 2 |
| 9 | A share cannot be collected twice | PASS |  |
| 10 | Committee member 1 approves opening on the ledger | PASS |  |
| 11 | Committee member 2 approves opening on the ledger | PASS |  |
| 12 | With both ledger approvals but no shares, opening is refused | PASS | Opening needs 2 committee key shares; 0 provided. |
| 13 | A member cannot hand in another member's share | PASS |  |
| 14 | With one share of the two needed, opening is refused | PASS | Opening needs 2 committee key shares; 1 provided. |
| 15 | With the quorum's shares, the bids open and match their ledger hashes | PASS | BID-F3018805 MATCH, BID-47AE7F63 MATCH |
| 16 | The committee can read an opened bid | PASS | alpha bid for ZPPA/MOH/2026/SH-MVNLU7KH: total K54,000. |
