CREATE TYPE "SmsConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT', 'UNKNOWN');

CREATE TYPE "SmsConsentSource" AS ENUM ('TWILIO_STOP', 'TWILIO_START', 'MANUAL', 'LEGACY_DNC_BACKFILL', 'SYSTEM');

CREATE TABLE "SmsConsent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "customerId" TEXT,
  "leadId" TEXT,
  "status" "SmsConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "source" "SmsConsentSource" NOT NULL DEFAULT 'SYSTEM',
  "lastKeyword" TEXT,
  "lastMessageBodyPreview" TEXT,
  "optedOutAt" TIMESTAMP(3),
  "optedInAt" TIMESTAMP(3),
  "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadataJson" JSONB,

  CONSTRAINT "SmsConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsConsent_orgId_phoneE164_key"
ON "SmsConsent"("orgId", "phoneE164");

CREATE INDEX "SmsConsent_orgId_status_idx"
ON "SmsConsent"("orgId", "status");

CREATE INDEX "SmsConsent_leadId_idx"
ON "SmsConsent"("leadId");

CREATE INDEX "SmsConsent_customerId_idx"
ON "SmsConsent"("customerId");

CREATE INDEX "SmsConsent_orgId_updatedAt_idx"
ON "SmsConsent"("orgId", "updatedAt");

ALTER TABLE "SmsConsent"
ADD CONSTRAINT "SmsConsent_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmsConsent"
ADD CONSTRAINT "SmsConsent_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SmsConsent"
ADD CONSTRAINT "SmsConsent_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
