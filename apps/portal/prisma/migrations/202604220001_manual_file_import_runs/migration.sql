ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'MANUAL_FILE';

ALTER TABLE "ImportRun"
ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;

CREATE INDEX IF NOT EXISTS "ImportRun_actorUserId_createdAt_idx"
  ON "ImportRun"("actorUserId", "createdAt");

ALTER TABLE "ImportRun"
  ADD CONSTRAINT "ImportRun_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
