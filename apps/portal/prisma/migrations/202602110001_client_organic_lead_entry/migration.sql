-- Client organic lead entry foundation:
-- - Customer table
-- - Lead organic source + attribution lock fields
-- - Event customer linkage
-- - Worker organic lead toggle in org settings
-- - Calendar statuses for field execution

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'LeadSourceType'
  ) THEN
    CREATE TYPE "LeadSourceType" AS ENUM ('PAID', 'ORGANIC', 'REFERRAL', 'WALKIN', 'REPEAT', 'UNKNOWN');
  END IF;
END $$;

ALTER TYPE "CalendarEventStatus" ADD VALUE IF NOT EXISTS 'EN_ROUTE';
ALTER TYPE "CalendarEventStatus" ADD VALUE IF NOT EXISTS 'ON_SITE';

CREATE TABLE IF NOT EXISTS "Customer" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "email" TEXT,
  "addressLine" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceType" "LeadSourceType" NOT NULL DEFAULT 'ORGANIC',
  ADD COLUMN IF NOT EXISTS "sourceDetail" TEXT,
  ADD COLUMN IF NOT EXISTS "attributionLocked" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "commissionEligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT;

ALTER TABLE "OrgDashboardConfig"
  ADD COLUMN IF NOT EXISTS "workerOrganicLeadEntryEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_orgId_phoneE164_key"
  ON "Customer"("orgId", "phoneE164");

CREATE INDEX IF NOT EXISTS "Customer_orgId_name_idx"
  ON "Customer"("orgId", "name");

CREATE INDEX IF NOT EXISTS "Customer_orgId_createdAt_idx"
  ON "Customer"("orgId", "createdAt");

CREATE INDEX IF NOT EXISTS "Lead_customerId_updatedAt_idx"
  ON "Lead"("customerId", "updatedAt");

CREATE INDEX IF NOT EXISTS "Lead_createdByUserId_createdAt_idx"
  ON "Lead"("createdByUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "Lead_orgId_sourceType_createdAt_idx"
  ON "Lead"("orgId", "sourceType", "createdAt");

CREATE INDEX IF NOT EXISTS "Event_customerId_startAt_idx"
  ON "Event"("customerId", "startAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_orgId_fkey') THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_createdByUserId_fkey') THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_customerId_fkey') THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_createdByUserId_fkey') THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Event_customerId_fkey') THEN
    ALTER TABLE "Event"
      ADD CONSTRAINT "Event_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
