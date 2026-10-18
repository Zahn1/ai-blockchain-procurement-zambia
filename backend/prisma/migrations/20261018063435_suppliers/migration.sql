-- Chapter 3, 3.5.2: suppliers keyed to their PACRA registration number.
-- The ledger code name moves from the user to the company, so all staff of one company bid under one name.

CREATE TYPE "SupplierStatus" AS ENUM ('VERIFIED', 'SUSPENDED');

CREATE TABLE "Supplier" (
    "pacraNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tpin" TEXT NOT NULL,
    "supplierRef" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'VERIFIED',
    "pacraStatus" TEXT NOT NULL,
    "taxClearanceNumber" TEXT NOT NULL,
    "taxClearanceExpiry" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("pacraNumber")
);
CREATE UNIQUE INDEX "Supplier_tpin_key" ON "Supplier"("tpin");
CREATE UNIQUE INDEX "Supplier_supplierRef_key" ON "Supplier"("supplierRef");

DROP INDEX "User_supplierRef_key";
ALTER TABLE "User" DROP COLUMN "supplierRef";
ALTER TABLE "User" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("pacraNumber") ON DELETE SET NULL ON UPDATE CASCADE;
