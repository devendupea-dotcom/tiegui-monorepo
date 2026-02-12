-- Google Calendar per-user opt-in sync foundation:
-- - provider metadata on Event
-- - source metadata on CalendarHold
-- - GoogleAccount, GoogleOAuthState, GoogleSyncJob tables

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'EventProvider'
  ) THEN
    CREATE TYPE "EventProvider" AS ENUM ('LOCAL', 'GOOGLE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'EventSyncStatus'
  ) THEN
    CREATE TYPE "EventSyncStatus" AS ENUM ('PENDING', 'OK', 'ERROR');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'CalendarHoldSource'
  ) THEN
    CREATE TYPE "CalendarHoldSource" AS ENUM ('MANUAL', 'SMS_AGENT', 'GOOGLE_SYNC');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'GoogleAccountSyncStatus'
  ) THEN
    CREATE TYPE "GoogleAccountSyncStatus" AS ENUM ('IDLE', 'RUNNING', 'OK', 'ERROR', 'DISCONNECTED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'GoogleSyncAction'
  ) THEN
    CREATE TYPE "GoogleSyncAction" AS ENUM ('UPSERT_EVENT', 'DELETE_EVENT', 'PULL_CALENDARS');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'GoogleSyncJobStatus'
  ) THEN
    CREATE TYPE "GoogleSyncJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'ERROR');
  END IF;
END $$;

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'GCAL_BLOCK';

ALTER TABLE "Event"
  ADD COLUMN "provider" "EventProvider" NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "googleEventId" TEXT,
  ADD COLUMN "googleCalendarId" TEXT,
  ADD COLUMN "syncStatus" "EventSyncStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

ALTER TABLE "CalendarHold"
  ADD COLUMN "source" "CalendarHoldSource" NOT NULL DEFAULT 'MANUAL';

CREATE INDEX "Event_orgId_provider_startAt_idx"
  ON "Event"("orgId", "provider", "startAt");

CREATE INDEX "Event_assignedToUserId_provider_startAt_idx"
  ON "Event"("assignedToUserId", "provider", "startAt");

CREATE UNIQUE INDEX "Event_orgId_googleCalendarId_googleEventId_key"
  ON "Event"("orgId", "googleCalendarId", "googleEventId");

CREATE TABLE "GoogleAccount" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "googleEmail" TEXT,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "expiresAt" TIMESTAMP(3),
  "scopes" TEXT[] NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "writeCalendarId" TEXT,
  "readCalendarIdsJson" JSONB,
  "blockAvailabilityRulesJson" JSONB,
  "lastSyncAt" TIMESTAMP(3),
  "syncStatus" "GoogleAccountSyncStatus" NOT NULL DEFAULT 'IDLE',
  "syncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAccount_orgId_userId_key"
  ON "GoogleAccount"("orgId", "userId");

CREATE INDEX "GoogleAccount_orgId_isEnabled_idx"
  ON "GoogleAccount"("orgId", "isEnabled");

CREATE INDEX "GoogleAccount_userId_isEnabled_idx"
  ON "GoogleAccount"("userId", "isEnabled");

CREATE INDEX "GoogleAccount_expiresAt_idx"
  ON "GoogleAccount"("expiresAt");

ALTER TABLE "GoogleAccount"
  ADD CONSTRAINT "GoogleAccount_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleAccount"
  ADD CONSTRAINT "GoogleAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GoogleOAuthState" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "wantsWrite" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleOAuthState_state_key"
  ON "GoogleOAuthState"("state");

CREATE INDEX "GoogleOAuthState_orgId_userId_expiresAt_idx"
  ON "GoogleOAuthState"("orgId", "userId", "expiresAt");

ALTER TABLE "GoogleOAuthState"
  ADD CONSTRAINT "GoogleOAuthState_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleOAuthState"
  ADD CONSTRAINT "GoogleOAuthState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GoogleSyncJob" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT,
  "action" "GoogleSyncAction" NOT NULL,
  "status" "GoogleSyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "payloadJson" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoogleSyncJob_status_runAfter_idx"
  ON "GoogleSyncJob"("status", "runAfter");

CREATE INDEX "GoogleSyncJob_orgId_userId_status_idx"
  ON "GoogleSyncJob"("orgId", "userId", "status");

CREATE INDEX "GoogleSyncJob_eventId_status_idx"
  ON "GoogleSyncJob"("eventId", "status");

ALTER TABLE "GoogleSyncJob"
  ADD CONSTRAINT "GoogleSyncJob_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleSyncJob"
  ADD CONSTRAINT "GoogleSyncJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleSyncJob"
  ADD CONSTRAINT "GoogleSyncJob_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
