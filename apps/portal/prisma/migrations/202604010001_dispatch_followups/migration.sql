ALTER TABLE "OrganizationMessagingSettings"
ADD COLUMN "dispatchSmsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dispatchSmsScheduled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "dispatchSmsOnTheWay" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "dispatchSmsRescheduled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "dispatchSmsCompleted" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Job"
ADD COLUMN "leadId" TEXT;

UPDATE "Job" AS job
SET "leadId" = linked."leadId"
FROM "Estimate" AS linked
WHERE linked."id" = job."linkedEstimateId"
  AND job."leadId" IS NULL
  AND linked."leadId" IS NOT NULL;

UPDATE "Job" AS job
SET "leadId" = source."leadId"
FROM "Estimate" AS source
WHERE job."leadId" IS NULL
  AND source."id" = job."sourceEstimateId"
  AND source."leadId" IS NOT NULL;

CREATE INDEX "Job_leadId_updatedAt_idx" ON "Job"("leadId", "updatedAt");

ALTER TABLE "Job"
ADD CONSTRAINT "Job_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
