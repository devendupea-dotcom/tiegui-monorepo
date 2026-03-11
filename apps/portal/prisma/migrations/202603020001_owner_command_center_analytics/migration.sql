DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadSourceChannel') THEN
    CREATE TYPE "LeadSourceChannel" AS ENUM (
      'GOOGLE_ADS',
      'META_ADS',
      'ORGANIC',
      'REFERRAL',
      'OTHER'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketingChannel') THEN
    CREATE TYPE "MarketingChannel" AS ENUM (
      'GOOGLE_ADS',
      'META_ADS',
      'OTHER'
    );
  END IF;
END
$$;

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "sourceChannel" "LeadSourceChannel" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS "utmSource" TEXT,
  ADD COLUMN IF NOT EXISTS "utmMedium" TEXT,
  ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;

UPDATE "Lead"
SET "sourceChannel" = CASE
  WHEN "leadSource" = 'FB' OR COALESCE("fbClickId", '') <> '' THEN 'META_ADS'::"LeadSourceChannel"
  WHEN "sourceType" = 'REFERRAL' OR "leadSource" = 'REFERRAL' THEN 'REFERRAL'::"LeadSourceChannel"
  WHEN "sourceType" = 'PAID' THEN 'GOOGLE_ADS'::"LeadSourceChannel"
  WHEN "sourceType" IN ('ORGANIC', 'WALKIN', 'REPEAT') THEN 'ORGANIC'::"LeadSourceChannel"
  ELSE 'OTHER'::"LeadSourceChannel"
END
WHERE "sourceChannel" = 'OTHER';

CREATE INDEX IF NOT EXISTS "Lead_orgId_sourceChannel_createdAt_idx"
  ON "Lead"("orgId", "sourceChannel", "createdAt");

CREATE TABLE IF NOT EXISTS "MarketingSpend" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "monthStart" TIMESTAMP(3) NOT NULL,
  "channel" "MarketingChannel" NOT NULL,
  "spendCents" INTEGER NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingSpend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingSpend_orgId_monthStart_channel_key"
  ON "MarketingSpend"("orgId", "monthStart", "channel");

CREATE INDEX IF NOT EXISTS "MarketingSpend_orgId_monthStart_idx"
  ON "MarketingSpend"("orgId", "monthStart");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MarketingSpend_orgId_fkey'
  ) THEN
    ALTER TABLE "MarketingSpend"
      ADD CONSTRAINT "MarketingSpend_orgId_fkey"
      FOREIGN KEY ("orgId")
      REFERENCES "Organization"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MarketingSpend_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "MarketingSpend"
      ADD CONSTRAINT "MarketingSpend_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;

INSERT INTO "MarketingSpend" (
  "id",
  "orgId",
  "monthStart",
  "channel",
  "spendCents",
  "notes",
  "createdByUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(
    "legacy"."orgId"
    || '|'
    || to_char("legacy"."monthStart", 'YYYY-MM-DD')
    || '|'
    || "legacy"."channel"::text
  ) AS "id",
  "legacy"."orgId",
  "legacy"."monthStart",
  "legacy"."channel",
  "legacy"."spendCents",
  'Imported from legacy ad spend entries' AS "notes",
  "legacy"."createdByUserId",
  "legacy"."createdAt",
  "legacy"."updatedAt"
FROM (
  SELECT
    "orgId",
    date_trunc('month', "spendDate")::timestamp(3) without time zone AS "monthStart",
    CASE
      WHEN lower(COALESCE("source", '')) LIKE '%facebook%' THEN 'META_ADS'::"MarketingChannel"
      WHEN lower(COALESCE("source", '')) LIKE '%instagram%' THEN 'META_ADS'::"MarketingChannel"
      WHEN lower(COALESCE("source", '')) LIKE '%meta%' THEN 'META_ADS'::"MarketingChannel"
      WHEN lower(COALESCE("source", '')) LIKE '%google%' THEN 'GOOGLE_ADS'::"MarketingChannel"
      ELSE 'OTHER'::"MarketingChannel"
    END AS "channel",
    SUM("amountCents")::integer AS "spendCents",
    MAX("createdByUserId") AS "createdByUserId",
    MIN("createdAt") AS "createdAt",
    MAX("createdAt") AS "updatedAt"
  FROM "AdSpendEntry"
  GROUP BY
    "orgId",
    date_trunc('month', "spendDate")::timestamp(3) without time zone,
    CASE
      WHEN lower(COALESCE("source", '')) LIKE '%facebook%' THEN 'META_ADS'::"MarketingChannel"
      WHEN lower(COALESCE("source", '')) LIKE '%instagram%' THEN 'META_ADS'::"MarketingChannel"
      WHEN lower(COALESCE("source", '')) LIKE '%meta%' THEN 'META_ADS'::"MarketingChannel"
      WHEN lower(COALESCE("source", '')) LIKE '%google%' THEN 'GOOGLE_ADS'::"MarketingChannel"
      ELSE 'OTHER'::"MarketingChannel"
    END
) AS "legacy"
ON CONFLICT ("orgId", "monthStart", "channel") DO NOTHING;
