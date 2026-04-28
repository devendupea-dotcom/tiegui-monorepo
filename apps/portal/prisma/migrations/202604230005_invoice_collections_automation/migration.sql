CREATE TYPE "InvoiceCollectionAttemptSource" AS ENUM ('MANUAL', 'AUTOMATION');
CREATE TYPE "InvoiceCollectionAttemptOutcome" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

ALTER TABLE "Organization"
ADD COLUMN "invoiceCollectionsAutoSendEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "InvoiceCollectionAttempt" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "source" "InvoiceCollectionAttemptSource" NOT NULL DEFAULT 'MANUAL',
  "outcome" "InvoiceCollectionAttemptOutcome" NOT NULL,
  "reason" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceCollectionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceCollectionAttempt_invoiceId_createdAt_idx"
ON "InvoiceCollectionAttempt"("invoiceId", "createdAt");

CREATE INDEX "InvoiceCollectionAttempt_orgId_source_createdAt_idx"
ON "InvoiceCollectionAttempt"("orgId", "source", "createdAt");

CREATE INDEX "InvoiceCollectionAttempt_orgId_outcome_createdAt_idx"
ON "InvoiceCollectionAttempt"("orgId", "outcome", "createdAt");

ALTER TABLE "InvoiceCollectionAttempt"
ADD CONSTRAINT "InvoiceCollectionAttempt_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE,
ADD CONSTRAINT "InvoiceCollectionAttempt_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
ON DELETE CASCADE
ON UPDATE CASCADE,
ADD CONSTRAINT "InvoiceCollectionAttempt_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
