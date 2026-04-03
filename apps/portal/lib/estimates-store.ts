import "server-only";

import { Prisma, type EstimateActivityType, type EstimateDraftLineType, type EstimateStatus, type EstimateTaxSource, type JobStatus } from "@prisma/client";
import {
  canTransitionEstimateStatus,
  ESTIMATE_CUSTOMER_NAME_MAX,
  ESTIMATE_DESCRIPTION_MAX,
  ESTIMATE_LINE_DESCRIPTION_MAX,
  ESTIMATE_LINE_UNIT_MAX,
  ESTIMATE_MAX_LINES,
  ESTIMATE_NOTES_MAX,
  ESTIMATE_PROJECT_TYPE_MAX,
  ESTIMATE_SITE_ADDRESS_MAX,
  ESTIMATE_TERMS_MAX,
  ESTIMATE_TITLE_MAX,
  estimateDraftLineTypeOptions,
  estimateStatusOptions,
  normalizeEstimateTaxRate,
  serializeEstimateDetail,
  summarizeEstimateItems,
  type EstimateItemRow,
  type EstimateReferenceLead,
} from "@/lib/estimates";
import { formatDispatchStatusLabel, getDispatchTodayDateKey, normalizeDispatchDateKey, parseDispatchDateKey } from "@/lib/dispatch";
import { maybeSendDispatchCustomerNotifications, type DispatchPersistedJobEvent } from "@/lib/dispatch-notifications";
import { extractEstimateZipCode } from "@/lib/estimate-tax";
import { DEFAULT_INVOICE_TERMS, computeInvoiceDueDate, recomputeInvoiceTotals, reserveNextInvoiceNumber, roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";
import { AppApiError } from "@/lib/app-api-permissions";
import { roundMaterialNumber, type MaterialListItem } from "@/lib/materials";

const ZERO = new Prisma.Decimal(0);

export const estimateListInclude = {
  lead: {
    select: {
      id: true,
      customerId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
    },
  },
  job: {
    select: {
      id: true,
      customerName: true,
      projectType: true,
    },
  },
  _count: {
    select: {
      lineItems: true,
    },
  },
} satisfies Prisma.EstimateInclude;

export const estimateDetailInclude = {
  ...estimateListInclude,
  lineItems: true,
  shareLinks: {
    orderBy: [{ createdAt: "desc" }],
    take: 1,
  },
  activities: {
    include: {
      actorUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
} satisfies Prisma.EstimateInclude;

type EstimatePayload = {
  leadId?: unknown;
  title?: unknown;
  customerName?: unknown;
  siteAddress?: unknown;
  projectType?: unknown;
  description?: unknown;
  notes?: unknown;
  terms?: unknown;
  taxRatePercent?: unknown;
  taxRateSource?: unknown;
  taxZipCode?: unknown;
  taxJurisdiction?: unknown;
  taxLocationCode?: unknown;
  taxCalculatedAt?: unknown;
  validUntil?: unknown;
  status?: unknown;
  lineItems?: unknown;
};

type EstimateItemPayload = {
  materialId?: unknown;
  type?: unknown;
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
};

type NormalizedEstimateItem = {
  materialId: string | null;
  type: EstimateDraftLineType;
  sortOrder: number;
  name: string;
  description: string | null;
  quantity: Prisma.Decimal;
  unit: string | null;
  unitPrice: Prisma.Decimal;
  total: Prisma.Decimal;
};

type NormalizedEstimatePayload = {
  leadId: string | null;
  title: string;
  customerName: string | null;
  siteAddress: string | null;
  projectType: string | null;
  description: string | null;
  notes: string | null;
  terms: string | null;
  taxRate: Prisma.Decimal;
  taxRateSource: EstimateTaxSource;
  taxZipCode: string | null;
  taxJurisdiction: string | null;
  taxLocationCode: string | null;
  taxCalculatedAt: Date | null;
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  validUntil: Date | null;
  status: EstimateStatus;
  lineItems: NormalizedEstimateItem[];
};

type EstimateRecord = Prisma.EstimateGetPayload<{
  include: typeof estimateDetailInclude;
}>;

function normalizeRequiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new AppApiError(`${label} is required.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppApiError(`${label} is required.`, 400);
  }

  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }

  return trimmed;
}

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be text.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }
  return trimmed;
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEstimateStatus(value: unknown, fallback: EstimateStatus): EstimateStatus {
  if (estimateStatusOptions.includes(value as EstimateStatus)) {
    return value as EstimateStatus;
  }
  return fallback;
}

function normalizeEstimateTaxSource(value: unknown, fallback: EstimateTaxSource): EstimateTaxSource {
  if (value === "WA_DOR" || value === "MANUAL") {
    return value;
  }
  return fallback;
}

function normalizeLineType(value: unknown): EstimateDraftLineType {
  if (estimateDraftLineTypeOptions.includes(value as EstimateDraftLineType)) {
    return value as EstimateDraftLineType;
  }
  return "CUSTOM_MATERIAL";
}

function normalizeNonNegativeDecimal(value: unknown, label: string): Prisma.Decimal {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number"
        ? String(value)
        : value instanceof Prisma.Decimal
          ? value.toString()
          : "";

  const decimal = roundMoney(toMoneyDecimal(normalized || "0"));
  if (decimal.lt(0)) {
    throw new AppApiError(`${label} cannot be negative.`, 400);
  }
  return decimal;
}

function normalizeDate(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be an ISO date string.`, 400);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppApiError(`${label} must be a valid date.`, 400);
  }
  return parsed;
}

function decimalToInput(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function decimalToPercentInput(value: Prisma.Decimal): string {
  return value.mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString();
}

async function resolveEstimateLeadDefaults(orgId: string, leadId: string | null) {
  if (!leadId) return null;

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      orgId,
    },
    select: {
      id: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      businessType: true,
      intakeLocationText: true,
      customerId: true,
    },
  });

  if (!lead) {
    throw new AppApiError("Selected lead was not found for this organization.", 400);
  }

  return lead;
}

