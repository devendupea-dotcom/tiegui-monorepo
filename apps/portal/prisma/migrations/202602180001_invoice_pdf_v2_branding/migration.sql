-- TieGui Invoice PDF v2 + Org branding fields + legit invoice numbering.

ALTER TABLE "Organization"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "zip" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "licenseNumber" TEXT,
  ADD COLUMN "ein" TEXT,
  ADD COLUMN "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
  ADD COLUMN "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "invoicePaymentInstructions" TEXT,
  ADD COLUMN "logoPhotoId" TEXT;

-- Initialize next invoice number from the legacy sequence counter when present.
UPDATE "Organization"
SET "invoiceNextNumber" = GREATEST("invoiceSequence" + 1, 1)
WHERE "invoiceNextNumber" = 1;

-- Logo reference is optional but must be unique when set.
CREATE UNIQUE INDEX "Organization_logoPhotoId_key"
  ON "Organization"("logoPhotoId");

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_logoPhotoId_fkey"
  FOREIGN KEY ("logoPhotoId") REFERENCES "Photo"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "InvoiceTerms" AS ENUM ('DUE_ON_RECEIPT', 'NET_7', 'NET_15', 'NET_30');

-- Move invoiceNumber from int -> text and backfill with a stable public code.
DROP INDEX IF EXISTS "Invoice_orgId_invoiceNumber_key";

ALTER TABLE "Invoice"
  ALTER COLUMN "invoiceNumber" TYPE TEXT USING ("invoiceNumber"::text);

-- Backfill as: {prefix}-{YYYY}-{NNNN}
UPDATE "Invoice" AS i
SET "invoiceNumber" = o."invoicePrefix"
  || '-' || EXTRACT(YEAR FROM i."issueDate")::text
  || '-' || LPAD(i."invoiceNumber"::text, 4, '0')
FROM "Organization" AS o
WHERE i."orgId" = o."id";

ALTER TABLE "Invoice"
  ADD COLUMN "terms" "InvoiceTerms" NOT NULL DEFAULT 'DUE_ON_RECEIPT';

CREATE UNIQUE INDEX "Invoice_orgId_invoiceNumber_key"
  ON "Invoice"("orgId", "invoiceNumber");

