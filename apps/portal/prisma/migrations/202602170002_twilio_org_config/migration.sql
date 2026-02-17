CREATE TYPE "TwilioConfigStatus" AS ENUM ('PENDING_A2P', 'ACTIVE', 'PAUSED');

CREATE TYPE "TwilioConfigAuditAction" AS ENUM (
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'VALIDATED',
  'TEST_SMS_SENT'
);

CREATE TABLE "OrganizationTwilioConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "twilioSubaccountSid" TEXT NOT NULL,
  "twilioAuthTokenEncrypted" TEXT NOT NULL,
  "messagingServiceSid" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "status" "TwilioConfigStatus" NOT NULL DEFAULT 'PENDING_A2P',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationTwilioConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TwilioConfigAuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "twilioConfigId" TEXT,
  "actorUserId" TEXT,
  "action" "TwilioConfigAuditAction" NOT NULL,
  "previousStatus" "TwilioConfigStatus",
  "nextStatus" "TwilioConfigStatus",
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TwilioConfigAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationTwilioConfig_organizationId_key"
  ON "OrganizationTwilioConfig"("organizationId");

CREATE UNIQUE INDEX "OrganizationTwilioConfig_twilioSubaccountSid_key"
  ON "OrganizationTwilioConfig"("twilioSubaccountSid");

CREATE INDEX "OrganizationTwilioConfig_status_updatedAt_idx"
  ON "OrganizationTwilioConfig"("status", "updatedAt");

CREATE INDEX "TwilioConfigAuditLog_organizationId_createdAt_idx"
  ON "TwilioConfigAuditLog"("organizationId", "createdAt");

CREATE INDEX "TwilioConfigAuditLog_twilioConfigId_createdAt_idx"
  ON "TwilioConfigAuditLog"("twilioConfigId", "createdAt");

CREATE INDEX "TwilioConfigAuditLog_actorUserId_createdAt_idx"
  ON "TwilioConfigAuditLog"("actorUserId", "createdAt");

ALTER TABLE "OrganizationTwilioConfig"
  ADD CONSTRAINT "OrganizationTwilioConfig_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TwilioConfigAuditLog"
  ADD CONSTRAINT "TwilioConfigAuditLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TwilioConfigAuditLog"
  ADD CONSTRAINT "TwilioConfigAuditLog_twilioConfigId_fkey"
  FOREIGN KEY ("twilioConfigId") REFERENCES "OrganizationTwilioConfig"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TwilioConfigAuditLog"
  ADD CONSTRAINT "TwilioConfigAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
