-- Make worker schedule uniqueness organization-scoped.
DROP INDEX IF EXISTS "WorkingHours_workerUserId_dayOfWeek_key";

CREATE UNIQUE INDEX "WorkingHours_orgId_workerUserId_dayOfWeek_key"
  ON "WorkingHours"("orgId", "workerUserId", "dayOfWeek");
