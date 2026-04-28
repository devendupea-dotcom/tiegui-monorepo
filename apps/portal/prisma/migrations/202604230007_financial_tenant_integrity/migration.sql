CREATE OR REPLACE FUNCTION "enforce_invoice_tenant_integrity"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Customer"
    WHERE "Customer"."id" = NEW."customerId"
      AND "Customer"."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Invoice customer must belong to the invoice organization.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."jobId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Lead"
    WHERE "Lead"."id" = NEW."jobId"
      AND "Lead"."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Invoice lead context must belong to the invoice organization.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."sourceEstimateId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Estimate"
    WHERE "Estimate"."id" = NEW."sourceEstimateId"
      AND "Estimate"."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Invoice source estimate must belong to the invoice organization.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."sourceJobId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Job"
    WHERE "Job"."id" = NEW."sourceJobId"
      AND "Job"."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Invoice source job must belong to the invoice organization.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "enforce_invoice_tenant_integrity_trigger" ON "Invoice";

CREATE TRIGGER "enforce_invoice_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE OF "orgId", "customerId", "jobId", "sourceEstimateId", "sourceJobId"
ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION "enforce_invoice_tenant_integrity"();

CREATE OR REPLACE FUNCTION "enforce_invoice_collection_attempt_tenant_integrity"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Invoice"
    WHERE "Invoice"."id" = NEW."invoiceId"
      AND "Invoice"."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Invoice collection attempt must belong to the same organization as its invoice.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "enforce_invoice_collection_attempt_tenant_integrity_trigger" ON "InvoiceCollectionAttempt";

CREATE TRIGGER "enforce_invoice_collection_attempt_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE OF "orgId", "invoiceId"
ON "InvoiceCollectionAttempt"
FOR EACH ROW
EXECUTE FUNCTION "enforce_invoice_collection_attempt_tenant_integrity"();

CREATE OR REPLACE FUNCTION "enforce_recurring_service_plan_tenant_integrity"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Customer"
    WHERE "Customer"."id" = NEW."customerId"
      AND "Customer"."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Recurring service plan customer must belong to the plan organization.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "enforce_recurring_service_plan_tenant_integrity_trigger" ON "RecurringServicePlan";

CREATE TRIGGER "enforce_recurring_service_plan_tenant_integrity_trigger"
BEFORE INSERT OR UPDATE OF "orgId", "customerId"
ON "RecurringServicePlan"
FOR EACH ROW
EXECUTE FUNCTION "enforce_recurring_service_plan_tenant_integrity"();

ALTER TABLE "Organization"
ADD CONSTRAINT "Organization_invoice_collections_cadence_check"
CHECK (
  "invoiceFirstReminderLeadDays" >= 0
  AND "invoiceOverdueReminderCadenceDays" >= 1
  AND "invoiceCollectionsMaxReminders" >= 1
  AND "invoiceCollectionsUrgentAfterDays" >= 1
  AND "invoiceCollectionsFinalAfterDays" > "invoiceCollectionsUrgentAfterDays"
) NOT VALID;

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_money_non_negative_check"
CHECK (
  "subtotal" >= 0
  AND "taxRate" >= 0
  AND "taxAmount" >= 0
  AND "total" >= 0
  AND "amountPaid" >= 0
  AND "balanceDue" >= 0
) NOT VALID;

ALTER TABLE "InvoicePayment"
ADD CONSTRAINT "InvoicePayment_amount_non_negative_check"
CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "InvoiceCheckoutSession"
ADD CONSTRAINT "InvoiceCheckoutSession_amount_non_negative_check"
CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "RecurringServicePlan"
ADD CONSTRAINT "RecurringServicePlan_amount_interval_check"
CHECK ("amount" >= 0 AND "intervalCount" >= 1) NOT VALID;

ALTER TABLE "RecurringBillingCharge"
ADD CONSTRAINT "RecurringBillingCharge_amount_non_negative_check"
CHECK ("amount" >= 0) NOT VALID;
