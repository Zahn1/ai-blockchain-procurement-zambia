-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fabricIdentity" TEXT;

-- CreateTable
CREATE TABLE "Tender" (
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "closingTime" TIMESTAMP(3) NOT NULL,
    "txId" TEXT NOT NULL,
    "block" INTEGER NOT NULL,
    "publishedById" TEXT NOT NULL,
    "technicalWeight" INTEGER NOT NULL DEFAULT 70,
    "passMark" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("reference")
);

-- CreateTable
CREATE TABLE "Bid" (
    "bidId" TEXT NOT NULL,
    "tenderRef" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierRef" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "cipherHash" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "integrity" TEXT,
    "plainHash" TEXT,
    "openedAt" TIMESTAMP(3),
    "priceNgwee" BIGINT,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("bidId")
);

-- CreateTable
CREATE TABLE "CommitteeMember" (
    "tenderRef" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CommitteeMember_pkey" PRIMARY KEY ("tenderRef","userId")
);

-- CreateTable
CREATE TABLE "Score" (
    "bidId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "technicalScore" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("bidId","userId")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "tenderRef" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "recommendedBidId" TEXT NOT NULL,
    "justification" TEXT,
    "report" JSONB NOT NULL,
    "reportHash" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("tenderRef")
);

-- CreateIndex
CREATE INDEX "Bid_tenderRef_idx" ON "Bid"("tenderRef");

-- CreateIndex
CREATE UNIQUE INDEX "User_fabricIdentity_key" ON "User"("fabricIdentity");

-- AddForeignKey
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_tenderRef_fkey" FOREIGN KEY ("tenderRef") REFERENCES "Tender"("reference") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("pacraNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMember" ADD CONSTRAINT "CommitteeMember_tenderRef_fkey" FOREIGN KEY ("tenderRef") REFERENCES "Tender"("reference") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMember" ADD CONSTRAINT "CommitteeMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("bidId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_tenderRef_fkey" FOREIGN KEY ("tenderRef") REFERENCES "Tender"("reference") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

