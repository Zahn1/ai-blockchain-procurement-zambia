# Phase 2 end-to-end scenario

Run 1791870367 on 13 October 2026 07:47 · tender `ZPPA/DEMO/1791870367` · channel `procurement` · chaincode `procurement`

Every transaction was endorsed by both peer0.zppa and peer0.oag (majority policy) and waited for commit.

**Result: 25 passed, 0 failed**

| # | Step | Caller | Result | Detail |
|---|---|---|---|---|
| 1 | Regulator sets standstill to 0 h for the demo | regulator1 (ZPPA) | PASS | committed (VALID) |
| 2 | Officer publishes tender (K150,000, closes in 75 s) | officer1 (ZPPA) | PASS | committed (VALID) |
| 3 | Gateway cannot publish a tender | gateway (ZPPA) | PASS | rejected: role \"gateway\" |
| 4 | Supplier alpha submits sealed bid | gateway (ZPPA) | PASS | committed (VALID) |
| 5 | Supplier bravo submits sealed bid | gateway (ZPPA) | PASS | committed (VALID) |
| 6 | Same supplier cannot bid twice | gateway (ZPPA) | PASS | rejected: already bid |
| 7 | Committee cannot approve opening before closing | committee1 (ZPPA) | PASS | rejected: before closing |
| 8 | Late bid after closing is rejected | gateway (ZPPA) | PASS | rejected: closed at |
| 9 | Bid cannot be opened without committee quorum | officer1 (ZPPA) | PASS | rejected: needs 2 committee approvals |
| 10 | Committee member 1 approves opening | committee1 (ZPPA) | PASS | committed (VALID) |
| 11 | Same member cannot approve twice | committee1 (ZPPA) | PASS | rejected: already approved |
| 12 | Committee member 2 approves opening (quorum reached) | committee2 (ZPPA) | PASS | committed (VALID) |
| 13 | Officer opens bid A | officer1 (ZPPA) | PASS | committed (VALID) |
| 14 | Officer opens bid B | officer1 (ZPPA) | PASS | committed (VALID) |
| 15 | Officer awards tender to bid A (K140,000) | officer1 (ZPPA) | PASS | committed (VALID) |
| 16 | Officer records signed contract | officer1 (ZPPA) | PASS | committed (VALID) |
| 17 | Officer adds milestone 1 (K60,000) | officer1 (ZPPA) | PASS | committed (VALID) |
| 18 | Officer adds milestone 2 (K80,000) | officer1 (ZPPA) | PASS | committed (VALID) |
| 19 | Payment before completion is refused | officer1 (ZPPA) | PASS | rejected: only after completion |
| 20 | Officer completes milestone 1 with evidence | officer1 (ZPPA) | PASS | committed (VALID) |
| 21 | Officer records payment for milestone 1 | officer1 (ZPPA) | PASS | committed (VALID) |
| 22 | Duplicate payment is refused | officer1 (ZPPA) | PASS | rejected: already been recorded |
| 23 | AI service raises risk alert (score 82) | risk-service (ZPPA) | PASS | committed (VALID) |
| 24 | Auditor cannot publish a tender | auditor1 (OAG) | PASS | rejected: organisation OAGMSP |
| 25 | Auditor (OAG) escalates the alert | auditor1 (OAG) | PASS | committed (VALID) |

## Ledger state read back by OAG

```json
{
  "docType": "tender",
  "id": "ZPPA/DEMO/1791870367",
  "estValue": 15000000,
  "currency": "ZMW",
  "closingTime": "2026-10-13T05:47:22Z",
  "docHashes": [
    "9cdde828e5491fac166a202b926ed01a263d4ae255b56f23f37a130179a661fd"
  ],
  "quorum": 2,
  "approvals": [
    "099b087ac4eb901a4b18973bbe4ceb3cc4a93381128fc89fa6988b355893deb7",
    "f07acd2c6826f95820d1443ec1635a3583ddc4261259bbf92b0c236dbf41f1d2"
  ],
  "openingApproved": true,
  "status": "AWARDED",
  "version": 2,
  "publishedBy": "ZPPAMSP",
  "updatedAt": "2026-10-13T05:47:34Z"
}
{
  "docType": "award",
  "id": "AWD-1791870367",
  "tenderId": "ZPPA/DEMO/1791870367",
  "bidId": "BID-A",
  "supplierRef": "SUP-alpha",
  "amount": 14000000,
  "contractValue": 14000000,
  "paidTotal": 6000000,
  "evalHash": "d6b35c17b0e6cb3bf08eb1d946911edd99cffb28c250ab35cc1919e20ad0224f",
  "contractHash": "e637614e017ccc88662c34e53d4083ad3b63ee7381a94ea934d730f77efe9b23",
  "variations": 0,
  "status": "SIGNED",
  "awardedAt": "2026-10-13T05:47:34Z",
  "standstillEnds": "2026-10-13T05:47:34Z",
  "signedAt": "2026-10-13T05:47:37Z",
  "updatedAt": "2026-10-13T05:47:45Z"
}
```

## Tender history (every version, oldest first)

```
2026-10-13T05:46:10Z  v1  PUBLISHED  approvals=0  tx 97c5562d9a38ac26158d3c128ce4cc7072d1b5ad67df36e6dc6fae2171864cf5
2026-10-13T05:47:25Z  v1  PUBLISHED  approvals=1  tx 56a1cd973d50543832a28d8d4bb52708403377fbb8cc2cc3e11614026acf44c2
2026-10-13T05:47:28Z  v1  PUBLISHED  approvals=2  tx fa84ad4de04f4aec048b9d5737352ab0ed373360e05c812acceff3156538e5dd
2026-10-13T05:47:34Z  v2  AWARDED  approvals=2  tx 2660be6a8ff15ca510b4441d9d0c11674a5fe963391acc69b49ce0a526423241
```
