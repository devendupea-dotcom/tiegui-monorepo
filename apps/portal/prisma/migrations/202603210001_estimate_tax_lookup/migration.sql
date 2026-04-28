-- CreateEnum
CREATE TYPE "EstimateTaxSource" AS ENUM ('MANUAL', 'WA_DOR');

-- AlterTable
ALTER TABLE "Estimate"
ADD COLUMN "taxCalculatedAt" TIMESTAMP(3),
ADD COLUMN "taxJurisdiction" TEXT,
ADD COLUMN "taxLocationCode" TEXT,
ADD COLUMN "taxRateSource" "EstimateTaxSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "taxZipCode" TEXT;
