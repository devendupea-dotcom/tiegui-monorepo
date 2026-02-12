-- Integrations + data portability foundation for Jobber/QBO.

CREATE TYPE "IntegrationProvider" AS ENUM ('JOBBER', 'QBO');
CREATE TYPE "IntegrationAccountStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "ImportRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "IntegrationAccount" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "expiresAt" TIMESTAMP(3),
  "providerAccountId" TEXT,
  "realmId" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "IntegrationAccountStatus" NOT NULL DEFAULT 'CONNECTED',
  "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastSyncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationAccount_orgId_provider_key"
  ON "IntegrationAccount"("orgId", "provider");

CREATE INDEX "IntegrationAccount_orgId_status_idx"
  ON "IntegrationAccount"("orgId", "status");

CREATE INDEX "IntegrationAccount_provider_expiresAt_idx"
  ON "IntegrationAccount"("provider", "expiresAt");

ALTER TABLE "IntegrationAccount"
  ADD CONSTRAINT "IntegrationAccount_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationOAuthState" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "state" TEXT NOT NULL,
  "codeVerifier" TEXT,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IntegrationOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationOAuthState_state_key"
  ON "IntegrationOAuthState"("state");

CREATE INDEX "IntegrationOAuthState_orgId_provider_expiresAt_idx"
  ON "IntegrationOAuthState"("orgId", "provider", "expiresAt");

ALTER TABLE "IntegrationOAuthState"
  ADD CONSTRAINT "IntegrationOAuthState_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ImportRun" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" "ImportRunStatus" NOT NULL DEFAULT 'RUNNING',
  "statsJson" JSONB,
  "errorJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportRun_orgId_provider_startedAt_idx"
  ON "ImportRun"("orgId", "provider", "startedAt");

CREATE INDEX "ImportRun_orgId_status_createdAt_idx"
  ON "ImportRun"("orgId", "status", "createdAt");

ALTER TABLE "ImportRun"
  ADD CONSTRAINT "ImportRun_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PortableCustomer" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
  "createdAtSource" TIMESTAMP(3),
  "updatedAtSource" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PortableCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortableCustomer_orgId_provider_externalId_key"
  ON "PortableCustomer"("orgId", "provider", "externalId");

CREATE INDEX "PortableCustomer_orgId_provider_displayName_idx"
  ON "PortableCustomer"("orgId", "provider", "displayName");

ALTER TABLE "PortableCustomer"
  ADD CONSTRAINT "PortableCustomer_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PortableJob" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerExternalId" TEXT,
  "title" TEXT NOT NULL,
  "status" TEXT,
  "description" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdAtSource" TIMESTAMP(3),
  "updatedAtSource" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PortableJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortableJob_orgId_provider_externalId_key"
  ON "PortableJob"("orgId", "provider", "externalId");

CREATE INDEX "PortableJob_orgId_provider_status_idx"
  ON "PortableJob"("orgId", "provider", "status");

CREATE INDEX "PortableJob_customerId_idx"
  ON "PortableJob"("customerId");

ALTER TABLE "PortableJob"
  ADD CONSTRAINT "PortableJob_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortableJob"
  ADD CONSTRAINT "PortableJob_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "PortableCustomer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PortableInvoice" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerExternalId" TEXT,
  "jobId" TEXT,
  "jobExternalId" TEXT,
  "invoiceNumber" TEXT,
  "status" TEXT,
  "issuedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "currency" TEXT,
  "subtotalCents" INTEGER,
  "taxCents" INTEGER,
  "totalCents" INTEGER,
  "balanceCents" INTEGER,
  "createdAtSource" TIMESTAMP(3),
  "updatedAtSource" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PortableInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortableInvoice_orgId_provider_externalId_key"
  ON "PortableInvoice"("orgId", "provider", "externalId");

CREATE INDEX "PortableInvoice_orgId_provider_status_idx"
  ON "PortableInvoice"("orgId", "provider", "status");

CREATE INDEX "PortableInvoice_customerId_idx"
  ON "PortableInvoice"("customerId");

