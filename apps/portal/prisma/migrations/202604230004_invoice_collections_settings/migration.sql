ALTER TABLE "Organization"
ADD COLUMN "invoiceCollectionsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "invoiceFirstReminderLeadDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "invoiceOverdueReminderCadenceDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN "invoiceCollectionsMaxReminders" INTEGER NOT NULL DEFAULT 2;
