ALTER TABLE "Invoice"
ADD COLUMN "sourceJobId" TEXT;

ALTER TABLE "Job"
ADD COLUMN "costingNotes" TEXT;

ALTER TABLE "JobMaterials"
ADD COLUMN "actualQuantity" DECIMAL(10,2),
ADD COLUMN "actualUnitCost" DECIMAL(12,2),
ADD COLUMN "actualTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "varianceNotes" TEXT;

ALTER TABLE "JobLabor"
ADD COLUMN "actualHours" DECIMAL(10,2),
ADD COLUMN "actualHourlyCost" DECIMAL(12,2),
ADD COLUMN "actualTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "varianceNotes" TEXT;

UPDATE "Invoice" AS invoice
SET "sourceJobId" = estimate."jobId"
FROM "Estimate" AS estimate
WHERE invoice."sourceEstimateId" = estimate."id"
  AND estimate."jobId" IS NOT NULL
  AND invoice."sourceJobId" IS NULL;

CREATE INDEX "Invoice_sourceJobId_createdAt_idx" ON "Invoice"("sourceJobId", "createdAt");

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_sourceJobId_fkey"
FOREIGN KEY ("sourceJobId") REFERENCES "Job"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