async function validateEstimateMaterials(orgId: string, lineItems: EstimateItemRow[]) {
  const materialIds = [...new Set(lineItems.map((line) => line.materialId).filter(Boolean))] as string[];
  if (materialIds.length === 0) return;

  const matches = await prisma.material.findMany({
    where: {
      id: { in: materialIds },
      orgId,
    },
    select: { id: true },
  });

  if (matches.length !== materialIds.length) {
    throw new AppApiError("One or more selected materials are not available for this organization.", 400);
  }
}

function normalizeEstimateLineItems(value: unknown, fallback: EstimateItemRow[]): EstimateItemRow[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  if (value.length > ESTIMATE_MAX_LINES) {
    throw new AppApiError(`Estimates support up to ${ESTIMATE_MAX_LINES} line items.`, 400);
  }

  return value.map((entry, index) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: typeof row.id === "string" ? row.id : `estimate-item-${index}`,
      materialId: normalizeOptionalId(row.materialId),
      type: normalizeLineType(row.type),
      sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : index,
      name: typeof row.name === "string" ? row.name : "",
      description: typeof row.description === "string" ? row.description : "",
      quantity:
        typeof row.quantity === "string"
          ? row.quantity
          : typeof row.quantity === "number"
            ? String(row.quantity)
            : "1",
      unit: typeof row.unit === "string" ? row.unit : "",
      unitPrice:
        typeof row.unitPrice === "string"
          ? row.unitPrice
          : typeof row.unitPrice === "number"
            ? String(row.unitPrice)
            : "0",
      total: 0,
    };
  });
}

function normalizeEstimateItemRows(input: EstimateItemRow[]): NormalizedEstimateItem[] {
  return input.map((line, index) => {
    const name = normalizeRequiredText(line.name, "Line item name", ESTIMATE_LINE_DESCRIPTION_MAX);
    const description = normalizeOptionalText(line.description, "Line item description", ESTIMATE_DESCRIPTION_MAX);
    const quantity = normalizeNonNegativeDecimal(line.quantity, "Line item quantity");
    const unit = normalizeOptionalText(line.unit, "Line item unit", ESTIMATE_LINE_UNIT_MAX);
    const unitPrice = normalizeNonNegativeDecimal(line.unitPrice, "Line item unit price");
    const total = roundMoney(quantity.mul(unitPrice));

    return {
      materialId: line.materialId,
      type: line.type,
      sortOrder: index,
      name,
      description,
      quantity,
      unit,
      unitPrice,
      total,
    };
  });
}

function buildExistingLineFallback(
  estimate: EstimateRecord | null,
): EstimateItemRow[] {
  if (!estimate) return [];

  return estimate.lineItems.map((line) => ({
    id: line.id,
    materialId: line.materialId,
    type: line.type,
    sortOrder: line.sortOrder,
    name: line.name,
    description: line.description || "",
    quantity: decimalToInput(line.quantity).replace(/\.00$/, ""),
    unit: line.unit || "",
    unitPrice: decimalToInput(line.unitPrice),
    total: Number(line.total),
  }));
}

function resolveActivityTypeForStatus(status: EstimateStatus): "STATUS_CHANGED" | "SENT" | "VIEWED" | "APPROVED" | "DECLINED" {
  switch (status) {
    case "SENT":
      return "SENT";
    case "VIEWED":
      return "VIEWED";
    case "APPROVED":
      return "APPROVED";
    case "DECLINED":
      return "DECLINED";
    default:
      return "STATUS_CHANGED";
  }
}

