CREATE TYPE "MessagingOpsTriageTargetType" AS ENUM ('FAILED_SMS_MESSAGE', 'UNMATCHED_STATUS_CALLBACK');

CREATE TYPE "MessagingOpsTriageReason" AS ENUM ('HISTORICAL_TEST_DATA', 'BAD_DESTINATION_NUMBER', 'CARRIER_FILTERING_ACCEPTED', 'RECOVERED_OR_DUPLICATE', 'ACCEPTED_FOR_CONTROLLED_ROLLOUT', 'OTHER');

CREATE TABLE "MessagingOpsTriage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "targetType" "MessagingOpsTriageTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "MessagingOpsTriageReason" NOT NULL,
    "note" TEXT,
    "decidedByUserId" TEXT,
    "targetCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingOpsTriage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagingOpsTriage_orgId_targetType_targetId_key" ON "MessagingOpsTriage"("orgId", "targetType", "targetId");
CREATE INDEX "MessagingOpsTriage_orgId_targetType_createdAt_idx" ON "MessagingOpsTriage"("orgId", "targetType", "createdAt");
CREATE INDEX "MessagingOpsTriage_decidedByUserId_createdAt_idx" ON "MessagingOpsTriage"("decidedByUserId", "createdAt");

ALTER TABLE "MessagingOpsTriage" ADD CONSTRAINT "MessagingOpsTriage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagingOpsTriage" ADD CONSTRAINT "MessagingOpsTriage_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
