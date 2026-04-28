-- AlterTable
ALTER TABLE "Organization"
ADD COLUMN "estimatePrefix" TEXT NOT NULL DEFAULT 'EST',
ADD COLUMN "estimateNextNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Lead"
ADD COLUMN "latestEstimateId" TEXT,
ADD COLUMN "estimateCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Invoice"
ADD COLUMN "sourceEstimateId" TEXT;

-- AlterTable
ALTER TABLE "Job"
ADD COLUMN "sourceEstimateId" TEXT;

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'DECLINED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "EstimateActivityType" AS ENUM (
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'ITEM_ADDED',
  'ITEM_REMOVED',
  'SENT',
  'VIEWED',
  'APPROVED',
  'DECLINED',
  'CONVERTED_TO_JOB',
  'CONVERTED_TO_INVOICE',
  'ARCHIVED'
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leadId" TEXT,
    "jobId" TEXT,
    "createdByUserId" TEXT,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "estimateNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "siteAddress" TEXT,
    "projectType" TEXT,
    "description" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLineItem" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "materialId" TEXT,
    "type" "EstimateDraftLineType" NOT NULL DEFAULT 'CUSTOM_MATERIAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateActivity" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "type" "EstimateActivityType" NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateActivity_pkey" PRIMARY KEY ("id")
);

-- Backfill legacy estimate drafts into Estimate using the same ids for future linkage.
INSERT INTO "Estimate" (
  "id",
  "orgId",
  "leadId",
  "jobId",
  "createdByUserId",
  "status",
  "estimateNumber",
  "title",
  "customerName",
  "siteAddress",
  "projectType",
  "description",
  "subtotal",
  "taxRate",
  "tax",
  "total",
  "notes",
  "terms",
  "validUntil",
  "sentAt",
  "viewedAt",
  "approvedAt",
  "declinedAt",
  "archivedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  d."id",
  d."orgId",
  NULL,
  NULL,
  d."createdByUserId",
  'DRAFT'::"EstimateStatus",
  COALESCE(NULLIF(TRIM(o."estimatePrefix"), ''), 'EST') || '-LEGACY-' ||
    LPAD(ROW_NUMBER() OVER (PARTITION BY d."orgId" ORDER BY d."createdAt", d."id")::text, 4, '0'),
  COALESCE(NULLIF(d."projectName", ''), 'Legacy Estimate'),
  d."customerName",
  d."siteAddress",
  d."projectType",
  NULL,
  d."subtotal",
  d."taxRate",
  d."taxAmount",
  d."finalTotal",
  d."notes",
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  d."createdAt",
  d."updatedAt"
FROM "EstimateDraft" d
LEFT JOIN "Organization" o ON o."id" = d."orgId";

INSERT INTO "EstimateLineItem" (
  "id",
  "estimateId",
  "materialId",
  "type",
  "sortOrder",
  "name",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "total",
  "createdAt",
  "updatedAt"
)
SELECT
  li."id",
  li."estimateDraftId",
  li."materialId",
  li."type",
  li."sortOrder",
  li."description",
  NULL,
  li."quantity",
  li."unit",
  CASE
    WHEN li."quantity" = 0 THEN li."lineSellTotal"
    ELSE ROUND(li."lineSellTotal" / NULLIF(li."quantity", 0), 2)
  END,
  li."lineSellTotal",
  li."createdAt",
  li."updatedAt"
FROM "EstimateDraftLineItem" li
INNER JOIN "Estimate" e ON e."id" = li."estimateDraftId";

INSERT INTO "EstimateActivity" ("id", "estimateId", "type", "actorUserId", "metadata", "createdAt")
SELECT
  e."id" || '-created',
  e."id",
  'CREATED'::"EstimateActivityType",
  e."createdByUserId",
  jsonb_build_object('source', 'legacy-draft-migration'),
  e."createdAt"
FROM "Estimate" e
INNER JOIN "EstimateDraft" d ON d."id" = e."id";

UPDATE "Job"
SET "sourceEstimateId" = "estimateDraftId"
WHERE "estimateDraftId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_orgId_estimateNumber_key" ON "Estimate"("orgId", "estimateNumber");

-- CreateIndex
CREATE INDEX "Estimate_orgId_status_updatedAt_idx" ON "Estimate"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Estimate_orgId_archivedAt_updatedAt_idx" ON "Estimate"("orgId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Estimate_orgId_customerName_updatedAt_idx" ON "Estimate"("orgId", "customerName", "updatedAt");

-- CreateIndex
CREATE INDEX "Estimate_leadId_updatedAt_idx" ON "Estimate"("leadId", "updatedAt");

-- CreateIndex
CREATE INDEX "Estimate_jobId_updatedAt_idx" ON "Estimate"("jobId", "updatedAt");

-- CreateIndex
CREATE INDEX "Estimate_createdByUserId_updatedAt_idx" ON "Estimate"("createdByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "EstimateLineItem_estimateId_sortOrder_idx" ON "EstimateLineItem"("estimateId", "sortOrder");

-- CreateIndex
CREATE INDEX "EstimateLineItem_materialId_idx" ON "EstimateLineItem"("materialId");

-- CreateIndex
CREATE INDEX "EstimateActivity_estimateId_createdAt_idx" ON "EstimateActivity"("estimateId", "createdAt");

-- CreateIndex
CREATE INDEX "EstimateActivity_actorUserId_createdAt_idx" ON "EstimateActivity"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_latestEstimateId_idx" ON "Lead"("latestEstimateId");

-- CreateIndex
CREATE INDEX "Invoice_sourceEstimateId_createdAt_idx" ON "Invoice"("sourceEstimateId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_sourceEstimateId_updatedAt_idx" ON "Job"("sourceEstimateId", "updatedAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_latestEstimateId_fkey" FOREIGN KEY ("latestEstimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sourceEstimateId_fkey" FOREIGN KEY ("sourceEstimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateActivity" ADD CONSTRAINT "EstimateActivity_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateActivity" ADD CONSTRAINT "EstimateActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceEstimateId_fkey" FOREIGN KEY ("sourceEstimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
