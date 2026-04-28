-- Alter Organization for purchase order numbering.
ALTER TABLE "Organization"
ADD COLUMN "purchaseOrderPrefix" TEXT NOT NULL DEFAULT 'PO',
ADD COLUMN "purchaseOrderNextNumber" INTEGER NOT NULL DEFAULT 1;

-- Create PurchaseOrderStatus enum.
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED');

-- Create PurchaseOrder table.
CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "jobId" TEXT,
  "createdByUserId" TEXT,
  "poNumber" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "vendorEmail" TEXT,
  "vendorPhone" TEXT,
  "vendorAddress" TEXT,
  "title" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- Create PurchaseOrderLineItem table.
CREATE TABLE "PurchaseOrderLineItem" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "materialId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unit" TEXT,
  "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PurchaseOrderLineItem_pkey" PRIMARY KEY ("id")
);

-- Create BusinessExpense table.
CREATE TABLE "BusinessExpense" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "jobId" TEXT,
  "purchaseOrderId" TEXT,
  "createdByUserId" TEXT,
  "receiptPhotoId" TEXT,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "vendorName" TEXT,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BusinessExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_orgId_poNumber_key" ON "PurchaseOrder"("orgId", "poNumber");
CREATE INDEX "PurchaseOrder_orgId_status_updatedAt_idx" ON "PurchaseOrder"("orgId", "status", "updatedAt");
CREATE INDEX "PurchaseOrder_jobId_updatedAt_idx" ON "PurchaseOrder"("jobId", "updatedAt");
CREATE INDEX "PurchaseOrder_createdByUserId_updatedAt_idx" ON "PurchaseOrder"("createdByUserId", "updatedAt");

CREATE INDEX "PurchaseOrderLineItem_purchaseOrderId_sortOrder_idx" ON "PurchaseOrderLineItem"("purchaseOrderId", "sortOrder");
CREATE INDEX "PurchaseOrderLineItem_materialId_idx" ON "PurchaseOrderLineItem"("materialId");

CREATE INDEX "BusinessExpense_orgId_expenseDate_idx" ON "BusinessExpense"("orgId", "expenseDate");
CREATE INDEX "BusinessExpense_jobId_createdAt_idx" ON "BusinessExpense"("jobId", "createdAt");
CREATE INDEX "BusinessExpense_purchaseOrderId_createdAt_idx" ON "BusinessExpense"("purchaseOrderId", "createdAt");
CREATE INDEX "BusinessExpense_createdByUserId_createdAt_idx" ON "BusinessExpense"("createdByUserId", "createdAt");
CREATE INDEX "BusinessExpense_receiptPhotoId_idx" ON "BusinessExpense"("receiptPhotoId");

ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "PurchaseOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderLineItem"
ADD CONSTRAINT "PurchaseOrderLineItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "PurchaseOrderLineItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessExpense"
ADD CONSTRAINT "BusinessExpense_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "BusinessExpense_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BusinessExpense_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BusinessExpense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BusinessExpense_receiptPhotoId_fkey" FOREIGN KEY ("receiptPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
