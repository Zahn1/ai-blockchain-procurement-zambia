# Phase 6 Caliper benchmark (NFR-13)

25 October 2026. Hyperledger Caliper 0.7.1, bound to Fabric 2.5 (Fabric Gateway SDK), 8 workers, against the running
network: one peer each for ZPPA and OAG, one Raft orderer, majority endorsement, `BatchTimeout: 2s`,
`MaxMessageCount: 10`; all on one MacBook Pro (M1 Pro, 16 GB) in Docker (Colima).
Configuration and workloads: `benchmark/` (run with `benchmark/run.sh`). Caliper's own HTML report: `caliper-report.html`.

Reads query one tender from a peer. Writes publish a tender through the chaincode as `officer1`; each write is endorsed
by both organisations, ordered and committed before it counts. The benchmark tenders (`CALIPER/…`) exist only on the
ledger and never appear in the portal, search or reports.

| Round | Sent | Succeeded | Failed | Send rate (TPS) | Throughput (TPS) | Avg latency (s) | Max latency (s) |
|---|---|---|---|---|---|---|---|
| Read tender | 4,000 | 4,000 | 0 | 200.4 | 200.4 | 0.01 | 0.23 |
| Publish tender at 25 TPS | 496 | 496 | 0 | 25.4 | 23.0 | 0.23 | 2.06 |
| Publish tender at 50 TPS | 1,000 | 1,000 | 0 | 50.4 | 50.3 | 0.12 | 0.21 |
| Publish tender at 100 TPS | 1,496 | 1,496 | 0 | 100.5 | 88.4 | 0.08 | 2.04 |
| Publish tender at 200 TPS | 2,000 | 2,000 | 0 | 200.7 | 200.2 | 0.05 | 0.09 |
| Publish tender at 400 TPS | 4,000 | 4,000 | 0 | 400.6 | 395.8 | 0.32 | 0.61 |
| Publish tender at 800 TPS | 8,000 | 8,000 | 0 | 800.2 | **439.1** | 9.27 | 10.66 |

(496 and 1,496: Caliper divides each round's transactions evenly between the 8 workers, so 500 and 1,500 round down.)

## What it shows

- **No failures** in 21,000 transactions (17,000 writes).
- **Capacity of about 440 writes per second.** Throughput follows the send rate up to 400 TPS; at 800 TPS it levels off
  at 439 TPS and latency rises to about 9 s as transactions queue. That is the saturation point of this network on
  one laptop.
- **Latency falls as load rises, up to saturation** (0.23 s at 25 TPS, 0.05 s at 200 TPS). Blocks are cut every
  10 transactions or every 2 seconds; the more transactions arrive, the sooner each block fills. The occasional
  2-second maximum at low rates is a transaction that waited for the batch timeout. This matches the project's own load
  test (`performance.md`).
- **Reads cost almost nothing** (10 ms average at 200 per second), because a query is answered by one peer without
  ordering.

For scale: ZPPA's open data holds 178,732 contracting processes over several years, each needing perhaps a dozen ledger
transactions; the whole history would take minutes at this rate. Capacity is not a constraint for public procurement;
the 2-second wait on a lone transaction could be shortened by lowering `BatchTimeout`.

## Limits

Every component runs on one laptop and shares its CPU, so these figures show the design's behaviour rather than
production capacity. A production network would place each organisation's peer and the orderers on separate machines.
