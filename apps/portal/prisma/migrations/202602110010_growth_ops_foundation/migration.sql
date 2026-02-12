ALTER TABLE "Organization"
  ADD COLUMN "ghostBustingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voiceNotesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "metaCapiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "offlineModeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ghostBustingQuietHoursStart" INTEGER NOT NULL DEFAULT 1260,
  ADD COLUMN "ghostBustingQuietHoursEnd" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN "ghostBustingMaxNudges" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "ghostBustingTemplateText" TEXT;

ALTER TABLE "Lead"
  ADD COLUMN "lastInboundAt" TIMESTAMP(3),
  ADD COLUMN "lastOutboundAt" TIMESTAMP(3),
  ADD COLUMN "ghostNudgeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastGhostNudgeAt" TIMESTAMP(3),
  ADD COLUMN "fbClickId" TEXT,
  ADD COLUMN "fbBrowserId" TEXT;

CREATE INDEX "Lead_orgId_lastInboundAt_idx"
  ON "Lead"("orgId", "lastInboundAt");

CREATE INDEX "Lead_orgId_lastOutboundAt_idx"
  ON "Lead"("orgId", "lastOutboundAt");

CREATE INDEX "Lead_orgId_ghostNudgeCount_lastGhostNudgeAt_idx"
  ON "Lead"("orgId", "ghostNudgeCount", "lastGhostNudgeAt");

CREATE TYPE "MessageType" AS ENUM ('MANUAL', 'SYSTEM_NUDGE', 'AUTOMATION');

ALTER TABLE "Message"
  ADD COLUMN "type" "MessageType" NOT NULL DEFAULT 'MANUAL';

CREATE INDEX "Message_leadId_type_createdAt_idx"
  ON "Message"("leadId", "type", "createdAt");

CREATE TYPE "MetaCapiStatus" AS ENUM ('PENDING', 'SENT', 'ERROR');

CREATE TABLE "MetaCapiEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "leadId" TEXT,
  "invoiceId" TEXT,
  "eventName" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" "MetaCapiStatus" NOT NULL DEFAULT 'PENDING',
  "payloadJson" JSONB,
  "responseJson" JSONB,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaCapiEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaCapiEvent_orgId_eventId_key"
  ON "MetaCapiEvent"("orgId", "eventId");

CREATE INDEX "MetaCapiEvent_orgId_status_createdAt_idx"
  ON "MetaCapiEvent"("orgId", "status", "createdAt");

CREATE INDEX "MetaCapiEvent_invoiceId_createdAt_idx"
  ON "MetaCapiEvent"("invoiceId", "createdAt");

CREATE INDEX "MetaCapiEvent_leadId_createdAt_idx"
  ON "MetaCapiEvent"("leadId", "createdAt");

ALTER TABLE "MetaCapiEvent"
  ADD CONSTRAINT "MetaCapiEvent_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MetaCapiEvent"
  ADD CONSTRAINT "MetaCapiEvent_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MetaCapiEvent"
  ADD CONSTRAINT "MetaCapiEvent_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "CronLogStatus" AS ENUM ('OK', 'ERROR');

CREATE TABLE "InternalCronRunLog" (
  "id" TEXT NOT NULL,
  "orgId" TEXT,
  "route" TEXT NOT NULL,
  "status" "CronLogStatus" NOT NULL DEFAULT 'OK',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "metricsJson" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalCronRunLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalCronRunLog_route_createdAt_idx"
  ON "InternalCronRunLog"("route", "createdAt");

CREATE INDEX "InternalCronRunLog_status_createdAt_idx"
  ON "InternalCronRunLog"("status", "createdAt");

CREATE INDEX "InternalCronRunLog_orgId_createdAt_idx"
  ON "InternalCronRunLog"("orgId", "createdAt");

ALTER TABLE "InternalCronRunLog"
  ADD CONSTRAINT "InternalCronRunLog_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ClientMutationReceipt" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "responseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientMutationReceipt_orgId_idempotencyKey_key"
  ON "ClientMutationReceipt"("orgId", "idempotencyKey");

CREATE INDEX "ClientMutationReceipt_route_createdAt_idx"
  ON "ClientMutationReceipt"("route", "createdAt");

ALTER TABLE "ClientMutationReceipt"
  ADD CONSTRAINT "ClientMutationReceipt_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
