ALTER TABLE "OrganizationMessagingSettings"
  ADD COLUMN "ownerEmailAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ownerSmsAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ownerAlertEmail" TEXT,
  ADD COLUMN "ownerAlertPhoneE164" TEXT;
