import { Prisma, type EstimateDraftLineType, type EstimateStatus, type EstimateTaxSource } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-error";
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
  summarizeEstimateItems,
  type EstimateItemRow,
} from "@/lib/estimates";
import { roundMoney, toMoneyDecimal } from "@/lib/invoices";

export type EstimatePayload = {
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

export type EstimateItemPayload = {
  materialId?: unknown;
  type?: unknown;
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
};

export type NormalizedEstimateItem = {
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

export type NormalizedEstimatePayload = {
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

export type EstimateExistingLineFallbackItem = {
  id: string;
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

export function normalizeOptionalText(value: unknown, label: string, maxLength: number): string | null {
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

export function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeEstimateStatus(value: unknown, fallback: EstimateStatus): EstimateStatus {
  if (estimateStatusOptions.includes(value as EstimateStatus)) {
    return value as EstimateStatus;
  }
  return fallback;
}

export function normalizeEstimateTaxSource(value: unknown, fallback: EstimateTaxSource): EstimateTaxSource {
  if (value === "WA_DOR" || value === "MANUAL") {
    return value;
  }
  return fallback;
}

export function normalizeLineType(value: unknown): EstimateDraftLineType {
  if (estimateDraftLineTypeOptions.includes(value as EstimateDraftLineType)) {
    return value as EstimateDraftLineType;
  }
  return "CUSTOM_MATERIAL";
}

export function normalizeNonNegativeDecimal(value: unknown, label: string): Prisma.Decimal {
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

export function normalizeDate(value: unknown, label: string): Date | null {
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

export function decimalToInput(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function decimalToPercentInput(value: Prisma.Decimal): string {
  return value.mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString();
}

export function normalizeEstimateLineItems(value: unknown, fallback: EstimateItemRow[]): EstimateItemRow[] {
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

export function normalizeEstimateItemRows(input: EstimateItemRow[]): NormalizedEstimateItem[] {
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

export function buildExistingLineFallback(
  lineItems: EstimateExistingLineFallbackItem[] | null | undefined,
): EstimateItemRow[] {
  if (!lineItems) return [];

  return lineItems.map((line) => ({
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

export function resolveActivityTypeForStatus(
  status: EstimateStatus,
): "STATUS_CHANGED" | "SENT" | "VIEWED" | "APPROVED" | "DECLINED" {
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

export function buildEstimateActivityMetadata(input: {
  status: EstimateStatus;
  total: Prisma.Decimal;
  estimateNumber: string;
}) {
  return {
    status: input.status,
    total: Number(input.total),
    estimateNumber: input.estimateNumber,
  };
}

export function buildInvoiceLineDescription(line: {
  name: string;
  description: string | null;
}) {
  return line.description ? `${line.name} - ${line.description}` : line.name;
}

export function mergeJobNotes(...parts: Array<string | null | undefined>) {
  const unique = new Set<string>();
  for (const part of parts) {
    const trimmed = part?.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return unique.size > 0 ? [...unique].join("\n\n") : null;
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

export function normalizeEstimatePayloadCore(input: {
  payload: EstimatePayload | null;
  existingEstimate: {
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
  } | null;
  leadDefaults: {
    id: string;
    contactName: string | null;
    businessName: string | null;
    businessType: string | null;
    intakeLocationText: string | null;
  } | null;
  lineItemInputs: EstimateItemRow[];
  siteZipCode: string | null;
}): NormalizedEstimatePayload {
  const payload = input.payload || {};
  const existing = input.existingEstimate || null;
  const lead = input.leadDefaults;

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
  const taxZipCode =
    taxRateSource === "WA_DOR"
      ? normalizeOptionalText(payload.taxZipCode, "Tax ZIP code", 16) ||
        existing?.taxZipCode ||
        input.siteZipCode ||
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
    if (!input.siteZipCode) {
      throw new AppApiError("Enter a Washington site ZIP code or switch tax to manual.", 400);
    }
    if (taxZipCode && input.siteZipCode !== taxZipCode) {
      throw new AppApiError("Site ZIP changed. Refresh Auto Tax from ZIP or switch tax back to manual.", 400);
    }
  }

  const normalizedLineItems = normalizeEstimateItemRows(input.lineItemInputs);
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
