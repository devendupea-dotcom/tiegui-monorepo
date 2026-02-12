-- Contractor project workspace additions: notes, photos, measurements, and invoice-assist state.

CREATE TYPE "InvoiceStatus" AS ENUM ('NONE', 'DRAFT_READY', 'SENT');

ALTER TABLE "Lead"
  ADD COLUMN "invoiceStatus" "InvoiceStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "invoiceDraftText" TEXT,
  ADD COLUMN "invoiceDueAt" TIMESTAMP(3),
  ADD COLUMN "invoiceLastAutoTaskAt" TIMESTAMP(3);

CREATE INDEX "Lead_orgId_invoiceStatus_updatedAt_idx"
  ON "Lead"("orgId", "invoiceStatus", "updatedAt");

CREATE TABLE "LeadNote" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadNote_orgId_createdAt_idx"
  ON "LeadNote"("orgId", "createdAt");

CREATE INDEX "LeadNote_leadId_createdAt_idx"
  ON "LeadNote"("leadId", "createdAt");

ALTER TABLE "LeadNote"
  ADD CONSTRAINT "LeadNote_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadNote"
  ADD CONSTRAINT "LeadNote_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadNote"
  ADD CONSTRAINT "LeadNote_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeadPhoto" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "imageDataUrl" TEXT NOT NULL,
  "caption" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LeadPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadPhoto_orgId_createdAt_idx"
  ON "LeadPhoto"("orgId", "createdAt");

CREATE INDEX "LeadPhoto_leadId_createdAt_idx"
  ON "LeadPhoto"("leadId", "createdAt");

ALTER TABLE "LeadPhoto"
  ADD CONSTRAINT "LeadPhoto_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadPhoto"
  ADD CONSTRAINT "LeadPhoto_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadPhoto"
  ADD CONSTRAINT "LeadPhoto_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeadMeasurement" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "label" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "unit" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LeadMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadMeasurement_orgId_createdAt_idx"
  ON "LeadMeasurement"("orgId", "createdAt");

CREATE INDEX "LeadMeasurement_leadId_createdAt_idx"
  ON "LeadMeasurement"("leadId", "createdAt");

ALTER TABLE "LeadMeasurement"
  ADD CONSTRAINT "LeadMeasurement_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadMeasurement"
  ADD CONSTRAINT "LeadMeasurement_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadMeasurement"
  ADD CONSTRAINT "LeadMeasurement_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
