-- Google Sync health alert log table:
-- - stores reason flags + metrics snapshot
-- - used by HQ alert banner deduped logging

CREATE TABLE IF NOT EXISTS "GoogleSyncHealthAlert" (
  "id" TEXT NOT NULL,
  "cronStale" BOOLEAN NOT NULL DEFAULT false,
  "queueHigh" BOOLEAN NOT NULL DEFAULT false,
  "errorRateHigh" BOOLEAN NOT NULL DEFAULT false,
  "metricsSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleSyncHealthAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GoogleSyncHealthAlert_createdAt_idx"
  ON "GoogleSyncHealthAlert"("createdAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncHealthAlert_cronStale_createdAt_idx"
  ON "GoogleSyncHealthAlert"("cronStale", "createdAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncHealthAlert_queueHigh_createdAt_idx"
  ON "GoogleSyncHealthAlert"("queueHigh", "createdAt");

CREATE INDEX IF NOT EXISTS "GoogleSyncHealthAlert_errorRateHigh_createdAt_idx"
  ON "GoogleSyncHealthAlert"("errorRateHigh", "createdAt");
