-- CreateTable
CREATE TABLE "RiskAlert" (
    "alertId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "explanation" JSONB NOT NULL,
    "explanationHash" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAlert_pkey" PRIMARY KEY ("alertId")
);

-- CreateIndex
CREATE INDEX "RiskAlert_subjectId_idx" ON "RiskAlert"("subjectId");

