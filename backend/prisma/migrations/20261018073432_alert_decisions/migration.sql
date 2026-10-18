-- CreateTable
CREATE TABLE "AlertDecision" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "record" JSONB NOT NULL,
    "recordHash" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertDecision_alertId_idx" ON "AlertDecision"("alertId");

-- AddForeignKey
ALTER TABLE "AlertDecision" ADD CONSTRAINT "AlertDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

