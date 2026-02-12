-- Google Sync health + observability foundation:
-- - queue metadata (backoff)
-- - per-attempt error snapshots
-- - run history (cron/manual)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'GoogleSyncRunSource'
  ) THEN
    CREATE TYPE "GoogleSyncRunSource" AS ENUM ('CRON', 'MANUAL', 'SYSTEM');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'GoogleSyncRunStatus'
  ) THEN
    CREATE TYPE "GoogleSyncRunStatus" AS ENUM ('RUNNING', 'OK', 'ERROR');
  END IF;
END $$;

ALTER TABLE "GoogleSyncJob"
  ADD COLUMN IF NOT EXISTS "backoffMs" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "GoogleSyncJobAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" "GoogleSyncAction" NOT NULL,
  "status" "GoogleSyncJobStatus" NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "retryable" BOOLEAN,
  "backoffMs" INTEGER,
  "nextRunAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleSyncJobAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoogleSyncJobAttempt_jobId_createdAt_idx"
  ON "GoogleSyncJobAttempt"("jobId", "createdAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncJobAttempt_orgId_createdAt_idx"
  ON "GoogleSyncJobAttempt"("orgId", "createdAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncJobAttempt_status_createdAt_idx"
  ON "GoogleSyncJobAttempt"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncJobAttempt_userId_createdAt_idx"
  ON "GoogleSyncJobAttempt"("userId", "createdAt");

ALTER TABLE "GoogleSyncJobAttempt"
  ADD CONSTRAINT "GoogleSyncJobAttempt_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "GoogleSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleSyncJobAttempt"
  ADD CONSTRAINT "GoogleSyncJobAttempt_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleSyncJobAttempt"
  ADD CONSTRAINT "GoogleSyncJobAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "GoogleSyncRun" (
  "id" TEXT NOT NULL,
  "source" "GoogleSyncRunSource" NOT NULL DEFAULT 'CRON',
  "status" "GoogleSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
  "triggeredByUserId" TEXT,
  "maxJobs" INTEGER,
  "maxAccounts" INTEGER,
  "jobsProcessed" INTEGER NOT NULL DEFAULT 0,
  "jobsCompleted" INTEGER NOT NULL DEFAULT 0,
  "jobsFailed" INTEGER NOT NULL DEFAULT 0,
  "accountsProcessed" INTEGER NOT NULL DEFAULT 0,
  "accountsFailed" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoogleSyncRun_source_startedAt_idx"
  ON "GoogleSyncRun"("source", "startedAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncRun_status_startedAt_idx"
  ON "GoogleSyncRun"("status", "startedAt");

ALTER TABLE "GoogleSyncRun"
  ADD CONSTRAINT "GoogleSyncRun_triggeredByUserId_fkey"
  FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
