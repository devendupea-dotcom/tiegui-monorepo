-- Per-org quotas to prevent surprise bills (Twilio + OpenAI).

ALTER TABLE "Organization"
  ADD COLUMN "smsMonthlyLimit" INTEGER NOT NULL DEFAULT 3000,
  ADD COLUMN "smsHardStop" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiMonthlyBudgetCents" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "aiHardStop" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiUserDailyRequestLimit" INTEGER NOT NULL DEFAULT 25;

CREATE TABLE "OrganizationUsage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "smsSentCount" INTEGER NOT NULL DEFAULT 0,
  "smsReceivedCount" INTEGER NOT NULL DEFAULT 0,
  "smsCostEstimateCents" INTEGER NOT NULL DEFAULT 0,
  "smsAlert80At" TIMESTAMP(3),
  "smsAlert100At" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationUsage_orgId_periodStart_key"
  ON "OrganizationUsage"("orgId", "periodStart");

CREATE INDEX "OrganizationUsage_orgId_periodStart_idx"
  ON "OrganizationUsage"("orgId", "periodStart");

ALTER TABLE "OrganizationUsage"
  ADD CONSTRAINT "OrganizationUsage_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiUsage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "requestsCount" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
  "alert80At" TIMESTAMP(3),
  "alert100At" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsage_orgId_periodStart_key"
  ON "AiUsage"("orgId", "periodStart");

CREATE INDEX "AiUsage_orgId_periodStart_idx"
  ON "AiUsage"("orgId", "periodStart");

ALTER TABLE "AiUsage"
  ADD CONSTRAINT "AiUsage_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiUserDayUsage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dayStart" TIMESTAMP(3) NOT NULL,
  "requestsCount" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUserDayUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUserDayUsage_orgId_userId_dayStart_key"
  ON "AiUserDayUsage"("orgId", "userId", "dayStart");

CREATE INDEX "AiUserDayUsage_orgId_dayStart_idx"
  ON "AiUserDayUsage"("orgId", "dayStart");

CREATE INDEX "AiUserDayUsage_userId_dayStart_idx"
  ON "AiUserDayUsage"("userId", "dayStart");

ALTER TABLE "AiUserDayUsage"
  ADD CONSTRAINT "AiUserDayUsage_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiUserDayUsage"
  ADD CONSTRAINT "AiUserDayUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

