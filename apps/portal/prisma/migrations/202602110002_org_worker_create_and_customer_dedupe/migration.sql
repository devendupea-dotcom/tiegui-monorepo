-- Clarification patch:
-- 1) Worker lead-create toggle lives on Organization
-- 2) Phone dedupe defaults to linking existing customer; duplicates allowed only when forced

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "allowWorkerLeadCreate" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Organization" o
SET "allowWorkerLeadCreate" = c."workerOrganicLeadEntryEnabled"
FROM "OrgDashboardConfig" c
WHERE c."orgId" = o."id";

ALTER TABLE "OrgDashboardConfig"
  DROP COLUMN IF EXISTS "workerOrganicLeadEntryEnabled";

DROP INDEX IF EXISTS "Customer_orgId_phoneE164_key";
CREATE INDEX IF NOT EXISTS "Customer_orgId_phoneE164_idx"
  ON "Customer"("orgId", "phoneE164");
