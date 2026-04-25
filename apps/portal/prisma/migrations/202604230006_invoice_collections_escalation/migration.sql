ALTER TABLE "Organization"
ADD COLUMN "invoiceCollectionsUrgentAfterDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN "invoiceCollectionsFinalAfterDays" INTEGER NOT NULL DEFAULT 21;
