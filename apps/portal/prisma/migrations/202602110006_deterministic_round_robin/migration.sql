-- Persist deterministic round-robin assignment state per organization.
ALTER TABLE "OrgDashboardConfig"
  ADD COLUMN IF NOT EXISTS "roundRobinLastWorkerId" TEXT;

CREATE INDEX IF NOT EXISTS "OrgDashboardConfig_roundRobinLastWorkerId_idx"
  ON "OrgDashboardConfig"("roundRobinLastWorkerId");
