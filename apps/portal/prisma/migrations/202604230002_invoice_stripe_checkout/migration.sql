ALTER TYPE "InvoicePaymentMethod" ADD VALUE IF NOT EXISTS 'STRIPE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceCheckoutSessionStatus') THEN
    CREATE TYPE "InvoiceCheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'EXPIRED', 'CANCELED');
  END IF;
END
$$;

ALTER TABLE "InvoicePayment"
ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT;

CREATE TABLE IF NOT EXISTS "InvoiceCheckoutSession" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "InvoiceCheckoutSessionStatus" NOT NULL DEFAULT 'OPEN',
  "stripeCheckoutSessionId" TEXT NOT NULL,
  "stripePaymentIntentId" TEXT,
  "checkoutUrl" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceCheckoutSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceCheckoutSession_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePayment_stripeCheckoutSessionId_key"
ON "InvoicePayment"("stripeCheckoutSessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePayment_stripePaymentIntentId_key"
ON "InvoicePayment"("stripePaymentIntentId");

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceCheckoutSession_stripeCheckoutSessionId_key"
ON "InvoiceCheckoutSession"("stripeCheckoutSessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceCheckoutSession_stripePaymentIntentId_key"
ON "InvoiceCheckoutSession"("stripePaymentIntentId");

CREATE INDEX IF NOT EXISTS "InvoiceCheckoutSession_invoiceId_status_createdAt_idx"
ON "InvoiceCheckoutSession"("invoiceId", "status", "createdAt");
