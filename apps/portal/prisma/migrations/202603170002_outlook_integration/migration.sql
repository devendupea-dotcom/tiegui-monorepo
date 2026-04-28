ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'OUTLOOK';

ALTER TABLE "IntegrationAccount"
ADD COLUMN IF NOT EXISTS "providerEmail" TEXT,
ADD COLUMN IF NOT EXISTS "providerDisplayName" TEXT;