export async function reserveNextEstimateNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
  issueDate = new Date(),
): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: {
        estimatePrefix: true,
        estimateNextNumber: true,
      },
    });

    if (!org) {
      throw new Error("Organization not found.");
    }

    const prefix = (org.estimatePrefix || "EST").trim() || "EST";
    const reserved = org.estimateNextNumber;
    const updated = await tx.organization.updateMany({
      where: {
        id: orgId,
        estimateNextNumber: reserved,
      },
      data: {
        estimateNextNumber: {
          increment: 1,
        },
      },
    });

    if (updated.count === 1) {
      return `${prefix}-${issueDate.getUTCFullYear()}-${String(reserved).padStart(4, "0")}`;
    }
  }

  throw new Error("Failed to reserve estimate number. Try again.");
}

async function recomputeLeadEstimateStats(tx: Prisma.TransactionClient, leadId: string | null) {
  if (!leadId) return;

  const estimates = await tx.estimate.findMany({
    where: {
      leadId,
      archivedAt: null,
    },
    select: {
      id: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  await tx.lead.update({
    where: { id: leadId },
    data: {
      estimateCount: estimates.length,
      latestEstimateId: estimates[0]?.id || null,
    },
  });
}

async function appendEstimateActivity(
  tx: Prisma.TransactionClient,
  input: {
    estimateId: string;
    type: EstimateActivityType;
    actorUserId: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.estimateActivity.create({
    data: {
      estimateId: input.estimateId,
      type: input.type,
      actorUserId: input.actorUserId,
      metadata: input.metadata,
    },
  });
}

async function normalizeEstimatePayload(input: {
  orgId: string;
  payload: EstimatePayload | null;
  existingEstimate?: EstimateRecord | null;
}): Promise<NormalizedEstimatePayload> {
  const payload = input.payload || {};
  const existing = input.existingEstimate || null;
  const fallbackLines = buildExistingLineFallback(existing);
  const rawLeadId =
    payload.leadId === null
      ? null
      : payload.leadId === undefined
        ? existing?.leadId || null
        : normalizeOptionalId(payload.leadId);
  const lead = await resolveEstimateLeadDefaults(input.orgId, rawLeadId);

  const title =
    normalizeOptionalText(payload.title, "Estimate title", ESTIMATE_TITLE_MAX) ||
    existing?.title ||
    lead?.businessType ||
    "Untitled Estimate";
  const customerName =
    normalizeOptionalText(payload.customerName, "Customer name", ESTIMATE_CUSTOMER_NAME_MAX) ||
    existing?.customerName ||
    lead?.contactName ||
    lead?.businessName ||
    null;
  const siteAddress =
    normalizeOptionalText(payload.siteAddress, "Site address", ESTIMATE_SITE_ADDRESS_MAX) ||
    existing?.siteAddress ||
    lead?.intakeLocationText ||
    null;
  const projectType =
    normalizeOptionalText(payload.projectType, "Project type", ESTIMATE_PROJECT_TYPE_MAX) ||
    existing?.projectType ||
    lead?.businessType ||
    null;
  const description =
    normalizeOptionalText(payload.description, "Description", ESTIMATE_DESCRIPTION_MAX) ||
    existing?.description ||
    null;
  const notes =
    normalizeOptionalText(payload.notes, "Notes", ESTIMATE_NOTES_MAX) ||
    existing?.notes ||
    null;
  const terms =
    normalizeOptionalText(payload.terms, "Terms", ESTIMATE_TERMS_MAX) ||
    existing?.terms ||
    null;
  const validUntil =
    payload.validUntil === undefined
      ? existing?.validUntil || null
      : normalizeDate(payload.validUntil, "Valid until");

  const currentStatus = existing?.status || "DRAFT";
  const status = normalizeEstimateStatus(payload.status, currentStatus);
  if (status === "CONVERTED" && currentStatus !== "CONVERTED") {
    throw new AppApiError("Use the convert action to move an estimate into CONVERTED status.", 400);
  }
  if (!canTransitionEstimateStatus(currentStatus, status)) {
    throw new AppApiError(`Cannot change estimate status from ${currentStatus} to ${status}.`, 400);
  }

  const taxRatePercentValue =
    typeof payload.taxRatePercent === "string"
      ? payload.taxRatePercent
      : typeof payload.taxRatePercent === "number"
        ? String(payload.taxRatePercent)
        : existing
          ? decimalToPercentInput(existing.taxRate)
          : "0";
  const taxRate = normalizeEstimateTaxRate(taxRatePercentValue);
  const taxRateSource = normalizeEstimateTaxSource(payload.taxRateSource, existing?.taxRateSource || "MANUAL");
  const siteZipCode = extractEstimateZipCode(siteAddress || "");
  const taxZipCode =
    taxRateSource === "WA_DOR"
      ? normalizeOptionalText(payload.taxZipCode, "Tax ZIP code", 16) ||
        existing?.taxZipCode ||
        siteZipCode ||
        null
      : null;
  const taxJurisdiction =
    taxRateSource === "WA_DOR"
      ? normalizeOptionalText(payload.taxJurisdiction, "Tax jurisdiction", ESTIMATE_TITLE_MAX) ||
        existing?.taxJurisdiction ||
        null
      : null;
  const taxLocationCode =
    taxRateSource === "WA_DOR"
      ? normalizeOptionalText(payload.taxLocationCode, "Tax location code", 40) ||
        existing?.taxLocationCode ||
        null
      : null;
  const taxCalculatedAt =
    taxRateSource === "WA_DOR"
      ? payload.taxCalculatedAt === undefined
        ? existing?.taxCalculatedAt || new Date()
        : normalizeDate(payload.taxCalculatedAt, "Tax calculated at")
      : null;

  if (taxRateSource === "WA_DOR") {
    if (!siteZipCode) {
      throw new AppApiError("Enter a Washington site ZIP code or switch tax to manual.", 400);
    }
    if (taxZipCode && siteZipCode !== taxZipCode) {
      throw new AppApiError("Site ZIP changed. Refresh Auto Tax from ZIP or switch tax back to manual.", 400);
    }
  }

  const rawLineItems = normalizeEstimateLineItems(payload.lineItems, fallbackLines);
  await validateEstimateMaterials(input.orgId, rawLineItems);
  const normalizedLineItems = normalizeEstimateItemRows(rawLineItems);
  const summary = summarizeEstimateItems(
    normalizedLineItems.map((line, index) => ({
      id: String(index),
      materialId: line.materialId,
      type: line.type,
      sortOrder: index,
      name: line.name,
      description: line.description || "",
      quantity: decimalToInput(line.quantity),
      unit: line.unit || "",
      unitPrice: decimalToInput(line.unitPrice),
      total: Number(line.total),
    })),
    taxRatePercentValue,
  );

  return {
    leadId: lead?.id || null,
    title,
    customerName,
    siteAddress,
    projectType,
    description,
    notes,
    terms,
    taxRate,
    taxRateSource,
    taxZipCode,
    taxJurisdiction,
    taxLocationCode,
    taxCalculatedAt,
    subtotal: roundMoney(toMoneyDecimal(summary.subtotal)),
    tax: roundMoney(toMoneyDecimal(summary.tax)),
    total: roundMoney(toMoneyDecimal(summary.total)),
    validUntil,
    status,
    lineItems: normalizedLineItems,
  };
}

async function recomputeEstimateTotals(tx: Prisma.TransactionClient, estimateId: string) {
  const estimate = await tx.estimate.findUnique({
    where: { id: estimateId },
    include: {
      lineItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!estimate) {
    throw new Error("Estimate not found.");
  }

  for (const lineItem of estimate.lineItems) {
    const total = roundMoney(lineItem.quantity.mul(lineItem.unitPrice));
    if (!total.equals(lineItem.total)) {
      await tx.estimateLineItem.update({
        where: { id: lineItem.id },
        data: { total },
      });
    }
  }

  const freshItems = await tx.estimateLineItem.findMany({
    where: { estimateId },
    select: { total: true },
  });

  const subtotal = roundMoney(freshItems.reduce((sum, line) => sum.plus(line.total), ZERO));
  const tax = roundMoney(subtotal.mul(estimate.taxRate));
  const total = roundMoney(subtotal.plus(tax));

  return tx.estimate.update({
    where: { id: estimateId },
    data: {
      subtotal,
      tax,
      total,
    },
    include: estimateDetailInclude,
  });
}

function buildEstimateActivityMetadata(estimate: EstimateRecord) {
  return {
    status: estimate.status,
    total: Number(estimate.total),
    estimateNumber: estimate.estimateNumber,
  };
}

export async function createBlankEstimate(input: {
  orgId: string;
  actorId: string | null;
  title?: string | null;
}) {
  const saved = await prisma.$transaction(async (tx) => {
    const estimateNumber = await reserveNextEstimateNumber(tx, input.orgId);
    const estimate = await tx.estimate.create({
      data: {
        orgId: input.orgId,
        createdByUserId: input.actorId,
        estimateNumber,
        title: input.title?.trim() || "Untitled Estimate",
        validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      include: estimateDetailInclude,
    });

    await appendEstimateActivity(tx, {
      estimateId: estimate.id,
      type: "CREATED",
      actorUserId: input.actorId,
      metadata: {
        estimateNumber,
      },
    });

    return estimate;
  });

  return serializeEstimateDetail(saved);
}

export async function saveEstimate(input: {
  orgId: string;
  actorId: string | null;
  estimateId?: string;
  payload: EstimatePayload | null;
}) {
  const existing = input.estimateId
    ? await prisma.estimate.findFirst({
        where: {
          id: input.estimateId,
          orgId: input.orgId,
        },
        include: estimateDetailInclude,
      })
    : null;

  if (input.estimateId && !existing) {
    throw new AppApiError("Estimate not found.", 404);
  }

  const previousLeadId = existing?.leadId || null;
  const normalized = await normalizeEstimatePayload({
    orgId: input.orgId,
    payload: input.payload,
    existingEstimate: existing,
  });

  const saved = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const estimate =
      existing
        ? await tx.estimate.update({
            where: { id: existing.id },
            data: {
              leadId: normalized.leadId,
              title: normalized.title,
              customerName: normalized.customerName,
              siteAddress: normalized.siteAddress,
              projectType: normalized.projectType,
              description: normalized.description,
              notes: normalized.notes,
              terms: normalized.terms,
              taxRate: normalized.taxRate,
              taxRateSource: normalized.taxRateSource,
              taxZipCode: normalized.taxZipCode,
              taxJurisdiction: normalized.taxJurisdiction,
              taxLocationCode: normalized.taxLocationCode,
              taxCalculatedAt: normalized.taxCalculatedAt,
              subtotal: normalized.subtotal,
              tax: normalized.tax,
              total: normalized.total,
              validUntil: normalized.validUntil,
              status: normalized.status,
              sentAt: normalized.status === "SENT" ? existing.sentAt || now : existing.sentAt,
              viewedAt: normalized.status === "VIEWED" ? existing.viewedAt || now : existing.viewedAt,
              approvedAt: normalized.status === "APPROVED" ? existing.approvedAt || now : existing.approvedAt,
              declinedAt: normalized.status === "DECLINED" ? existing.declinedAt || now : existing.declinedAt,
            },
            include: estimateDetailInclude,
          })
        : await tx.estimate.create({
            data: {
              orgId: input.orgId,
              createdByUserId: input.actorId,
              estimateNumber: await reserveNextEstimateNumber(tx, input.orgId),
              leadId: normalized.leadId,
              title: normalized.title,
              customerName: normalized.customerName,
              siteAddress: normalized.siteAddress,
              projectType: normalized.projectType,
              description: normalized.description,
              notes: normalized.notes,
              terms: normalized.terms,
              taxRate: normalized.taxRate,
              taxRateSource: normalized.taxRateSource,
              taxZipCode: normalized.taxZipCode,
              taxJurisdiction: normalized.taxJurisdiction,
              taxLocationCode: normalized.taxLocationCode,
              taxCalculatedAt: normalized.taxCalculatedAt,
              subtotal: normalized.subtotal,
              tax: normalized.tax,
              total: normalized.total,
              validUntil: normalized.validUntil,
              status: normalized.status,
              sentAt: normalized.status === "SENT" ? now : null,
              viewedAt: normalized.status === "VIEWED" ? now : null,
              approvedAt: normalized.status === "APPROVED" ? now : null,
              declinedAt: normalized.status === "DECLINED" ? now : null,
            },
            include: estimateDetailInclude,
          });

    await tx.estimateLineItem.deleteMany({
      where: { estimateId: estimate.id },
    });

    if (normalized.lineItems.length > 0) {
      await tx.estimateLineItem.createMany({
        data: normalized.lineItems.map((line) => ({
          estimateId: estimate.id,
          materialId: line.materialId,
          type: line.type,
          sortOrder: line.sortOrder,
          name: line.name,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          total: line.total,
        })),
      });
    }

    await appendEstimateActivity(tx, {
      estimateId: estimate.id,
      type: existing
        ? existing.status !== normalized.status
          ? resolveActivityTypeForStatus(normalized.status)
          : "UPDATED"
        : "CREATED",
      actorUserId: input.actorId,
      metadata: buildEstimateActivityMetadata(estimate),
    });

    await recomputeLeadEstimateStats(tx, previousLeadId);
    await recomputeLeadEstimateStats(tx, normalized.leadId);

    const reloaded = await tx.estimate.findUnique({
      where: { id: estimate.id },
      include: estimateDetailInclude,
    });

    if (!reloaded) {
      throw new Error("Failed to reload estimate.");
    }

    return reloaded;
  });

  return serializeEstimateDetail(saved);
}

export async function getEstimateForOrg(input: {
  orgId: string;
  estimateId: string;
}) {
  return prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
    },
    include: estimateDetailInclude,
  });
}

export async function getEstimateReferencesForOrg(orgId: string): Promise<{
  leads: EstimateReferenceLead[];
  materials: MaterialListItem[];
}> {
  const [leads, materials] = await Promise.all([
    prisma.lead.findMany({
      where: { orgId },
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
    prisma.material.findMany({
      where: {
        orgId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        baseCost: true,
        markupPercent: true,
        sellPrice: true,
        notes: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 300,
    }),
  ]);

  return {
    leads: leads.map((lead) => ({
      id: lead.id,
      label: lead.contactName || lead.businessName || lead.phoneE164,
      customerName: lead.contactName || lead.businessName || "",
      phoneE164: lead.phoneE164,
    })),
    materials: materials.map((material) => ({
      id: material.id,
      name: material.name,
      category: material.category,
      unit: material.unit,
      baseCost: roundMaterialNumber(Number(material.baseCost)),
      markupPercent: roundMaterialNumber(Number(material.markupPercent)),
      sellPrice: roundMaterialNumber(Number(material.sellPrice)),
      notes: material.notes,
      active: material.active,
      createdAt: material.createdAt.toISOString(),
      updatedAt: material.updatedAt.toISOString(),
    })),
  };
}

export async function addEstimateLineItem(input: {
  orgId: string;
  estimateId: string;
  actorId: string | null;
  payload: EstimateItemPayload | null;
}) {
  const estimate = await prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
      archivedAt: null,
    },
    include: {
      lineItems: {
        orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });

  if (!estimate) {
    throw new AppApiError("Estimate not found.", 404);
  }

  if (estimate.status === "CONVERTED") {
    throw new AppApiError("Converted estimates cannot be edited.", 400);
  }

  const payload = input.payload || {};
  const materialId = normalizeOptionalId(payload.materialId);
  let material: { id: string; name: string; unit: string; sellPrice: number; notes: string | null } | null = null;
  if (materialId) {
    material = await prisma.material.findFirst({
      where: {
        id: materialId,
        orgId: input.orgId,
      },
      select: {
        id: true,
        name: true,
        unit: true,
        sellPrice: true,
        notes: true,
      },
    });

    if (!material) {
      throw new AppApiError("Material not found for this organization.", 400);
    }
  }

  const type = material ? "MATERIAL" : normalizeLineType(payload.type);
  const sortOrder = (estimate.lineItems[0]?.sortOrder || 0) + 1;
  const name =
    normalizeOptionalText(payload.name, "Line item name", ESTIMATE_LINE_DESCRIPTION_MAX) ||
    material?.name ||
    (type === "LABOR" ? "Labor" : "New Line Item");
  const description =
    normalizeOptionalText(payload.description, "Line item description", ESTIMATE_DESCRIPTION_MAX) ||
    material?.notes ||
    null;
  const quantity = normalizeNonNegativeDecimal(payload.quantity ?? "1", "Line item quantity");
  const unit =
    normalizeOptionalText(payload.unit, "Line item unit", ESTIMATE_LINE_UNIT_MAX) ||
    material?.unit ||
    (type === "LABOR" ? "hours" : "each");
  const unitPrice = normalizeNonNegativeDecimal(
    payload.unitPrice ?? (material ? String(material.sellPrice) : "0"),
    "Line item unit price",
  );
  const total = roundMoney(quantity.mul(unitPrice));

  const saved = await prisma.$transaction(async (tx) => {
    await tx.estimateLineItem.create({
      data: {
        estimateId: estimate.id,
        materialId: material?.id || null,
        type,
        sortOrder,
        name,
        description,
        quantity,
        unit,
        unitPrice,
        total,
      },
    });

    await appendEstimateActivity(tx, {
      estimateId: estimate.id,
      type: "ITEM_ADDED",
      actorUserId: input.actorId,
      metadata: {
        name,
        type,
      },
    });

    return recomputeEstimateTotals(tx, estimate.id);
  });

  return serializeEstimateDetail(saved);
}

export async function archiveEstimate(input: {
  orgId: string;
  estimateId: string;
  actorId: string | null;
}) {
  const existing = await prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      leadId: true,
      archivedAt: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Estimate not found.", 404);
  }

  const archived = await prisma.$transaction(async (tx) => {
    const estimate = await tx.estimate.update({
      where: { id: existing.id },
      data: {
        archivedAt: existing.archivedAt || new Date(),
      },
      include: estimateDetailInclude,
    });

    await appendEstimateActivity(tx, {
      estimateId: estimate.id,
      type: "ARCHIVED",
      actorUserId: input.actorId,
      metadata: {
        archivedAt: estimate.archivedAt?.toISOString() || null,
      },
    });

    await recomputeLeadEstimateStats(tx, existing.leadId);
    return estimate;
  });

  return serializeEstimateDetail(archived);
}

export async function markEstimateSent(input: {
  orgId: string;
  estimateId: string;
  actorId: string | null;
  note?: string | null;
}) {
  const existing = await prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
      archivedAt: null,
    },
    include: estimateDetailInclude,
  });

  if (!existing) {
    throw new AppApiError("Estimate not found.", 404);
  }

  if (existing.status === "CONVERTED" || existing.status === "APPROVED") {
    throw new AppApiError("This estimate is no longer sendable from the internal portal flow.", 400);
  }

  const sent = await prisma.$transaction(async (tx) => {
    const estimate = await tx.estimate.update({
      where: { id: existing.id },
      data: {
        status: "SENT",
        sentAt: existing.sentAt || new Date(),
      },
      include: estimateDetailInclude,
    });

    await appendEstimateActivity(tx, {
      estimateId: estimate.id,
      type: "SENT",
      actorUserId: input.actorId,
      metadata: {
        mode: "manual-share",
        note: input.note || null,
      },
    });

    return estimate;
  });

  return serializeEstimateDetail(sent);
}

