-- CreateEnum
CREATE TYPE "EstimateDraftLineType" AS ENUM ('MATERIAL', 'CUSTOM_MATERIAL', 'LABOR');

-- CreateTable
CREATE TABLE "EstimateDraft" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "projectName" TEXT NOT NULL,
    "customerName" TEXT,
    "siteAddress" TEXT,
    "projectType" TEXT,
    "notes" TEXT,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "materialsTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "laborTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateDraftLineItem" (
    "id" TEXT NOT NULL,
    "estimateDraftId" TEXT NOT NULL,
    "materialId" TEXT,
    "type" "EstimateDraftLineType" NOT NULL DEFAULT 'MATERIAL',
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lineCostTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineSellTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateDraftLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstimateDraft_orgId_updatedAt_idx" ON "EstimateDraft"("orgId", "updatedAt");

-- CreateIndex
CREATE INDEX "EstimateDraft_createdByUserId_updatedAt_idx" ON "EstimateDraft"("createdByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "EstimateDraftLineItem_estimateDraftId_sortOrder_idx" ON "EstimateDraftLineItem"("estimateDraftId", "sortOrder");

-- CreateIndex
CREATE INDEX "EstimateDraftLineItem_materialId_idx" ON "EstimateDraftLineItem"("materialId");

-- AddForeignKey
ALTER TABLE "EstimateDraft" ADD CONSTRAINT "EstimateDraft_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateDraft" ADD CONSTRAINT "EstimateDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateDraftLineItem" ADD CONSTRAINT "EstimateDraftLineItem_estimateDraftId_fkey" FOREIGN KEY ("estimateDraftId") REFERENCES "EstimateDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateDraftLineItem" ADD CONSTRAINT "EstimateDraftLineItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
