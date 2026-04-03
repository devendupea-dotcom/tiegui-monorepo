ALTER TYPE "EstimateActivityType" ADD VALUE IF NOT EXISTS 'SHARE_LINK_CREATED';
ALTER TYPE "EstimateActivityType" ADD VALUE IF NOT EXISTS 'SHARE_LINK_REVOKED';

ALTER TABLE "Estimate"
ADD COLUMN "sharedAt" TIMESTAMP(3),
ADD COLUMN "shareExpiresAt" TIMESTAMP(3),
ADD COLUMN "customerViewedAt" TIMESTAMP(3),
ADD COLUMN "customerDecisionAt" TIMESTAMP(3),
ADD COLUMN "customerDecisionName" TEXT,
ADD COLUMN "customerDecisionNote" TEXT;

CREATE TABLE "EstimateShareLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhoneE164" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "decisionName" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstimateShareLink_tokenHash_key" ON "EstimateShareLink"("tokenHash");
CREATE INDEX "EstimateShareLink_orgId_createdAt_idx" ON "EstimateShareLink"("orgId", "createdAt");
CREATE INDEX "EstimateShareLink_estimateId_createdAt_idx" ON "EstimateShareLink"("estimateId", "createdAt");
CREATE INDEX "EstimateShareLink_createdByUserId_createdAt_idx" ON "EstimateShareLink"("createdByUserId", "createdAt");
CREATE INDEX "EstimateShareLink_expiresAt_revokedAt_idx" ON "EstimateShareLink"("expiresAt", "revokedAt");

ALTER TABLE "EstimateShareLink"
ADD CONSTRAINT "EstimateShareLink_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "EstimateShareLink"
ADD CONSTRAINT "EstimateShareLink_estimateId_fkey"
FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "EstimateShareLink"
ADD CONSTRAINT "EstimateShareLink_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