async function resolveCustomerForEstimateConversion(input: {
  tx: Prisma.TransactionClient;
  estimate: EstimateRecord;
  actorId: string | null;
}) {
  if (!input.estimate.leadId) {
    throw new AppApiError("Attach a lead before sending this estimate into dispatch or invoicing.", 400);
  }

  const lead = await input.tx.lead.findUnique({
    where: { id: input.estimate.leadId },
    select: {
      id: true,
      orgId: true,
      customerId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      intakeLocationText: true,
    },
  });

  if (!lead) {
    throw new AppApiError("The linked lead no longer exists.", 400);
  }

  if (lead.customerId) {
    return {
      customerId: lead.customerId,
      leadId: lead.id,
      phoneE164: lead.phoneE164,
    };
  }

  const customer = await input.tx.customer.create({
    data: {
      orgId: lead.orgId,
      createdByUserId: input.actorId,
      name: input.estimate.customerName || lead.contactName || lead.businessName || input.estimate.title,
      phoneE164: lead.phoneE164,
      addressLine: input.estimate.siteAddress || lead.intakeLocationText || null,
    },
    select: { id: true },
  });

  await input.tx.lead.update({
    where: { id: lead.id },
    data: {
      customerId: customer.id,
    },
  });

  return {
    customerId: customer.id,
    leadId: lead.id,
    phoneE164: lead.phoneE164,
  };
}

