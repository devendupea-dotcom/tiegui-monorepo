CREATE TYPE "SmsTone" AS ENUM (
  'FRIENDLY',
  'PROFESSIONAL',
  'DIRECT',
  'SALES',
  'PREMIUM',
  'BILINGUAL',
  'CUSTOM'
);

CREATE TYPE "ConversationStage" AS ENUM (
  'NEW',
  'ASKED_WORK',
  'ASKED_ADDRESS',
  'ASKED_TIMEFRAME',
  'OFFERED_BOOKING',
  'BOOKED',
  'HUMAN_TAKEOVER',
  'CLOSED'
);

CREATE TYPE "ConversationTimeframe" AS ENUM (
  'ASAP',
  'THIS_WEEK',
  'NEXT_WEEK',
  'QUOTE_ONLY'
);

CREATE TYPE "ConversationAuditAction" AS ENUM (
  'AUTO_MESSAGE_SENT',
  'STAGE_CHANGED',
  'FOLLOWUP_SCHEDULED',
  'TAKEOVER_TRIGGERED',
  'OPT_OUT',
  'BOOKED_CREATED'
);

ALTER TABLE "Organization"
  ADD COLUMN "smsTone" "SmsTone" NOT NULL DEFAULT 'FRIENDLY',
  ADD COLUMN "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "followUpsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "smsGreetingLine" TEXT,
  ADD COLUMN "smsWorkingHoursText" TEXT,
  ADD COLUMN "smsWebsiteSignature" TEXT;

CREATE TABLE "LeadConversationState" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "stage" "ConversationStage" NOT NULL DEFAULT 'NEW',
  "workSummary" TEXT,
  "addressText" TEXT,
  "addressCity" TEXT,
  "timeframe" "ConversationTimeframe",
  "lastInboundAt" TIMESTAMP(3),
  "lastOutboundAt" TIMESTAMP(3),
  "nextFollowUpAt" TIMESTAMP(3),
  "pausedUntil" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "bookingOptions" JSONB,
  "bookedStartAt" TIMESTAMP(3),
  "bookedEndAt" TIMESTAMP(3),
  "bookedCalendarEventId" TEXT,
  "followUpStep" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LeadConversationState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadConversationAuditEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "conversationStateId" TEXT,
  "action" "ConversationAuditAction" NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LeadConversationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadConversationState_leadId_key"
  ON "LeadConversationState"("leadId");

CREATE INDEX "LeadConversationState_orgId_stage_updatedAt_idx"
  ON "LeadConversationState"("orgId", "stage", "updatedAt");

CREATE INDEX "LeadConversationState_orgId_nextFollowUpAt_idx"
  ON "LeadConversationState"("orgId", "nextFollowUpAt");

CREATE INDEX "LeadConversationState_orgId_pausedUntil_idx"
  ON "LeadConversationState"("orgId", "pausedUntil");

CREATE INDEX "LeadConversationState_orgId_stoppedAt_idx"
  ON "LeadConversationState"("orgId", "stoppedAt");

CREATE INDEX "LeadConversationAuditEvent_orgId_createdAt_idx"
  ON "LeadConversationAuditEvent"("orgId", "createdAt");

CREATE INDEX "LeadConversationAuditEvent_leadId_createdAt_idx"
  ON "LeadConversationAuditEvent"("leadId", "createdAt");

CREATE INDEX "LeadConversationAuditEvent_conversationStateId_createdAt_idx"
  ON "LeadConversationAuditEvent"("conversationStateId", "createdAt");

ALTER TABLE "LeadConversationState"
  ADD CONSTRAINT "LeadConversationState_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadConversationState"
  ADD CONSTRAINT "LeadConversationState_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadConversationAuditEvent"
  ADD CONSTRAINT "LeadConversationAuditEvent_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadConversationAuditEvent"
  ADD CONSTRAINT "LeadConversationAuditEvent_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadConversationAuditEvent"
  ADD CONSTRAINT "LeadConversationAuditEvent_conversationStateId_fkey"
  FOREIGN KEY ("conversationStateId") REFERENCES "LeadConversationState"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
