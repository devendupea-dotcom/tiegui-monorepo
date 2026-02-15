-- Move lead photos out of Postgres by storing only object references (Cloudflare R2 / S3 compatible).

CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Photo" ADD CONSTRAINT "Photo_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Photo_orgId_key_key" ON "Photo"("orgId", "key");
CREATE INDEX "Photo_orgId_createdAt_idx" ON "Photo"("orgId", "createdAt");

ALTER TABLE "LeadPhoto" ADD COLUMN "photoId" TEXT;
ALTER TABLE "LeadPhoto" ALTER COLUMN "imageDataUrl" DROP NOT NULL;

ALTER TABLE "LeadPhoto" ADD CONSTRAINT "LeadPhoto_photoId_fkey"
  FOREIGN KEY ("photoId") REFERENCES "Photo"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LeadPhoto_photoId_idx" ON "LeadPhoto"("photoId");

