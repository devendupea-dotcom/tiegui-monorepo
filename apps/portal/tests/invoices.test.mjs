import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { deriveInvoiceStatus } from "../lib/invoices.ts";

test("deriveInvoiceStatus keeps zero-total drafts editable", () => {
  const status = deriveInvoiceStatus({
    currentStatus: "DRAFT",
    dueDate: new Date("2026-04-01T00:00:00.000Z"),
    total: new Prisma.Decimal(0),
    amountPaid: new Prisma.Decimal(0),
    now: new Date("2026-04-02T00:00:00.000Z"),
  });

  assert.equal(status, "DRAFT");
});

test("deriveInvoiceStatus does not auto-mark zero-total sent invoices as paid", () => {
  const status = deriveInvoiceStatus({
    currentStatus: "SENT",
    dueDate: new Date("2026-04-01T00:00:00.000Z"),
    total: new Prisma.Decimal(0),
    amountPaid: new Prisma.Decimal(0),
    now: new Date("2026-04-02T00:00:00.000Z"),
  });

  assert.equal(status, "SENT");
});
