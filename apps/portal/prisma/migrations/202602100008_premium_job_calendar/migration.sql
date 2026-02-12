-- Premium Job Calendar foundation:
-- - richer Event fields and types
-- - worker assignments, working hours, time off, and holds
-- - org-level calendar overlap/timezone settings

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CalendarEventStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "CalendarEventStatus" AS ENUM (
      'SCHEDULED',
      'CONFIRMED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CalendarAccessRole'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "CalendarAccessRole" AS ENUM ('OWNER', 'ADMIN', 'WORKER', 'READ_ONLY');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CalendarHoldStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "CalendarHoldStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED');
  END IF;
END $$;

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'JOB';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ESTIMATE';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'CALL';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'BLOCK';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'TRAVEL';

ALTER TABLE "User"
  ADD COLUMN "calendarAccessRole" "CalendarAccessRole" NOT NULL DEFAULT 'WORKER';

ALTER TABLE "OrgDashboardConfig"
  ADD COLUMN "allowOverlaps" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "weekStartsOn" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "defaultSlotMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "defaultUntimedStartHour" INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN "calendarTimezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles';

ALTER TABLE "Event"
  ADD COLUMN "status" "CalendarEventStatus" NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "busy" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "addressLine" TEXT,
  ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Event_orgId_type_startAt_idx"
  ON "Event"("orgId", "type", "startAt");

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkingHours" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "workerUserId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "isWorking" BOOLEAN NOT NULL DEFAULT true,
  "timezone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkingHours_workerUserId_dayOfWeek_key"
  ON "WorkingHours"("workerUserId", "dayOfWeek");

CREATE INDEX "WorkingHours_orgId_workerUserId_dayOfWeek_idx"
  ON "WorkingHours"("orgId", "workerUserId", "dayOfWeek");

ALTER TABLE "WorkingHours"
  ADD CONSTRAINT "WorkingHours_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkingHours"
  ADD CONSTRAINT "WorkingHours_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TimeOff" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "workerUserId" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeOff_orgId_workerUserId_startAt_endAt_idx"
  ON "TimeOff"("orgId", "workerUserId", "startAt", "endAt");

ALTER TABLE "TimeOff"
  ADD CONSTRAINT "TimeOff_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeOff"
  ADD CONSTRAINT "TimeOff_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CalendarHold" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "workerUserId" TEXT NOT NULL,
  "leadId" TEXT,
  "customerName" TEXT,
  "title" TEXT,
  "addressLine" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "status" "CalendarHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CalendarHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalendarHold_orgId_workerUserId_startAt_endAt_idx"
  ON "CalendarHold"("orgId", "workerUserId", "startAt", "endAt");

CREATE INDEX "CalendarHold_orgId_status_expiresAt_idx"
  ON "CalendarHold"("orgId", "status", "expiresAt");

ALTER TABLE "CalendarHold"
  ADD CONSTRAINT "CalendarHold_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarHold"
  ADD CONSTRAINT "CalendarHold_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarHold"
  ADD CONSTRAINT "CalendarHold_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CalendarHold"
  ADD CONSTRAINT "CalendarHold_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CalendarEventWorker" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "workerUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CalendarEventWorker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarEventWorker_eventId_workerUserId_key"
  ON "CalendarEventWorker"("eventId", "workerUserId");

CREATE INDEX "CalendarEventWorker_orgId_workerUserId_createdAt_idx"
  ON "CalendarEventWorker"("orgId", "workerUserId", "createdAt");

ALTER TABLE "CalendarEventWorker"
  ADD CONSTRAINT "CalendarEventWorker_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventWorker"
  ADD CONSTRAINT "CalendarEventWorker_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventWorker"
  ADD CONSTRAINT "CalendarEventWorker_workerUserId_fkey"
  FOREIGN KEY ("workerUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
