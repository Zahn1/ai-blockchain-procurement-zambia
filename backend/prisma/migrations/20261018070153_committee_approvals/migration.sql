-- When each committee member signed the opening approval on the ledger (3.5.5)
ALTER TABLE "CommitteeMember" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "CommitteeMember" ADD COLUMN "approvalTxId" TEXT;
