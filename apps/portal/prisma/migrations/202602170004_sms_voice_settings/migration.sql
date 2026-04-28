CREATE TABLE "OrganizationMessagingSettings" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "smsTone" "SmsTone" NOT NULL DEFAULT 'FRIENDLY',
  "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "followUpsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "autoBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "workingHoursStart" TEXT NOT NULL DEFAULT '09:00',
  "workingHoursEnd" TEXT NOT NULL DEFAULT '17:00',
  "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
  "daysAhead" INTEGER NOT NULL DEFAULT 3,
  "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  "customTemplates" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationMessagingSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMessagingSettings_orgId_key"
  ON "OrganizationMessagingSettings"("orgId");

CREATE INDEX "OrganizationMessagingSettings_orgId_smsTone_idx"
  ON "OrganizationMessagingSettings"("orgId", "smsTone");

ALTER TABLE "OrganizationMessagingSettings"
  ADD CONSTRAINT "OrganizationMessagingSettings_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
