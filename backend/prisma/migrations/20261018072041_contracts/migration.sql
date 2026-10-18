-- CreateTable
CREATE TABLE "Contract" (
    "awardId" TEXT NOT NULL,
    "tenderRef" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "supplierRef" TEXT NOT NULL,
    "amountNgwee" BIGINT NOT NULL,
    "evalHash" TEXT NOT NULL,
    "awardTxId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "standstillEnds" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "contractFileName" TEXT,
    "contractCid" TEXT,
    "contractHash" TEXT,
    "signTxId" TEXT,
    "signedAt" TIMESTAMP(3),
    "inspectorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("awardId")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "awardId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountNgwee" BIGINT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "certificateFileName" TEXT,
    "certificateCid" TEXT,
    "certificateHash" TEXT,
    "completionDate" TIMESTAMP(3),
    "certifiedById" TEXT,
    "certifyTxId" TEXT,
    "paymentStatus" TEXT,
    "paymentNote" TEXT,
    "paymentId" TEXT,
    "ifmisRef" TEXT,
    "paymentTxId" TEXT,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("awardId","milestoneId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_tenderRef_key" ON "Contract"("tenderRef");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_tenderRef_fkey" FOREIGN KEY ("tenderRef") REFERENCES "Tender"("reference") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Contract"("awardId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_certifiedById_fkey" FOREIGN KEY ("certifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

