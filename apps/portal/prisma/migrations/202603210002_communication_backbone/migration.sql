DO $$
BEGIN
  CREATE TYPE "CommunicationChannel" AS ENUM ('VOICE', 'SMS', 'FORM', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CommunicationEventType" AS ENUM (
    'INBOUND_CALL_RECEIVED',
    'FORWARDED_TO_OWNER',
    'OWNER_ANSWERED',
    'NO_ANSWER',
    'BUSY',
    'FAILED',
    'CANCELED',
    'COMPLETED',
    'VOICEMAIL_REACHED',
    'VOICEMAIL_LEFT',
    'ABANDONED',
    'MISSED_CALL_TEXT_QUEUED',
    'MISSED_CALL_TEXT_SENT',
    'MISSED_CALL_TEXT_SKIPPED',
    'INBOUND_SMS_RECEIVED',
    'OUTBOUND_SMS_SENT',
    'FORM_SUBMITTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VoicemailTranscriptionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CommunicationEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT,
  "contactId" TEXT,
  "conversationId" TEXT,
  "callId" TEXT,
  "messageId" TEXT,
  "actorUserId" TEXT,
  "type" "CommunicationEventType" NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "summary" TEXT NOT NULL,
  "metadataJson" JSONB,
  "provider" TEXT,
  "providerCallSid" TEXT,
  "providerParentCallSid" TEXT,
  "providerMessageSid" TEXT,
  "providerStatus" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunicationEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunicationEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommunicationEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommunicationEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LeadConversationState"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommunicationEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommunicationEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommunicationEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "VoicemailArtifact" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT,
  "contactId" TEXT,
  "conversationId" TEXT,
  "callId" TEXT,
  "communicationEventId" TEXT NOT NULL,
  "providerCallSid" TEXT,
  "recordingSid" TEXT,
  "recordingUrl" TEXT,
  "recordingDurationSeconds" INTEGER,
  "transcriptionStatus" "VoicemailTranscriptionStatus",
  "transcriptionText" TEXT,
  "voicemailAt" TIMESTAMP(3) NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoicemailArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoicemailArtifact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VoicemailArtifact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VoicemailArtifact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VoicemailArtifact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LeadConversationState"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VoicemailArtifact_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VoicemailArtifact_communicationEventId_fkey" FOREIGN KEY ("communicationEventId") REFERENCES "CommunicationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationEvent_orgId_idempotencyKey_key" ON "CommunicationEvent"("orgId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_orgId_occurredAt_idx" ON "CommunicationEvent"("orgId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_leadId_occurredAt_idx" ON "CommunicationEvent"("leadId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_contactId_occurredAt_idx" ON "CommunicationEvent"("contactId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_conversationId_occurredAt_idx" ON "CommunicationEvent"("conversationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_callId_occurredAt_idx" ON "CommunicationEvent"("callId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_messageId_occurredAt_idx" ON "CommunicationEvent"("messageId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_providerCallSid_occurredAt_idx" ON "CommunicationEvent"("providerCallSid", "occurredAt");
CREATE INDEX IF NOT EXISTS "CommunicationEvent_providerMessageSid_occurredAt_idx" ON "CommunicationEvent"("providerMessageSid", "occurredAt");

CREATE UNIQUE INDEX IF NOT EXISTS "VoicemailArtifact_communicationEventId_key" ON "VoicemailArtifact"("communicationEventId");
CREATE UNIQUE INDEX IF NOT EXISTS "VoicemailArtifact_recordingSid_key" ON "VoicemailArtifact"("recordingSid");
CREATE INDEX IF NOT EXISTS "VoicemailArtifact_orgId_voicemailAt_idx" ON "VoicemailArtifact"("orgId", "voicemailAt");
CREATE INDEX IF NOT EXISTS "VoicemailArtifact_leadId_voicemailAt_idx" ON "VoicemailArtifact"("leadId", "voicemailAt");
CREATE INDEX IF NOT EXISTS "VoicemailArtifact_contactId_voicemailAt_idx" ON "VoicemailArtifact"("contactId", "voicemailAt");
CREATE INDEX IF NOT EXISTS "VoicemailArtifact_conversationId_voicemailAt_idx" ON "VoicemailArtifact"("conversationId", "voicemailAt");
CREATE INDEX IF NOT EXISTS "VoicemailArtifact_callId_voicemailAt_idx" ON "VoicemailArtifact"("callId", "voicemailAt");
CREATE INDEX IF NOT EXISTS "VoicemailArtifact_providerCallSid_voicemailAt_idx" ON "VoicemailArtifact"("providerCallSid", "voicemailAt");
