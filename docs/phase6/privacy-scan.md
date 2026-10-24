# Phase 6 privacy scan (NFR-03)

Run on 24 October 2026 at 14:40. Script: `backend/system-test/privacy-scan.mjs`.

Read back from the ledger: 61 records for 6 procurements (6 tender, 21 tender version, 9 bid, 5 award, 8 milestone, 4 payment, 8 alert).
Searched for 45 known personal or confidential values from the database (10 users' e-mails, names and phones;
3 companies' names, PACRA numbers and TPINs; bid file names; tender titles) and for e-mail addresses, phone numbers and bid wording.

**Result: nothing personal or confidential found on the ledger.**

## Every field the ledger holds

The ledger keeps references, hashes, amounts (in ngwee), times, statuses, organisation IDs (MSP) and pseudonymous
codes. Names, contact details and documents stay off-chain. Fields that identify who acted (`approvals`,
`certifiedBy`, `reviewerRef`) hold the SHA-256 fingerprint of the signer's certificate, not a name: only the issuing
organisation can link a fingerprint to a person. Bidders appear only as their `SUP-…` code.

| Field | Type |
|---|---|
| `alert.docType` | string |
| `alert.explanationHash` | string |
| `alert.id` | string |
| `alert.modelVersion` | string |
| `alert.raisedAt` | string |
| `alert.reasonHash` | string |
| `alert.reviewedAt` | string |
| `alert.reviewerMsp` | string |
| `alert.reviewerRef` | string |
| `alert.score` | number |
| `alert.status` | string |
| `alert.subjectId` | string |
| `alert.subjectType` | string |
| `award.amount` | number |
| `award.awardedAt` | string |
| `award.bidId` | string |
| `award.contractHash` | string |
| `award.contractValue` | number |
| `award.docType` | string |
| `award.evalHash` | string |
| `award.id` | string |
| `award.paidTotal` | number |
| `award.signedAt` | string |
| `award.standstillEnds` | string |
| `award.status` | string |
| `award.supplierRef` | string |
| `award.tenderId` | string |
| `award.updatedAt` | string |
| `award.variations` | number |
| `bid.cipherHash` | string |
| `bid.docType` | string |
| `bid.id` | string |
| `bid.opened` | boolean |
| `bid.openedAt` | string |
| `bid.plainHash` | string |
| `bid.submittedAt` | string |
| `bid.supplierRef` | string |
| `bid.tenderId` | string |
| `bid.txId` | string |
| `milestone.amount` | number |
| `milestone.awardId` | string |
| `milestone.certifiedBy` | string |
| `milestone.completedAt` | string |
| `milestone.completionDate` | string |
| `milestone.docType` | string |
| `milestone.dueDate` | string |
| `milestone.evidenceHash` | string |
| `milestone.id` | string |
| `milestone.paidTotal` | number |
| `milestone.paymentIds` | string |
| `milestone.status` | string |
| `payment.amount` | number |
| `payment.awardId` | string |
| `payment.docType` | string |
| `payment.id` | string |
| `payment.ifmisRef` | string |
| `payment.milestoneId` | string |
| `payment.paidAt` | string |
| `payment.txId` | string |
| `tender version.isDelete` | boolean |
| `tender version.tender.approvals` | string |
| `tender version.tender.closingTime` | string |
| `tender version.tender.currency` | string |
| `tender version.tender.docHashes` | string |
| `tender version.tender.docType` | string |
| `tender version.tender.estValue` | number |
| `tender version.tender.id` | string |
| `tender version.tender.openingApproved` | boolean |
| `tender version.tender.publishedBy` | string |
| `tender version.tender.quorum` | number |
| `tender version.tender.status` | string |
| `tender version.tender.updatedAt` | string |
| `tender version.tender.version` | number |
| `tender version.timestamp` | string |
| `tender version.txId` | string |
| `tender.approvals` | string |
| `tender.closingTime` | string |
| `tender.currency` | string |
| `tender.docHashes` | string |
| `tender.docType` | string |
| `tender.estValue` | number |
| `tender.id` | string |
| `tender.openingApproved` | boolean |
| `tender.publishedBy` | string |
| `tender.quorum` | number |
| `tender.status` | string |
| `tender.updatedAt` | string |
| `tender.version` | number |
