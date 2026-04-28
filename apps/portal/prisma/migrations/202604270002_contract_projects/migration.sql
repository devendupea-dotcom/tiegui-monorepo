CREATE TYPE "ContractProjectStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'DEPOSIT_PAID', 'ACTIVE', 'COMPLETE');

CREATE TYPE "ChangeOrderStatus" AS ENUM ('NONE', 'DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'COMPLETED');

CREATE TYPE "PaymentMilestoneStatus" AS ENUM ('NOT_STARTED', 'DEPOSIT_PENDING', 'DEPOSIT_PAID', 'PROGRESS_PAYMENT_DUE', 'PAID_IN_FULL');

CREATE TABLE "ContractProject" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "buyerProjectId" TEXT NOT NULL,
  "customerId" TEXT,
  "leadId" TEXT,
  "createdByUserId" TEXT,
  "contractStatus" "ContractProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "changeOrderStatus" "ChangeOrderStatus" NOT NULL DEFAULT 'NONE',
  "paymentStatus" "PaymentMilestoneStatus" NOT NULL DEFAULT 'DEPOSIT_PENDING',
  "contractDocumentUrl" TEXT,
  "contractDocumentLabel" TEXT,
  "depositDueCents" INTEGER,
  "depositPaidAt" TIMESTAMP(3),
  "contractSignedAt" TIMESTAMP(3),
  "activeStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "contractNotes" TEXT,
  "internalNextStep" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractProject_buyerProjectId_key"
ON "ContractProject"("buyerProjectId");

CREATE INDEX "ContractProject_orgId_contractStatus_updatedAt_idx"
ON "ContractProject"("orgId", "contractStatus", "updatedAt");

CREATE INDEX "ContractProject_orgId_paymentStatus_updatedAt_idx"
ON "ContractProject"("orgId", "paymentStatus", "updatedAt");

CREATE INDEX "ContractProject_orgId_changeOrderStatus_updatedAt_idx"
ON "ContractProject"("orgId", "changeOrderStatus", "updatedAt");

CREATE INDEX "ContractProject_customerId_updatedAt_idx"
ON "ContractProject"("customerId", "updatedAt");

CREATE INDEX "ContractProject_leadId_updatedAt_idx"
ON "ContractProject"("leadId", "updatedAt");

CREATE INDEX "ContractProject_createdByUserId_createdAt_idx"
ON "ContractProject"("createdByUserId", "createdAt");

ALTER TABLE "ContractProject"
ADD CONSTRAINT "ContractProject_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractProject"
ADD CONSTRAINT "ContractProject_buyerProjectId_fkey"
FOREIGN KEY ("buyerProjectId") REFERENCES "BuyerProject"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractProject"
ADD CONSTRAINT "ContractProject_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContractProject"
ADD CONSTRAINT "ContractProject_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContractProject"
ADD CONSTRAINT "ContractProject_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
