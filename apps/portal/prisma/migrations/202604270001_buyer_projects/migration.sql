CREATE TYPE "BuyerProjectType" AS ENUM ('MANUFACTURED_HOME', 'ADU_DADU', 'PARK_MODEL', 'PRESALE', 'UNKNOWN');

CREATE TYPE "BuyerProjectStage" AS ENUM ('COMPARE_HOMES', 'FINANCING_BUDGET', 'LAND_FEASIBILITY', 'ORDER_DELIVERY', 'SETUP_FINISH', 'MOVE_IN');

ALTER TABLE "WebsiteLeadSubmissionReceipt"
ADD COLUMN "createdBuyerProjectId" TEXT;

CREATE TABLE "BuyerProject" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "customerId" TEXT,
  "leadId" TEXT,
  "projectType" "BuyerProjectType" NOT NULL DEFAULT 'UNKNOWN',
  "currentStage" "BuyerProjectStage" NOT NULL DEFAULT 'COMPARE_HOMES',
  "projectName" TEXT NOT NULL,
  "buyerName" TEXT NOT NULL,
  "phoneE164" TEXT,
  "email" TEXT,
  "selectedHomeSlug" TEXT,
  "selectedHomeTitle" TEXT,
  "selectedHomeType" TEXT,
  "selectedHomeTypeSlug" TEXT,
  "selectedHomeCollection" TEXT,
  "selectedHomePriceLabel" TEXT,
  "selectedHomeBeds" INTEGER,
  "selectedHomeBathsLabel" TEXT,
  "selectedHomeSqft" INTEGER,
  "selectedHomeStatus" TEXT,
  "selectedHomeLocationLabel" TEXT,
  "selectedHomeModelSeries" TEXT,
  "selectedHomeUrl" TEXT,
  "sourcePath" TEXT,
  "sourcePageTitle" TEXT,
  "budgetRange" TEXT,
  "financingStatus" TEXT,
  "landStatus" TEXT,
  "timeline" TEXT,
  "buyerGoal" TEXT,
  "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
  "buyerNextStep" TEXT,
  "internalNextStep" TEXT,
  "publicNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BuyerProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuyerProjectShareLink" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "buyerProjectId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BuyerProjectShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerProject_leadId_key"
ON "BuyerProject"("leadId");

CREATE INDEX "BuyerProject_orgId_currentStage_updatedAt_idx"
ON "BuyerProject"("orgId", "currentStage", "updatedAt");

CREATE INDEX "BuyerProject_orgId_projectType_updatedAt_idx"
ON "BuyerProject"("orgId", "projectType", "updatedAt");

CREATE INDEX "BuyerProject_customerId_updatedAt_idx"
ON "BuyerProject"("customerId", "updatedAt");

CREATE INDEX "BuyerProject_selectedHomeSlug_idx"
ON "BuyerProject"("selectedHomeSlug");

CREATE UNIQUE INDEX "BuyerProjectShareLink_tokenHash_key"
ON "BuyerProjectShareLink"("tokenHash");

CREATE INDEX "BuyerProjectShareLink_orgId_createdAt_idx"
ON "BuyerProjectShareLink"("orgId", "createdAt");

CREATE INDEX "BuyerProjectShareLink_buyerProjectId_createdAt_idx"
ON "BuyerProjectShareLink"("buyerProjectId", "createdAt");

CREATE INDEX "BuyerProjectShareLink_createdByUserId_createdAt_idx"
ON "BuyerProjectShareLink"("createdByUserId", "createdAt");

CREATE INDEX "BuyerProjectShareLink_revokedAt_createdAt_idx"
ON "BuyerProjectShareLink"("revokedAt", "createdAt");

CREATE INDEX "WebsiteLeadSubmissionReceipt_createdBuyerProjectId_idx"
ON "WebsiteLeadSubmissionReceipt"("createdBuyerProjectId");

ALTER TABLE "BuyerProject"
ADD CONSTRAINT "BuyerProject_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuyerProject"
ADD CONSTRAINT "BuyerProject_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BuyerProject"
ADD CONSTRAINT "BuyerProject_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BuyerProjectShareLink"
ADD CONSTRAINT "BuyerProjectShareLink_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuyerProjectShareLink"
ADD CONSTRAINT "BuyerProjectShareLink_buyerProjectId_fkey"
FOREIGN KEY ("buyerProjectId") REFERENCES "BuyerProject"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuyerProjectShareLink"
ADD CONSTRAINT "BuyerProjectShareLink_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
