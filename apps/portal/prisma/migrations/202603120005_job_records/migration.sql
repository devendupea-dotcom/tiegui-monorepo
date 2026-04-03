-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'ESTIMATING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "estimateDraftId" TEXT,
    "customerName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "notes" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMeasurements" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMeasurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMaterials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "materialId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMaterials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLabor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "markupPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLabor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_orgId_status_updatedAt_idx" ON "Job"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Job_estimateDraftId_updatedAt_idx" ON "Job"("estimateDraftId", "updatedAt");

-- CreateIndex
CREATE INDEX "Job_createdByUserId_updatedAt_idx" ON "Job"("createdByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "JobMeasurements_jobId_createdAt_idx" ON "JobMeasurements"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobMeasurements_orgId_createdAt_idx" ON "JobMeasurements"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "JobMaterials_jobId_createdAt_idx" ON "JobMaterials"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobMaterials_materialId_idx" ON "JobMaterials"("materialId");

-- CreateIndex
CREATE INDEX "JobMaterials_orgId_createdAt_idx" ON "JobMaterials"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "JobLabor_jobId_createdAt_idx" ON "JobLabor"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobLabor_orgId_createdAt_idx" ON "JobLabor"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_estimateDraftId_fkey" FOREIGN KEY ("estimateDraftId") REFERENCES "EstimateDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMeasurements" ADD CONSTRAINT "JobMeasurements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMeasurements" ADD CONSTRAINT "JobMeasurements_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMaterials" ADD CONSTRAINT "JobMaterials_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMaterials" ADD CONSTRAINT "JobMaterials_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMaterials" ADD CONSTRAINT "JobMaterials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLabor" ADD CONSTRAINT "JobLabor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLabor" ADD CONSTRAINT "JobLabor_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
