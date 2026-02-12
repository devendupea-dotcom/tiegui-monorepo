-- Lead intake automation state machine.
CREATE TYPE "LeadIntakeStage" AS ENUM (
  'NONE',
  'INTRO_SENT',
  'WAITING_LOCATION',
  'WAITING_WORK_TYPE',
  'WAITING_CALLBACK',
  'COMPLETED'
);

-- Add organization-level intake automation prompts.
ALTER TABLE "Organization"
  ADD COLUMN "intakeAutomationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "intakeAskLocationBody" TEXT,
  ADD COLUMN "intakeAskWorkTypeBody" TEXT,
  ADD COLUMN "intakeAskCallbackBody" TEXT,
  ADD COLUMN "intakeCompletionBody" TEXT;

-- Add per-lead intake capture fields.
ALTER TABLE "Lead"
  ADD COLUMN "intakeStage" "LeadIntakeStage" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "intakeLocationText" TEXT,
  ADD COLUMN "intakeWorkTypeText" TEXT,
  ADD COLUMN "intakePreferredCallbackAt" TIMESTAMP(3);

CREATE INDEX "Lead_orgId_intakeStage_idx" ON "Lead"("orgId", "intakeStage");
