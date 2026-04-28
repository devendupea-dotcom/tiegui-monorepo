CREATE TABLE "JobTrackingLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTrackingLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobTrackingLink_tokenHash_key" ON "JobTrackingLink"("tokenHash");
CREATE INDEX "JobTrackingLink_orgId_createdAt_idx" ON "JobTrackingLink"("orgId", "createdAt");
CREATE INDEX "JobTrackingLink_jobId_createdAt_idx" ON "JobTrackingLink"("jobId", "createdAt");
CREATE INDEX "JobTrackingLink_createdByUserId_createdAt_idx" ON "JobTrackingLink"("createdByUserId", "createdAt");
CREATE INDEX "JobTrackingLink_revokedAt_createdAt_idx" ON "JobTrackingLink"("revokedAt", "createdAt");

ALTER TABLE "JobTrackingLink"
ADD CONSTRAINT "JobTrackingLink_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "JobTrackingLink"
ADD CONSTRAINT "JobTrackingLink_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "Job"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "JobTrackingLink"
ADD CONSTRAINT "JobTrackingLink_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
