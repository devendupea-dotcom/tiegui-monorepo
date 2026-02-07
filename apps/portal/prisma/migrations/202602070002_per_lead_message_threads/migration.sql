-- CreateEnum
CREATE TYPE "MessageProvider" AS ENUM ('TWILIO');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- Remove orphaned messages before enforcing required lead threads.
DELETE FROM "Message" WHERE "leadId" IS NULL;

-- Add columns for provider metadata.
ALTER TABLE "Message"
  ADD COLUMN "provider" "MessageProvider" NOT NULL DEFAULT 'TWILIO',
  ADD COLUMN "providerMessageSid" TEXT,
  ADD COLUMN "status" "MessageStatus";

-- Backfill providerMessageSid from previous Twilio-specific column.
UPDATE "Message"
SET "providerMessageSid" = "twilioMessageSid"
WHERE "twilioMessageSid" IS NOT NULL;

-- Enforce lead-thread requirement.
ALTER TABLE "Message"
  ALTER COLUMN "leadId" SET NOT NULL;

-- Replace old sid index/column with provider-agnostic version.
DROP INDEX IF EXISTS "Message_twilioMessageSid_key";
ALTER TABLE "Message" DROP COLUMN "twilioMessageSid";
CREATE UNIQUE INDEX "Message_providerMessageSid_key" ON "Message"("providerMessageSid");
