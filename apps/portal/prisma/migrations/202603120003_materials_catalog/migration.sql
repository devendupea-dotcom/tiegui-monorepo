-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseCost" DOUBLE PRECISION NOT NULL,
    "markupPercent" DOUBLE PRECISION NOT NULL,
    "sellPrice" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Material_orgId_active_category_idx" ON "Material"("orgId", "active", "category");

-- CreateIndex
CREATE INDEX "Material_orgId_name_idx" ON "Material"("orgId", "name");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
