-- Shamir key splitting for bid opening (FR-BID-07)
ALTER TABLE "Tender" ADD COLUMN "openingMode" TEXT NOT NULL DEFAULT 'SERVER';
ALTER TABLE "Tender" ADD COLUMN "openingPublicKey" TEXT;
ALTER TABLE "Bid" ADD COLUMN "wrappedKey" TEXT;
ALTER TABLE "CommitteeMember" ADD COLUMN "shareIndex" INTEGER;
ALTER TABLE "CommitteeMember" ADD COLUMN "shareHash" TEXT;
ALTER TABLE "CommitteeMember" ADD COLUMN "shareSealed" TEXT;
ALTER TABLE "CommitteeMember" ADD COLUMN "shareDownloadedAt" TIMESTAMP(3);
ALTER TABLE "CommitteeMember" ADD COLUMN "sharePending" TEXT;
