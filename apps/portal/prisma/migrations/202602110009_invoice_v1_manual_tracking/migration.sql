ALTER TABLE "Organization"
  ADD COLUMN "invoiceSequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrgDashboardConfig"
  ADD COLUMN "defaultTaxRate" DECIMAL(6,4) NOT NULL DEFAULT 0;

CREATE TYPE "BillingInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'PARTIAL', 'OVERDUE');

CREATE TYPE "InvoicePaymentMethod" AS ENUM ('CASH', 'CHECK', 'CARD', 'TRANSFER', 'OTHER');

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "jobId" TEXT,
  "customerId" TEXT NOT NULL,
  "invoiceNumber" INTEGER NOT NULL,
  "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "balanceDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_orgId_invoiceNumber_key"
  ON "Invoice"("orgId", "invoiceNumber");

CREATE INDEX "Invoice_orgId_status_dueDate_idx"
  ON "Invoice"("orgId", "status", "dueDate");

CREATE INDEX "Invoice_jobId_createdAt_idx"
  ON "Invoice"("jobId", "createdAt");

CREATE INDEX "Invoice_customerId_createdAt_idx"
  ON "Invoice"("customerId", "createdAt");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InvoiceLineItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceLineItem_invoiceId_sortOrder_idx"
  ON "InvoiceLineItem"("invoiceId", "sortOrder");

ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InvoicePayment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "date" TIMESTAMP(3) NOT NULL,
  "method" "InvoicePaymentMethod" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoicePayment_invoiceId_date_idx"
  ON "InvoicePayment"("invoiceId", "date");

ALTER TABLE "InvoicePayment"
  ADD CONSTRAINT "InvoicePayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
