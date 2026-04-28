ALTER TABLE "OrganizationTwilioConfig"
  ADD COLUMN IF NOT EXISTS "voiceForwardingNumber" TEXT;

WITH ranked_destinations AS (
  SELECT
    "orgId",
    "phoneE164",
    ROW_NUMBER() OVER (
      PARTITION BY "orgId"
      ORDER BY
        CASE
          WHEN "calendarAccessRole" = 'OWNER' THEN 0
          WHEN "calendarAccessRole" = 'ADMIN' THEN 1
          ELSE 2
        END,
        "createdAt" ASC,
        "id" ASC
    ) AS row_num
  FROM "User"
  WHERE
    "orgId" IS NOT NULL
    AND "phoneE164" IS NOT NULL
    AND "calendarAccessRole" IN ('OWNER', 'ADMIN')
)
UPDATE "OrganizationTwilioConfig" AS config
SET "voiceForwardingNumber" = ranked_destinations."phoneE164"
FROM ranked_destinations
WHERE
  ranked_destinations.row_num = 1
  AND ranked_destinations."orgId" = config."organizationId"
  AND (
    config."voiceForwardingNumber" IS NULL
    OR btrim(config."voiceForwardingNumber") = ''
  );
