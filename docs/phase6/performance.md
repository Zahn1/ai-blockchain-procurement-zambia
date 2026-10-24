# Phase 6 performance test

Run `MVMDMSL7` on 24 October 2026 at 14:30. Script: `backend/system-test/performance.mjs`.

Everything runs on one laptop: Apple M1 Pro, 16 GB RAM, macOS; Docker in Colima. The Fabric network has
one peer each for ZPPA and OAG and one Raft orderer; every write is endorsed by both organisations (majority policy).
The orderer cuts a block every 2 seconds or every 10 transactions, whichever comes first (`BatchTimeout: 2s`, `MaxMessageCount: 10`).

| Operation | Calls | In flight | p50 (ms) | p95 (ms) | Max (ms) | Throughput (per s) |
|---|---|---|---|---|---|---|
| Ledger read: ReadTender | 200 | 1 | 3 | 4 | 89 | 318.1 |
| Ledger read: ReadTender | 500 | 20 | 11 | 16 | 23 | 1715.2 |
| Ledger read: GetTenderHistory | 100 | 10 | 6 | 10 | 12 | 1584.7 |
| Ledger write: PublishTender, one at a time | 10 | 1 | 2035 | 2043 | 2043 | 0.5 |
| Ledger write: PublishTender, concurrent | 50 | 10 | 34 | 52 | 53 | 272.4 |
| Ledger write: PublishTender, concurrent | 100 | 25 | 54 | 95 | 98 | 408.2 |
| API: tender list (database) | 100 | 10 | 4 | 53 | 58 | 1111.4 |
| API: one tender with ledger history and bids | 100 | 10 | 24 | 34 | 35 | 408.6 |
| API: public search | 100 | 10 | 31 | 56 | 67 | 289.1 |
| API: regulator alerts (ledger + database) | 100 | 10 | 18 | 23 | 25 | 558.9 |
| API: procurement report (PDF) | 20 | 2 | 41 | 47 | 47 | 48.1 |
| API: OCDS download, all procurements | 20 | 2 | 36 | 42 | 42 | 55.8 |
| AI: /score | 200 | 10 | 172 | 228 | 236 | 54.9 |
| AI: /explain (with SHAP) | 100 | 10 | 210 | 235 | 244 | 46.8 |

p50 and p95: half and 95% of calls finished within this time. "In flight": calls running at the same time.
## What the figures show

- **Reads are fast.** A ledger query takes 3–11 ms, and the busiest screens (a tender with its ledger history, the
  regulator's alerts, public search) answer in 18–31 ms at the median with ten requests at once.
- **A single write takes about 2 seconds, and that is the orderer waiting, not the work.** With only one transaction
  pending, the orderer waits up to its 2-second batch timeout before cutting a block. This is why publishing a tender,
  submitting a bid or approving opening takes about 2 s in the system test.
- **Under load, writes are much faster.** With 10 or more transactions in flight a block fills at once (10 per block), so
  each write completed in 34–54 ms at the median and the network committed 272–408 transactions per second. All 160 test
  writes were checked afterwards: every one is on the ledger.
- **The AI service** answers in about 0.2 s, including the SHAP explanation, which is small next to a ledger write.

For a procurement system this is ample: ZPPA's e-GP handles thousands of tenders a year, not per second. The 2-second
wait on a lone write could be shortened by lowering `BatchTimeout` (e.g. to 500 ms) at the cost of more, smaller blocks.
A fuller benchmark with Hyperledger Caliper on separate machines remains a stretch goal (CLAUDE.md).

The 160 test tenders (`PERF/<run>/…`) exist only on the ledger; they are not in the database, so they do not appear in
the portal, search, reports or OCDS.
