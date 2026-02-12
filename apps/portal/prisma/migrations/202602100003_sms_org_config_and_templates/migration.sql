-- Add organization-level SMS configuration.
ALTER TABLE "Organization"
  ADD COLUMN "smsFromNumberE164" TEXT,
  ADD COLUMN "missedCallAutoReplyOn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "missedCallAutoReplyBody" TEXT;

-- Create reusable per-organization SMS templates.
CREATE TABLE "SmsTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsTemplate_orgId_isActive_createdAt_idx"
  ON "SmsTemplate"("orgId", "isActive", "createdAt");

ALTER TABLE "SmsTemplate"
  ADD CONSTRAINT "SmsTemplate_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
