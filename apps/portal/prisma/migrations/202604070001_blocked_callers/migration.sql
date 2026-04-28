CREATE TABLE IF NOT EXISTS "BlockedCaller" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "reason" TEXT,
  "sourceLeadId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockedCaller_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlockedCaller_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BlockedCaller_sourceLeadId_fkey" FOREIGN KEY ("sourceLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BlockedCaller_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlockedCaller_orgId_phoneE164_key" ON "BlockedCaller"("orgId", "phoneE164");
CREATE INDEX IF NOT EXISTS "BlockedCaller_orgId_createdAt_idx" ON "BlockedCaller"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "BlockedCaller_sourceLeadId_idx" ON "BlockedCaller"("sourceLeadId");
CREATE INDEX IF NOT EXISTS "BlockedCaller_createdByUserId_createdAt_idx" ON "BlockedCaller"("createdByUserId", "createdAt");