CREATE INDEX "PortableInvoice_jobId_idx"
  ON "PortableInvoice"("jobId");

ALTER TABLE "PortableInvoice"
  ADD CONSTRAINT "PortableInvoice_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortableInvoice"
  ADD CONSTRAINT "PortableInvoice_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "PortableCustomer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortableInvoice"
  ADD CONSTRAINT "PortableInvoice_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "PortableJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PortableInvoiceLineItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "invoiceExternalId" TEXT NOT NULL,
  "description" TEXT,
  "quantityDecimal" TEXT,
  "unitPriceCents" INTEGER,
  "amountCents" INTEGER,
  "position" INTEGER,
  "createdAtSource" TIMESTAMP(3),
  "updatedAtSource" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PortableInvoiceLineItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortableInvoiceLineItem_orgId_provider_externalId_key"
  ON "PortableInvoiceLineItem"("orgId", "provider", "externalId");

CREATE INDEX "PortableInvoiceLineItem_orgId_provider_invoiceExternalId_idx"
  ON "PortableInvoiceLineItem"("orgId", "provider", "invoiceExternalId");

CREATE INDEX "PortableInvoiceLineItem_invoiceId_position_idx"
  ON "PortableInvoiceLineItem"("invoiceId", "position");

ALTER TABLE "PortableInvoiceLineItem"
  ADD CONSTRAINT "PortableInvoiceLineItem_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortableInvoiceLineItem"
  ADD CONSTRAINT "PortableInvoiceLineItem_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "PortableInvoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PortablePayment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerExternalId" TEXT,
  "invoiceId" TEXT,
  "invoiceExternalId" TEXT,
  "amountCents" INTEGER,
  "currency" TEXT,
  "paidAt" TIMESTAMP(3),
  "status" TEXT,
  "method" TEXT,
  "reference" TEXT,
  "createdAtSource" TIMESTAMP(3),
  "updatedAtSource" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PortablePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortablePayment_orgId_provider_externalId_key"
  ON "PortablePayment"("orgId", "provider", "externalId");

CREATE INDEX "PortablePayment_orgId_provider_paidAt_idx"
  ON "PortablePayment"("orgId", "provider", "paidAt");

CREATE INDEX "PortablePayment_customerId_idx"
  ON "PortablePayment"("customerId");

CREATE INDEX "PortablePayment_invoiceId_idx"
  ON "PortablePayment"("invoiceId");

ALTER TABLE "PortablePayment"
  ADD CONSTRAINT "PortablePayment_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortablePayment"
  ADD CONSTRAINT "PortablePayment_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "PortableCustomer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortablePayment"
  ADD CONSTRAINT "PortablePayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "PortableInvoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PortableNote" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerExternalId" TEXT,
  "jobId" TEXT,
  "jobExternalId" TEXT,
  "invoiceId" TEXT,
  "invoiceExternalId" TEXT,
  "body" TEXT NOT NULL,
  "authoredBy" TEXT,
  "notedAt" TIMESTAMP(3),
  "createdAtSource" TIMESTAMP(3),
  "updatedAtSource" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PortableNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortableNote_orgId_provider_externalId_key"
  ON "PortableNote"("orgId", "provider", "externalId");

CREATE INDEX "PortableNote_orgId_provider_notedAt_idx"
  ON "PortableNote"("orgId", "provider", "notedAt");

CREATE INDEX "PortableNote_customerId_idx"
  ON "PortableNote"("customerId");

CREATE INDEX "PortableNote_jobId_idx"
  ON "PortableNote"("jobId");

CREATE INDEX "PortableNote_invoiceId_idx"
  ON "PortableNote"("invoiceId");

ALTER TABLE "PortableNote"
  ADD CONSTRAINT "PortableNote_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortableNote"
  ADD CONSTRAINT "PortableNote_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "PortableCustomer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortableNote"
  ADD CONSTRAINT "PortableNote_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "PortableJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortableNote"
  ADD CONSTRAINT "PortableNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "PortableInvoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