function buildInvoiceLineDescription(line: {
  name: string;
  description: string | null;
}) {
  return line.description ? `${line.name} - ${line.description}` : line.name;
}

export async function convertEstimate(input: {
  orgId: string;
  estimateId: string;
  actorId: string | null;
  createJob?: boolean;
  createInvoice?: boolean;
  dispatchDate?: string | null;
}) {
  if (!input.createJob && !input.createInvoice) {
    throw new AppApiError("Choose at least one conversion target.", 400);
  }

  const existing = await prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
      archivedAt: null,
    },
    include: estimateDetailInclude,
  });

  if (!existing) {
    throw new AppApiError("Estimate not found.", 404);
  }

  if (existing.status !== "APPROVED") {
    throw new AppApiError("Only approved estimates can be converted.", 400);
  }

  if (existing.lineItems.length === 0) {
    throw new AppApiError("Add at least one line item before converting this estimate.", 400);
  }

  const dispatchDateKey = input.createJob ? normalizeDispatchDateKey(input.dispatchDate || null) || getDispatchTodayDateKey() : null;
  const dispatchDate = dispatchDateKey ? parseDispatchDateKey(dispatchDateKey) : null;
  if (input.createJob && (!dispatchDateKey || !dispatchDate)) {
    throw new AppApiError("Dispatch date is invalid.", 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    let createdJobId: string | null = null;
    let createdInvoiceId: string | null = null;
    const dispatchEvents: DispatchPersistedJobEvent[] = [];
    const resolvedCustomer =
      input.createJob || input.createInvoice
        ? await resolveCustomerForEstimateConversion({
            tx,
            estimate: existing,
            actorId: input.actorId,
          })
        : null;

    if (input.createJob) {
      const jobStatus: JobStatus = "DRAFT";
      const job = await tx.job.create({
        data: {
          orgId: existing.orgId,
          createdByUserId: input.actorId,
          customerId: resolvedCustomer?.customerId || null,
          leadId: resolvedCustomer?.leadId || existing.leadId || null,
          sourceEstimateId: existing.id,
          linkedEstimateId: existing.id,
          customerName: existing.customerName || existing.lead?.contactName || existing.lead?.businessName || existing.title,
          phone: resolvedCustomer?.phoneE164 || existing.lead?.phoneE164 || null,
          address: existing.siteAddress || "",
          serviceType: existing.projectType || "Project",
          projectType: existing.projectType || "Project",
          scheduledDate: dispatchDate,
          dispatchStatus: "SCHEDULED",
          notes: [existing.description, existing.notes].filter(Boolean).join("\n\n") || null,
          status: jobStatus,
        },
        select: { id: true },
      });
      createdJobId = job.id;

      const materialLines = existing.lineItems.filter((line) => line.type !== "LABOR");
      const laborLines = existing.lineItems.filter((line) => line.type === "LABOR");

      if (materialLines.length > 0) {
        await tx.jobMaterial.createMany({
          data: materialLines.map((line) => ({
            orgId: existing.orgId,
            jobId: job.id,
            materialId: line.materialId,
            name: line.name,
            quantity: line.quantity,
            unit: line.unit,
            cost: line.unitPrice,
            markupPercent: ZERO,
            total: line.total,
            notes: line.description,
          })),
        });
      }

      if (laborLines.length > 0) {
        await tx.jobLabor.createMany({
          data: laborLines.map((line) => ({
            orgId: existing.orgId,
            jobId: job.id,
            description: line.name,
            quantity: line.quantity,
            unit: line.unit,
            cost: line.unitPrice,
            markupPercent: ZERO,
            total: line.total,
            notes: line.description,
          })),
        });
      }

      await appendEstimateActivity(tx, {
        estimateId: existing.id,
        type: "CONVERTED_TO_JOB",
        actorUserId: input.actorId,
        metadata: {
          jobId: job.id,
        },
      });

      const dispatchEvent = await tx.jobEvent.create({
        data: {
          orgId: existing.orgId,
          jobId: job.id,
          actorUserId: input.actorId,
          eventType: "JOB_CREATED",
          metadata: {
            source: "dispatch",
            origin: "estimate_conversion",
            customerId: resolvedCustomer?.customerId || null,
            leadId: resolvedCustomer?.leadId || existing.leadId || null,
            linkedEstimateId: existing.id,
            scheduledDate: dispatchDateKey,
            scheduledStartTime: null,
            scheduledEndTime: null,
            status: "scheduled",
            statusLabel: formatDispatchStatusLabel("scheduled"),
            assignedCrewId: null,
            assignedCrewName: null,
          },
        },
        select: {
          id: true,
          eventType: true,
          fromValue: true,
          toValue: true,
          createdAt: true,
        },
      });
      dispatchEvents.push(dispatchEvent);
    }

    if (input.createInvoice) {
      if (!resolvedCustomer) {
        throw new AppApiError("Customer conversion data is unavailable.", 500);
      }
      const issueDate = new Date();
      const dueDate = computeInvoiceDueDate(issueDate, DEFAULT_INVOICE_TERMS);
      const invoiceNumber = await reserveNextInvoiceNumber(tx, existing.orgId, issueDate);
      const invoice = await tx.invoice.create({
        data: {
          orgId: existing.orgId,
          jobId: resolvedCustomer.leadId,
          sourceEstimateId: existing.id,
          sourceJobId: createdJobId || existing.jobId || null,
          customerId: resolvedCustomer.customerId,
          invoiceNumber,
          status: "DRAFT",
          issueDate,
          dueDate,
          notes: [existing.notes, existing.terms].filter(Boolean).join("\n\n") || null,
          createdByUserId: input.actorId,
          taxRate: existing.taxRate,
          subtotal: existing.subtotal,
          taxAmount: existing.tax,
          total: existing.total,
          balanceDue: existing.total,
        },
        select: { id: true },
      });
      createdInvoiceId = invoice.id;

      await tx.invoiceLineItem.createMany({
        data: existing.lineItems.map((line) => ({
          invoiceId: invoice.id,
          description: buildInvoiceLineDescription(line),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.total,
          sortOrder: line.sortOrder,
        })),
      });

      await recomputeInvoiceTotals(tx, invoice.id);

      await appendEstimateActivity(tx, {
        estimateId: existing.id,
        type: "CONVERTED_TO_INVOICE",
        actorUserId: input.actorId,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber,
        },
      });
    }

    const converted = await tx.estimate.update({
      where: { id: existing.id },
      data: {
        status: "CONVERTED",
        jobId: createdJobId || existing.jobId,
      },
      include: estimateDetailInclude,
    });

    return {
      estimate: converted,
      jobId: createdJobId,
      invoiceId: createdInvoiceId,
      dispatchDate: dispatchDateKey,
      dispatchEvents,
    };
  });

  if (result.jobId && result.dispatchEvents.length > 0) {
    await maybeSendDispatchCustomerNotifications({
      orgId: input.orgId,
      jobId: result.jobId,
      actorUserId: input.actorId,
      events: result.dispatchEvents,
    });
  }

  return {
    estimate: serializeEstimateDetail(result.estimate),
    jobId: result.jobId,
    invoiceId: result.invoiceId,
    dispatchDate: result.dispatchDate,
  };
}

export function buildEstimateListWhere(input: {
  orgId: string;
  query: string;
  statusValues: EstimateStatus[];
  includeArchived: boolean;
}): Prisma.EstimateWhereInput {
  return {
    orgId: input.orgId,
    ...(input.includeArchived ? {} : { archivedAt: null }),
    ...(input.statusValues.length > 0 ? { status: { in: input.statusValues } } : {}),
    ...(input.query
      ? {
          OR: [
            { estimateNumber: { contains: input.query, mode: "insensitive" } },
            { title: { contains: input.query, mode: "insensitive" } },
            { customerName: { contains: input.query, mode: "insensitive" } },
            { siteAddress: { contains: input.query, mode: "insensitive" } },
            { projectType: { contains: input.query, mode: "insensitive" } },
            { lead: { contactName: { contains: input.query, mode: "insensitive" } } },
            { lead: { businessName: { contains: input.query, mode: "insensitive" } } },
            { lead: { phoneE164: { contains: input.query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}
