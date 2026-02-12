DO $$
BEGIN
  CREATE TYPE "MessageLanguage" AS ENUM ('EN', 'ES', 'AUTO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "LeadPreferredLanguage" AS ENUM ('EN', 'ES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "messageLanguage" "MessageLanguage" NOT NULL DEFAULT 'EN';

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "missedCallAutoReplyBodyEn" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "missedCallAutoReplyBodyEs" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeAskLocationBodyEn" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeAskLocationBodyEs" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeAskWorkTypeBodyEn" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeAskWorkTypeBodyEs" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeAskCallbackBodyEn" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeAskCallbackBodyEs" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeCompletionBodyEn" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "intakeCompletionBodyEs" TEXT;

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "preferredLanguage" "LeadPreferredLanguage";
