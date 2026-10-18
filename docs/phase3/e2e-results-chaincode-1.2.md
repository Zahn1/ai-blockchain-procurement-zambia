# Phase 2 end-to-end scenario

Run 1792307863 on 18 October 2026 09:19 · tender `ZPPA/DEMO/1792307863` · channel `procurement` · chaincode `procurement`

Every transaction was endorsed by both peer0.zppa and peer0.oag (majority policy) and waited for commit.

**Result: 30 passed, 0 failed**

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
| 19 | Payment before completion is refused | officer1 (ZPPA) | PASS | rejected: only after an inspector certifies completion |
| 20 | Officer cannot certify completion | officer1 (ZPPA) | PASS | rejected: role \"officer\" |
| 21 | Certificate for the wrong amount is refused | inspector1 (ZPPA) | PASS | rejected: certifies 5000000 ngwee, but milestone MS-1 is for 6000000 |
| 22 | Inspector certifies milestone 1 complete (signed certificate) | inspector1 (ZPPA) | PASS | committed (VALID) |
| 23 | AI service flags the contract as high risk (score 82) | risk-service (ZPPA) | PASS | committed (VALID) |
| 24 | Payment is held while the contract is flagged high risk | officer1 (ZPPA) | PASS | rejected: flagged as high risk |
| 25 | Regulator reviews the alert and decides to monitor | regulator1 (ZPPA) | PASS | committed (VALID) |
| 26 | Officer records payment for milestone 1 with its IFMIS reference | officer1 (ZPPA) | PASS | committed (VALID) |
| 27 | Duplicate payment is refused | officer1 (ZPPA) | PASS | rejected: already been recorded |
| 28 | AI service raises a risk alert on the tender (score 82) | risk-service (ZPPA) | PASS | committed (VALID) |
| 29 | Auditor cannot publish a tender | auditor1 (OAG) | PASS | rejected: organisation OAGMSP |
| 30 | Auditor (OAG) refers the alert for investigation | auditor1 (OAG) | PASS | committed (VALID) |

## Ledger state read back by OAG

```json
{
  "docType": "tender",
  "id": "ZPPA/DEMO/1792307863",
  "estValue": 15000000,
  "currency": "ZMW",
  "closingTime": "2026-10-18T07:18:58Z",
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
  "updatedAt": "2026-10-18T07:19:10Z"
}
{
  "docType": "award",
  "id": "AWD-1792307863",
  "tenderId": "ZPPA/DEMO/1792307863",
  "bidId": "BID-A",
  "supplierRef": "SUP-alpha",
  "amount": 14000000,
  "contractValue": 14000000,
  "paidTotal": 6000000,
  "evalHash": "d6b35c17b0e6cb3bf08eb1d946911edd99cffb28c250ab35cc1919e20ad0224f",
  "contractHash": "e637614e017ccc88662c34e53d4083ad3b63ee7381a94ea934d730f77efe9b23",
  "variations": 0,
  "status": "SIGNED",
  "awardedAt": "2026-10-18T07:19:10Z",
  "standstillEnds": "2026-10-18T07:19:10Z",
  "signedAt": "2026-10-18T07:19:13Z",
  "updatedAt": "2026-10-18T07:19:26Z"
}
```

## Tender history (every version, oldest first)

```
2026-10-18T07:17:45Z  v1  PUBLISHED  approvals=0  tx 7de6095d067064475b3f38eb79d0c27c90630dc2aad03da29ad104ea981cd723
2026-10-18T07:19:02Z  v1  PUBLISHED  approvals=1  tx c532709ae761c35ba21e8a3808163cf8bd00b907873b69c72793832d4b00faa4
2026-10-18T07:19:04Z  v1  PUBLISHED  approvals=2  tx 06270e3bc4591d0396af5443e60a882f28156ad57195a6e8d79496261674f845
2026-10-18T07:19:10Z  v2  AWARDED  approvals=2  tx 3c4c863cfe1e148e11e6317e69905fd988818d7321c4508a28680720d993e181
```
