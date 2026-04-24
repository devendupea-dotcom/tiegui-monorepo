ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'STRIPE';

CREATE TYPE "StripeConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'DISCONNECTED');
CREATE TYPE "RecurringBillingInterval" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');
CREATE TYPE "RecurringServicePlanStatus" AS ENUM ('DRAFT', 'PENDING_ACTIVATION', 'ACTIVE', 'PAUSED', 'CANCELED');
CREATE TYPE "RecurringBillingChargeStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED');

CREATE TABLE "OrganizationStripeConnection" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "stripeAccountId" TEXT NOT NULL,
  "stripeAccountEmail" TEXT,
  "stripeDisplayName" TEXT,
  "stripeCountry" TEXT,
  "defaultCurrency" TEXT,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
  "status" "StripeConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationStripeConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringServicePlan" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "interval" "RecurringBillingInterval" NOT NULL,
  "intervalCount" INTEGER NOT NULL DEFAULT 1,
  "status" "RecurringServicePlanStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3),
  "nextBillingAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "stripeProductId" TEXT,
  "stripePriceId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripeCheckoutSessionId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecurringServicePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringBillingCharge" (
  "id" TEXT NOT NULL,
  "recurringServicePlanId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "RecurringBillingChargeStatus" NOT NULL DEFAULT 'PENDING',
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "chargedAt" TIMESTAMP(3),
  "stripeInvoiceId" TEXT,
  "stripePaymentIntentId" TEXT,
  "stripeChargeId" TEXT,
  "receiptUrl" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecurringBillingCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationStripeConnection_orgId_key"
ON "OrganizationStripeConnection"("orgId");

CREATE UNIQUE INDEX "OrganizationStripeConnection_stripeAccountId_key"
ON "OrganizationStripeConnection"("stripeAccountId");

CREATE INDEX "OrganizationStripeConnection_status_updatedAt_idx"
ON "OrganizationStripeConnection"("status", "updatedAt");

CREATE INDEX "RecurringServicePlan_orgId_status_updatedAt_idx"
ON "RecurringServicePlan"("orgId", "status", "updatedAt");

CREATE INDEX "RecurringServicePlan_customerId_status_idx"
ON "RecurringServicePlan"("customerId", "status");

CREATE UNIQUE INDEX "RecurringServicePlan_stripeSubscriptionId_key"
ON "RecurringServicePlan"("stripeSubscriptionId");

CREATE UNIQUE INDEX "RecurringServicePlan_stripeCheckoutSessionId_key"
ON "RecurringServicePlan"("stripeCheckoutSessionId");

CREATE INDEX "RecurringBillingCharge_recurringServicePlanId_createdAt_idx"
ON "RecurringBillingCharge"("recurringServicePlanId", "createdAt");

CREATE INDEX "RecurringBillingCharge_status_chargedAt_idx"
ON "RecurringBillingCharge"("status", "chargedAt");

CREATE UNIQUE INDEX "RecurringBillingCharge_stripeInvoiceId_key"
ON "RecurringBillingCharge"("stripeInvoiceId");

ALTER TABLE "OrganizationStripeConnection"
ADD CONSTRAINT "OrganizationStripeConnection_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "RecurringServicePlan"
ADD CONSTRAINT "RecurringServicePlan_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE,
ADD CONSTRAINT "RecurringServicePlan_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE,
ADD CONSTRAINT "RecurringServicePlan_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "RecurringBillingCharge"
ADD CONSTRAINT "RecurringBillingCharge_recurringServicePlanId_fkey"
FOREIGN KEY ("recurringServicePlanId") REFERENCES "RecurringServicePlan"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
