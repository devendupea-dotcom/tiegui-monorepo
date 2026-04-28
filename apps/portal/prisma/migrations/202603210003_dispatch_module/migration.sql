-- CreateEnum
CREATE TYPE "DispatchJobStatus" AS ENUM (
  'SCHEDULED',
  'ON_THE_WAY',
  'ON_SITE',
  'COMPLETED',
  'RESCHEDULED',
  'CANCELED'
);

-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM (
  'JOB_CREATED',
  'CREW_ASSIGNED',
  'CREW_REASSIGNED',
  'STATUS_CHANGED',
  'JOB_UPDATED'
);

-- AlterTable
ALTER TABLE "Job"
ADD COLUMN "customerId" TEXT,
ADD COLUMN "linkedEstimateId" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "serviceType" TEXT,
ADD COLUMN "scheduledDate" TIMESTAMP(3),
ADD COLUMN "scheduledStartTime" TEXT,
ADD COLUMN "scheduledEndTime" TEXT,
ADD COLUMN "dispatchStatus" "DispatchJobStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN "assignedCrewId" TEXT,
ADD COLUMN "crewOrder" INTEGER,
ADD COLUMN "priority" TEXT;

-- Backfill dispatch service naming from the existing project type field.
UPDATE "Job"
SET "serviceType" = COALESCE(NULLIF(TRIM("projectType"), ''), 'Service')
WHERE "serviceType" IS NULL;

-- Preserve existing estimate linkage inside the new dispatch-specific relation.
UPDATE "Job"
SET "linkedEstimateId" = "sourceEstimateId"
WHERE "linkedEstimateId" IS NULL
  AND "sourceEstimateId" IS NOT NULL;

ALTER TABLE "Job"
ALTER COLUMN "serviceType" SET NOT NULL;

-- CreateTable
CREATE TABLE "Crew" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "eventType" "JobEventType" NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "actorUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Crew_orgId_name_key" ON "Crew"("orgId", "name");

-- CreateIndex
CREATE INDEX "Crew_orgId_active_createdAt_idx" ON "Crew"("orgId", "active", "createdAt");

-- CreateIndex
CREATE INDEX "Job_orgId_scheduledDate_dispatchStatus_idx" ON "Job"("orgId", "scheduledDate", "dispatchStatus");

-- CreateIndex
CREATE INDEX "Job_orgId_scheduledDate_assignedCrewId_crewOrder_idx" ON "Job"("orgId", "scheduledDate", "assignedCrewId", "crewOrder");

-- CreateIndex
CREATE INDEX "Job_linkedEstimateId_idx" ON "Job"("linkedEstimateId");

-- CreateIndex
CREATE INDEX "Job_customerId_updatedAt_idx" ON "Job"("customerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Job_assignedCrewId_updatedAt_idx" ON "Job"("assignedCrewId", "updatedAt");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobEvent_orgId_createdAt_idx" ON "JobEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "JobEvent_actorUserId_createdAt_idx" ON "JobEvent"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Job"
ADD CONSTRAINT "Job_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job"
ADD CONSTRAINT "Job_linkedEstimateId_fkey"
FOREIGN KEY ("linkedEstimateId") REFERENCES "Estimate"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job"
ADD CONSTRAINT "Job_assignedCrewId_fkey"
FOREIGN KEY ("assignedCrewId") REFERENCES "Crew"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew"
ADD CONSTRAINT "Crew_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent"
ADD CONSTRAINT "JobEvent_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "Job"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent"
ADD CONSTRAINT "JobEvent_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent"
ADD CONSTRAINT "JobEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
