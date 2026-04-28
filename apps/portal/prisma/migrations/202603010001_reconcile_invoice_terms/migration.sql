-- Reconcile drifted environments where Invoice.terms was not added successfully.

DO $$
BEGIN
  CREATE TYPE "InvoiceTerms" AS ENUM ('DUE_ON_RECEIPT', 'NET_7', 'NET_15', 'NET_30');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "terms" "InvoiceTerms" DEFAULT 'DUE_ON_RECEIPT';

UPDATE "Invoice"
SET "terms" = 'DUE_ON_RECEIPT'
WHERE "terms" IS NULL;

ALTER TABLE "Invoice"
  ALTER COLUMN "terms" SET DEFAULT 'DUE_ON_RECEIPT';

ALTER TABLE "Invoice"
  ALTER COLUMN "terms" SET NOT NULL;
