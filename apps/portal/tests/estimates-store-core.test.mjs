import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";
import {
  buildEstimateActivityMetadata,
  buildEstimateListWhere,
  buildExistingLineFallback,
  buildInvoiceLineDescription,
  mergeJobNotes,
  normalizeEstimateItemRows,
  normalizeEstimatePayloadCore,
  resolveActivityTypeForStatus,
} from "../lib/estimates-store-core.ts";

test("normalizeEstimateItemRows trims values and recomputes totals", () => {
  const rows = normalizeEstimateItemRows([
    {
      id: "line-1",
      materialId: null,
      type: "CUSTOM_MATERIAL",
      sortOrder: 9,
      name: "  Paint  ",
      description: "  Interior walls  ",
      quantity: "2",
      unit: "  gallons ",
      unitPrice: "19.50",
      total: 0,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      sortOrder: rows[0].sortOrder,
      name: rows[0].name,
      description: rows[0].description,
      quantity: rows[0].quantity.toString(),
      unit: rows[0].unit,
      unitPrice: rows[0].unitPrice.toString(),
      total: rows[0].total.toString(),
    },
    {
      sortOrder: 0,
      name: "Paint",
      description: "Interior walls",
      quantity: "2",
      unit: "gallons",
      unitPrice: "19.5",
      total: "39",
    },
  );
});

test("buildExistingLineFallback converts stored decimals back into form-safe rows", () => {
  const rows = buildExistingLineFallback([
    {
      id: "line-1",
      materialId: "material-1",
      type: "MATERIAL",
      sortOrder: 3,
      name: "Primer",
      description: null,
      quantity: new Prisma.Decimal("2.00"),
      unit: "each",
      unitPrice: new Prisma.Decimal("14.25"),
      total: new Prisma.Decimal("28.50"),
    },
  ]);

  assert.deepEqual(rows, [
    {
      id: "line-1",
      materialId: "material-1",
      type: "MATERIAL",
      sortOrder: 3,
      name: "Primer",
      description: "",
      quantity: "2",
      unit: "each",
      unitPrice: "14.25",
      total: 28.5,
    },
  ]);
});

test("normalizeEstimatePayloadCore preserves current estimate data while recalculating totals", () => {
  const normalized = normalizeEstimatePayloadCore({
    payload: {
      customerName: "  Acme Co  ",
      taxRatePercent: "10",
      status: "SENT",
    },
    existingEstimate: {
      leadId: "lead-1",
      title: "Existing Estimate",
      customerName: "Old Name",
      siteAddress: "123 Main St, Seattle, WA 98101",
      projectType: "Painting",
      description: "Existing description",
      notes: "Existing notes",
      terms: "Net 15",
      taxRate: new Prisma.Decimal("0.0825"),
      taxRateSource: "MANUAL",
      taxZipCode: null,
      taxJurisdiction: null,
      taxLocationCode: null,
      taxCalculatedAt: null,
      subtotal: new Prisma.Decimal("50"),
      tax: new Prisma.Decimal("4.13"),
      total: new Prisma.Decimal("54.13"),
      validUntil: new Date("2026-04-30T00:00:00.000Z"),
      status: "DRAFT",
    },
    leadDefaults: {
      id: "lead-1",
      contactName: "Lead Contact",
      businessName: null,
      businessType: "Painting",
      intakeLocationText: "123 Main St, Seattle, WA 98101",
    },
    lineItemInputs: [
      {
        id: "line-1",
        materialId: null,
        type: "LABOR",
        sortOrder: 0,
        name: "Prep",
        description: "",
        quantity: "2",
        unit: "hours",
        unitPrice: "50",
        total: 0,
      },
    ],
    siteZipCode: "98101",
  });

  assert.deepEqual(
    {
      leadId: normalized.leadId,
      title: normalized.title,
      customerName: normalized.customerName,
      siteAddress: normalized.siteAddress,
      status: normalized.status,
      subtotal: normalized.subtotal.toString(),
      tax: normalized.tax.toString(),
      total: normalized.total.toString(),
    },
    {
      leadId: "lead-1",
      title: "Existing Estimate",
      customerName: "Acme Co",
      siteAddress: "123 Main St, Seattle, WA 98101",
      status: "SENT",
      subtotal: "100",
      tax: "10",
      total: "110",
    },
  );
});

test("normalizeEstimatePayloadCore blocks stale WA_DOR tax zip data after the site address changes", () => {
  assert.throws(
    () =>
      normalizeEstimatePayloadCore({
        payload: {
          siteAddress: "500 Pine St, Seattle, WA 98101",
          taxRateSource: "WA_DOR",
          taxZipCode: "98052",
        },
        existingEstimate: {
          leadId: "lead-1",
          title: "Estimate",
          customerName: "Acme",
          siteAddress: null,
          projectType: null,
          description: null,
          notes: null,
          terms: null,
          taxRate: new Prisma.Decimal("0.1"),
          taxRateSource: "WA_DOR",
          taxZipCode: "98052",
          taxJurisdiction: null,
          taxLocationCode: null,
          taxCalculatedAt: new Date("2026-04-09T00:00:00.000Z"),
          subtotal: new Prisma.Decimal("0"),
          tax: new Prisma.Decimal("0"),
          total: new Prisma.Decimal("0"),
          validUntil: null,
          status: "DRAFT",
        },
        leadDefaults: null,
        lineItemInputs: [],
        siteZipCode: "98101",
      }),
    /Site ZIP changed/,
  );
});

test("conversion/list helper outputs stay compact and stable", () => {
  assert.equal(resolveActivityTypeForStatus("APPROVED"), "APPROVED");
  assert.equal(buildInvoiceLineDescription({ name: "Paint", description: "Blue accent wall" }), "Paint - Blue accent wall");
  assert.equal(mergeJobNotes(" First note ", "Second note", "First note"), "First note\n\nSecond note");
  assert.deepEqual(
    buildEstimateActivityMetadata({
      status: "SENT",
      total: new Prisma.Decimal("150.25"),
      estimateNumber: "EST-2026-0001",
    }),
    {
      status: "SENT",
      total: 150.25,
      estimateNumber: "EST-2026-0001",
    },
  );

  const where = buildEstimateListWhere({
    orgId: "org-1",
    query: "Acme",
    statusValues: ["SENT", "APPROVED"],
    includeArchived: false,
  });

  assert.equal(where.orgId, "org-1");
  assert.deepEqual(where.status, { in: ["SENT", "APPROVED"] });
  assert.equal(where.archivedAt, null);
  assert.equal(Array.isArray(where.OR), true);
});
