-- Dashboard command center models, attribution metadata, and financial controls.

-- Enums
CREATE TYPE "AttributionSource" AS ENUM ('PAID', 'ORGANIC', 'UNKNOWN');
CREATE TYPE "BudgetRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Lead finance field
ALTER TABLE "Lead"
  ADD COLUMN "estimatedRevenueCents" INTEGER;

-- Call attribution/proof fields
ALTER TABLE "Call"
  ADD COLUMN "trackingNumberE164" TEXT,
  ADD COLUMN "landingPageUrl" TEXT,
  ADD COLUMN "utmCampaign" TEXT,
  ADD COLUMN "gclid" TEXT,
  ADD COLUMN "attributionSource" "AttributionSource" NOT NULL DEFAULT 'UNKNOWN';

-- Per-org dashboard config
CREATE TABLE "OrgDashboardConfig" (
  "orgId" TEXT NOT NULL,
  "adsPaused" BOOLEAN NOT NULL DEFAULT false,
  "dailyBudgetCents" INTEGER NOT NULL DEFAULT 25000,
  "missedCallMessage" TEXT,
  "jobReminderMinutesBefore" INTEGER NOT NULL DEFAULT 120,
  "googleReviewUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrgDashboardConfig_pkey" PRIMARY KEY ("orgId")
);

ALTER TABLE "OrgDashboardConfig"
  ADD CONSTRAINT "OrgDashboardConfig_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Budget change workflow
CREATE TABLE "BudgetRequest" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "reviewedByUserId" TEXT,
  "requestedDailyCents" INTEGER NOT NULL,
  "note" TEXT,
  "status" "BudgetRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "BudgetRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BudgetRequest_orgId_status_createdAt_idx"
  ON "BudgetRequest"("orgId", "status", "createdAt");

ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BudgetRequest"
  ADD CONSTRAINT "BudgetRequest_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual ad spend history for ROI tracking
CREATE TABLE "AdSpendEntry" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "spendDate" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "source" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdSpendEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdSpendEntry_orgId_spendDate_idx"
  ON "AdSpendEntry"("orgId", "spendDate");

ALTER TABLE "AdSpendEntry"
  ADD CONSTRAINT "AdSpendEntry_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdSpendEntry"
  ADD CONSTRAINT "AdSpendEntry_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
