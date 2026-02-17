-- Twilio quiet-hours support + queued SMS dispatch jobs

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "smsQuietHoursStartMinute" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS "smsQuietHoursEndMinute" INTEGER NOT NULL DEFAULT 1200;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SmsDispatchKind') THEN
    CREATE TYPE "SmsDispatchKind" AS ENUM ('MISSED_CALL_INTRO', 'AUTOMATION_GENERIC');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SmsDispatchQueue" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "kind" "SmsDispatchKind" NOT NULL DEFAULT 'AUTOMATION_GENERIC',
  "messageType" "MessageType" NOT NULL DEFAULT 'AUTOMATION',
  "fromNumberE164" TEXT NOT NULL,
  "toNumberE164" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sendAfterAt" TIMESTAMP(3) NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsDispatchQueue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SmsDispatchQueue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SmsDispatchQueue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SmsDispatchQueue_orgId_status_sendAfterAt_idx"
  ON "SmsDispatchQueue"("orgId", "status", "sendAfterAt");

CREATE INDEX IF NOT EXISTS "SmsDispatchQueue_leadId_createdAt_idx"
  ON "SmsDispatchQueue"("leadId", "createdAt");

CREATE INDEX IF NOT EXISTS "SmsDispatchQueue_status_sendAfterAt_idx"
  ON "SmsDispatchQueue"("status", "sendAfterAt");
