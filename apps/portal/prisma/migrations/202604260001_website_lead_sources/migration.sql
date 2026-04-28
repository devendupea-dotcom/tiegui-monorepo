CREATE TABLE IF NOT EXISTS "WebsiteLeadSource" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "hashedSecret" TEXT NOT NULL,
  "encryptedSecret" TEXT NOT NULL,
  "allowedOrigin" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "rateLimitKey" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteLeadSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebsiteLeadSubmissionReceipt" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdLeadId" TEXT,
  "createdCustomerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebsiteLeadSubmissionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WebsiteLeadSource_orgId_active_idx"
ON "WebsiteLeadSource"("orgId", "active");

CREATE INDEX IF NOT EXISTS "WebsiteLeadSource_active_updatedAt_idx"
ON "WebsiteLeadSource"("active", "updatedAt");

CREATE INDEX IF NOT EXISTS "WebsiteLeadSource_rateLimitKey_idx"
ON "WebsiteLeadSource"("rateLimitKey");

CREATE UNIQUE INDEX IF NOT EXISTS "WebsiteLeadSubmissionReceipt_sourceId_idempotencyKey_key"
ON "WebsiteLeadSubmissionReceipt"("sourceId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "WebsiteLeadSubmissionReceipt_orgId_createdAt_idx"
ON "WebsiteLeadSubmissionReceipt"("orgId", "createdAt");

CREATE INDEX IF NOT EXISTS "WebsiteLeadSubmissionReceipt_sourceId_createdAt_idx"
ON "WebsiteLeadSubmissionReceipt"("sourceId", "createdAt");

CREATE INDEX IF NOT EXISTS "WebsiteLeadSubmissionReceipt_createdLeadId_idx"
ON "WebsiteLeadSubmissionReceipt"("createdLeadId");

ALTER TABLE "WebsiteLeadSource"
ADD CONSTRAINT "WebsiteLeadSource_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteLeadSubmissionReceipt"
ADD CONSTRAINT "WebsiteLeadSubmissionReceipt_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "WebsiteLeadSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteLeadSubmissionReceipt"
ADD CONSTRAINT "WebsiteLeadSubmissionReceipt_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
