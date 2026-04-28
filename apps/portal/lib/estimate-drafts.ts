import "server-only";

import { Prisma, type EstimateDraftLineType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ESTIMATE_CUSTOMER_NAME_MAX,
  ESTIMATE_LINE_DESCRIPTION_MAX,
  ESTIMATE_LINE_UNIT_MAX,
  ESTIMATE_MAX_LINES,
  ESTIMATE_NOTES_MAX,
  ESTIMATE_PROJECT_NAME_MAX,
  ESTIMATE_PROJECT_TYPE_MAX,
  ESTIMATE_SITE_ADDRESS_MAX,
  estimateDraftLineTypeOptions,
  normalizeEstimateTaxRate,
  serializeEstimateDraft,
  summarizeEstimateLines,
  type EstimateBuilderLineItem,
} from "@/lib/estimates";
import { roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { AppApiError } from "@/lib/app-api-permissions";

export const estimateDraftInclude = {
  lineItems: true,
} satisfies Prisma.EstimateDraftInclude;

export type EstimateDraftDetailRecord = Prisma.EstimateDraftGetPayload<{
  include: typeof estimateDraftInclude;
}>;

type EstimateDraftPayload = {
  projectName?: unknown;
  customerName?: unknown;
  siteAddress?: unknown;
  projectType?: unknown;
  notes?: unknown;
  taxRatePercent?: unknown;
  lineItems?: unknown;
};

type NormalizedEstimateLine = {
  materialId: string | null;
  type: EstimateDraftLineType;
  description: string;
  quantity: Prisma.Decimal;
  unit: string | null;
  unitCost: Prisma.Decimal;
  markupPercent: Prisma.Decimal;
  lineCostTotal: Prisma.Decimal;
  lineSellTotal: Prisma.Decimal;
  sortOrder: number;
};

type NormalizedEstimateDraftPayload = {
  projectName: string;
  customerName: string | null;
  siteAddress: string | null;
  projectType: string | null;
  notes: string | null;
  taxRate: Prisma.Decimal;
  materialsTotal: Prisma.Decimal;
  laborTotal: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  finalTotal: Prisma.Decimal;
  lineItems: NormalizedEstimateLine[];
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

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be text.`, 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }
  return trimmed;
}

function normalizeOptionalMaterialId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

function normalizeQuantityDecimal(value: unknown): Prisma.Decimal {
  const decimal = normalizeNonNegativeDecimal(value, "Quantity");
  return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function decimalToFixedString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export async function normalizeEstimateDraftPayload(
  orgId: string,
  payload: EstimateDraftPayload | null,
): Promise<NormalizedEstimateDraftPayload> {
  if (!payload) {
    throw new AppApiError("Invalid JSON payload.", 400);
  }

  const projectName = normalizeRequiredText(payload.projectName, "Project name", ESTIMATE_PROJECT_NAME_MAX);
  const customerName = normalizeOptionalText(payload.customerName, "Customer name", ESTIMATE_CUSTOMER_NAME_MAX);
  const siteAddress = normalizeOptionalText(payload.siteAddress, "Site address", ESTIMATE_SITE_ADDRESS_MAX);
  const projectType = normalizeOptionalText(payload.projectType, "Project type", ESTIMATE_PROJECT_TYPE_MAX);
  const notes = normalizeOptionalText(payload.notes, "Notes", ESTIMATE_NOTES_MAX);
  const taxRatePercentValue =
    typeof payload.taxRatePercent === "string"
      ? payload.taxRatePercent
      : typeof payload.taxRatePercent === "number"
        ? String(payload.taxRatePercent)
        : "";
  const taxRate = normalizeEstimateTaxRate(taxRatePercentValue);

  if (!Array.isArray(payload.lineItems)) {
    throw new AppApiError("lineItems must be an array.", 400);
  }
  if (payload.lineItems.length > ESTIMATE_MAX_LINES) {
    throw new AppApiError(`Estimate drafts support up to ${ESTIMATE_MAX_LINES} line items.`, 400);
  }

  const clientLines: EstimateBuilderLineItem[] = payload.lineItems.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: typeof row.id === "string" ? row.id : "",
      materialId: normalizeOptionalMaterialId(row.materialId),
      type: normalizeLineType(row.type),
      description: typeof row.description === "string" ? row.description : "",
      quantity: typeof row.quantity === "string" ? row.quantity : typeof row.quantity === "number" ? String(row.quantity) : "0",
      unit: typeof row.unit === "string" ? row.unit : "",
      unitCost:
        typeof row.unitCost === "string" ? row.unitCost : typeof row.unitCost === "number" ? String(row.unitCost) : "0",
      markupPercent:
        typeof row.markupPercent === "string"
          ? row.markupPercent
          : typeof row.markupPercent === "number"
            ? String(row.markupPercent)
            : "0",
      lineCostTotal: 0,
      lineSellTotal: 0,
    };
  });

  const materialIds = [...new Set(clientLines.map((line) => line.materialId).filter(Boolean))] as string[];
  if (materialIds.length > 0) {
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

  const normalizedLines = clientLines.map((line, index) => {
    const description = normalizeRequiredText(line.description, "Line item description", ESTIMATE_LINE_DESCRIPTION_MAX);
    const unit = normalizeOptionalText(line.unit, "Line item unit", ESTIMATE_LINE_UNIT_MAX);
    const quantity = normalizeQuantityDecimal(line.quantity);
    const unitCost = normalizeNonNegativeDecimal(line.unitCost, "Line item cost");
    const markupPercent = normalizeNonNegativeDecimal(line.markupPercent, "Line item markup");
    const lineCostTotal = roundMoney(quantity.mul(unitCost));
    const markupAmount = roundMoney(lineCostTotal.mul(markupPercent).div(100));
    const lineSellTotal = roundMoney(lineCostTotal.plus(markupAmount));

    return {
      materialId: line.materialId,
      type: line.type,
      description,
      quantity,
      unit,
      unitCost,
      markupPercent,
      lineCostTotal,
      lineSellTotal,
      sortOrder: index,
    };
  });

  const summary = summarizeEstimateLines(
    normalizedLines.map((line, index) => ({
      id: String(index),
      materialId: line.materialId,
      type: line.type,
      description: line.description,
      quantity: decimalToFixedString(line.quantity),
      unit: line.unit || "",
      unitCost: decimalToFixedString(line.unitCost),
      markupPercent: decimalToFixedString(line.markupPercent),
      lineCostTotal: Number(line.lineCostTotal),
      lineSellTotal: Number(line.lineSellTotal),
    })),
    taxRatePercentValue,
  );

  return {
    projectName,
    customerName,
    siteAddress,
    projectType,
    notes,
    taxRate,
    materialsTotal: roundMoney(toMoneyDecimal(summary.materialsTotal)),
    laborTotal: roundMoney(toMoneyDecimal(summary.laborTotal)),
    subtotal: roundMoney(toMoneyDecimal(summary.subtotal)),
    taxAmount: roundMoney(toMoneyDecimal(summary.taxAmount)),
    finalTotal: roundMoney(toMoneyDecimal(summary.finalTotal)),
    lineItems: normalizedLines,
  };
}

export async function saveEstimateDraft(input: {
  orgId: string;
  actorId: string | null;
  draftId?: string;
  payload: EstimateDraftPayload | null;
}): Promise<ReturnType<typeof serializeEstimateDraft>> {
  const normalized = await normalizeEstimateDraftPayload(input.orgId, input.payload);

  const saved = await prisma.$transaction(async (tx) => {
    const draft =
      input.draftId
        ? await tx.estimateDraft.update({
            where: { id: input.draftId },
            data: {
              projectName: normalized.projectName,
              customerName: normalized.customerName,
              siteAddress: normalized.siteAddress,
              projectType: normalized.projectType,
              notes: normalized.notes,
              taxRate: normalized.taxRate,
              materialsTotal: normalized.materialsTotal,
              laborTotal: normalized.laborTotal,
              subtotal: normalized.subtotal,
              taxAmount: normalized.taxAmount,
              finalTotal: normalized.finalTotal,
            },
            include: estimateDraftInclude,
          })
        : await tx.estimateDraft.create({
            data: {
              orgId: input.orgId,
              createdByUserId: input.actorId,
              projectName: normalized.projectName,
              customerName: normalized.customerName,
              siteAddress: normalized.siteAddress,
              projectType: normalized.projectType,
              notes: normalized.notes,
              taxRate: normalized.taxRate,
              materialsTotal: normalized.materialsTotal,
              laborTotal: normalized.laborTotal,
              subtotal: normalized.subtotal,
              taxAmount: normalized.taxAmount,
              finalTotal: normalized.finalTotal,
            },
            include: estimateDraftInclude,
          });

    await tx.estimateDraftLineItem.deleteMany({
      where: {
        estimateDraftId: draft.id,
      },
    });

    if (normalized.lineItems.length > 0) {
      await tx.estimateDraftLineItem.createMany({
        data: normalized.lineItems.map((line) => ({
          estimateDraftId: draft.id,
          materialId: line.materialId,
          type: line.type,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitCost: line.unitCost,
          markupPercent: line.markupPercent,
          lineCostTotal: line.lineCostTotal,
          lineSellTotal: line.lineSellTotal,
          sortOrder: line.sortOrder,
        })),
      });
    }

    return tx.estimateDraft.findUnique({
      where: { id: draft.id },
      include: estimateDraftInclude,
    });
  });

  if (!saved) {
    throw new Error("Failed to save estimate draft.");
  }

  return serializeEstimateDraft(saved);
}

export async function getEstimateDraftForOrg(input: {
  draftId: string;
  orgId: string;
}) {
  return prisma.estimateDraft.findFirst({
    where: {
      id: input.draftId,
      orgId: input.orgId,
    },
    include: estimateDraftInclude,
  });
}
