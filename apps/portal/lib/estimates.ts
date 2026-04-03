import type {
  CalendarAccessRole,
  EstimateActivityType,
  EstimateDraftLineType,
  EstimateStatus,
  EstimateTaxSource,
  Prisma,
} from "@prisma/client";
import { calculateMaterialSellPrice, roundMaterialNumber, type MaterialListItem } from "@/lib/materials";
import { formatCurrency, parseTaxRatePercent, roundMoney, taxRateToPercent, toMoneyDecimal } from "@/lib/invoices";

export const ESTIMATE_PROJECT_NAME_MAX = 160;
export const ESTIMATE_CUSTOMER_NAME_MAX = 160;
export const ESTIMATE_SITE_ADDRESS_MAX = 240;
export const ESTIMATE_PROJECT_TYPE_MAX = 160;
export const ESTIMATE_NOTES_MAX = 4000;
export const ESTIMATE_LINE_DESCRIPTION_MAX = 200;
export const ESTIMATE_LINE_UNIT_MAX = 40;
export const ESTIMATE_MAX_LINES = 200;

export const estimateDraftLineTypeOptions: EstimateDraftLineType[] = ["MATERIAL", "CUSTOM_MATERIAL", "LABOR"];

export type EstimateBuilderLineItem = {
  id: string;
  materialId: string | null;
  type: EstimateDraftLineType;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  markupPercent: string;
  lineCostTotal: number;
  lineSellTotal: number;
};

export type EstimateDraftDetail = {
  id: string;
  projectName: string;
  customerName: string;
  siteAddress: string;
  projectType: string;
  notes: string;
  taxRatePercent: string;
  materialsTotal: number;
  laborTotal: number;
  subtotal: number;
  taxAmount: number;
  finalTotal: number;
  lineItems: EstimateBuilderLineItem[];
  createdAt: string;
  updatedAt: string;
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseInputNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return roundMaterialNumber(parsed);
}

export function canManageEstimateDrafts(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole !== "READ_ONLY";
}

export function createEmptyEstimateLine(type: EstimateDraftLineType = "CUSTOM_MATERIAL"): EstimateBuilderLineItem {
  return {
    id: createId("estimate-line"),
    materialId: null,
    type,
    description: "",
    quantity: "1",
    unit: type === "LABOR" ? "hours" : "each",
    unitCost: "0.00",
    markupPercent: "0",
    lineCostTotal: 0,
    lineSellTotal: 0,
  };
}

export function createEstimateLineFromMaterial(material: MaterialListItem): EstimateBuilderLineItem {
  return {
    id: createId("material-line"),
    materialId: material.id,
    type: "MATERIAL",
    description: material.name,
    quantity: "1",
    unit: material.unit,
    unitCost: material.baseCost.toFixed(2),
    markupPercent: material.markupPercent.toFixed(2),
    lineCostTotal: roundMaterialNumber(material.baseCost),
    lineSellTotal: roundMaterialNumber(calculateMaterialSellPrice(material.baseCost, material.markupPercent)),
  };
}

export function computeEstimateLine(input: {
  quantity: string;
  unitCost: string;
  markupPercent: string;
}): {
  lineCostTotal: number;
  lineSellTotal: number;
  markupAmount: number;
} {
  const quantity = parseInputNumber(input.quantity);
  const unitCost = parseInputNumber(input.unitCost);
  const markupPercent = parseInputNumber(input.markupPercent);
  const lineCostTotal = roundMaterialNumber(quantity * unitCost);
  const markupAmount = roundMaterialNumber(lineCostTotal * (markupPercent / 100));
  const lineSellTotal = roundMaterialNumber(lineCostTotal + markupAmount);

  return {
    lineCostTotal,
    lineSellTotal,
    markupAmount,
  };
}

export function summarizeEstimateLines(lines: EstimateBuilderLineItem[], taxRatePercent: string): {
  materialsTotal: number;
  laborTotal: number;
  subtotal: number;
  taxAmount: number;
  finalTotal: number;
} {
  const materialsTotal = roundMaterialNumber(
    lines
      .filter((line) => line.type === "MATERIAL" || line.type === "CUSTOM_MATERIAL")
      .reduce((sum, line) => sum + line.lineSellTotal, 0),
  );

  const laborTotal = roundMaterialNumber(
    lines.filter((line) => line.type === "LABOR").reduce((sum, line) => sum + line.lineSellTotal, 0),
  );

  const subtotal = roundMaterialNumber(materialsTotal + laborTotal);
  const taxRate = parseInputNumber(taxRatePercent) / 100;
  const taxAmount = roundMaterialNumber(subtotal * taxRate);
  const finalTotal = roundMaterialNumber(subtotal + taxAmount);

  return {
    materialsTotal,
    laborTotal,
    subtotal,
    taxAmount,
    finalTotal,
  };
}

export function formatEstimateCurrency(value: number): string {
  return formatCurrency(value);
}

export function normalizeEstimateTypeLabel(type: EstimateDraftLineType): string {
  if (type === "LABOR") return "Labor";
  if (type === "CUSTOM_MATERIAL") return "Custom Material";
  return "Catalog Material";
}

export function serializeEstimateDraft(
  draft: Prisma.EstimateDraftGetPayload<{
    include: {
      lineItems: true;
    };
  }>,
): EstimateDraftDetail {
  return {
    id: draft.id,
    projectName: draft.projectName,
    customerName: draft.customerName || "",
    siteAddress: draft.siteAddress || "",
    projectType: draft.projectType || "",
    notes: draft.notes || "",
    taxRatePercent: taxRateToPercent(draft.taxRate),
    materialsTotal: Number(draft.materialsTotal),
    laborTotal: Number(draft.laborTotal),
    subtotal: Number(draft.subtotal),
    taxAmount: Number(draft.taxAmount),
    finalTotal: Number(draft.finalTotal),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    lineItems: draft.lineItems
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((line) => ({
        id: line.id,
        materialId: line.materialId,
        type: line.type,
        description: line.description,
        quantity: Number(line.quantity).toFixed(2).replace(/\.00$/, ""),
        unit: line.unit || "",
        unitCost: Number(line.unitCost).toFixed(2),
        markupPercent: Number(line.markupPercent).toFixed(2).replace(/\.00$/, ""),
        lineCostTotal: Number(line.lineCostTotal),
        lineSellTotal: Number(line.lineSellTotal),
      })),
  };
}

export function normalizeEstimateDecimal(value: string): Prisma.Decimal {
  return roundMoney(toMoneyDecimal(value || "0"));
}

export function normalizeEstimateTaxRate(value: string): Prisma.Decimal {
  return parseTaxRatePercent(value) || toMoneyDecimal(0);
}

export const ESTIMATE_TITLE_MAX = 160;
export const ESTIMATE_DESCRIPTION_MAX = 4000;
export const ESTIMATE_TERMS_MAX = 4000;
export const ESTIMATE_NUMBER_MAX = 64;

export const estimateStatusOptions: EstimateStatus[] = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "APPROVED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
];

export const estimateActivityTypeOptions: EstimateActivityType[] = [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "SHARE_LINK_CREATED",
  "SHARE_LINK_REVOKED",
  "ITEM_ADDED",
  "ITEM_REMOVED",
  "SENT",
  "VIEWED",
  "APPROVED",
  "DECLINED",
  "CONVERTED_TO_JOB",
  "CONVERTED_TO_INVOICE",
  "ARCHIVED",
];

export type EstimateItemRow = {
  id: string;
  materialId: string | null;
  type: EstimateDraftLineType;
  sortOrder: number;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: number;
};

export type EstimateLeadSummary = {
  id: string;
  label: string;
  phoneE164: string;
  customerName: string;
};

export type EstimateJobSummary = {
  id: string;
  customerName: string;
  projectType: string;
};

export type EstimateActivityEntry = {
  id: string;
  type: EstimateActivityType;
  actorName: string;
  description: string;
  createdAt: string;
};

export type EstimateShareSummary = {
  id: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhoneE164: string;
  expiresAt: string | null;
  revokedAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  approvedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  updatedAt: string;
  state: "ACTIVE" | "REVOKED" | "EXPIRED" | "APPROVED" | "DECLINED";
};

export type EstimateListItem = {
  id: string;
  estimateNumber: string;
  title: string;
  customerName: string;
  siteAddress: string;
  projectType: string;
  status: EstimateStatus;
  subtotal: number;
  tax: number;
  total: number;
  validUntil: string | null;
  sharedAt: string | null;
  shareExpiresAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  customerViewedAt: string | null;
  approvedAt: string | null;
  declinedAt: string | null;
  customerDecisionAt: string | null;
  customerDecisionName: string;
  customerDecisionNote: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lineItemCount: number;
  lead: EstimateLeadSummary | null;
  job: EstimateJobSummary | null;
};

export type EstimateDetail = EstimateListItem & {
  description: string;
  notes: string;
  terms: string;
  taxRatePercent: string;
  taxRateSource: EstimateTaxSource;
  taxZipCode: string;
  taxJurisdiction: string;
  taxLocationCode: string;
  taxCalculatedAt: string | null;
  lineItems: EstimateItemRow[];
  activities: EstimateActivityEntry[];
  latestShareLink: EstimateShareSummary | null;
};

export type EstimateReferenceLead = {
  id: string;
  label: string;
  customerName: string;
  phoneE164: string;
};

export function canManageEstimates(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole !== "READ_ONLY";
}

export function createBlankEstimateItem(type: EstimateDraftLineType = "CUSTOM_MATERIAL"): EstimateItemRow {
  return {
    id: createId("estimate-item"),
    materialId: null,
    type,
    sortOrder: 0,
    name: "",
    description: "",
    quantity: "1",
    unit: type === "LABOR" ? "hours" : "each",
    unitPrice: "0.00",
    total: 0,
  };
}

export function createEstimateItemFromMaterial(material: MaterialListItem): EstimateItemRow {
  return {
    id: createId("estimate-item"),
    materialId: material.id,
    type: "MATERIAL",
    sortOrder: 0,
    name: material.name,
    description: material.notes || "",
    quantity: "1",
    unit: material.unit,
    unitPrice: material.sellPrice.toFixed(2),
    total: roundMaterialNumber(material.sellPrice),
  };
}

export function computeEstimateItemTotal(input: {
  quantity: string;
  unitPrice: string;
}): number {
  const quantity = parseInputNumber(input.quantity);
  const unitPrice = parseInputNumber(input.unitPrice);
  return roundMaterialNumber(quantity * unitPrice);
}

export function summarizeEstimateItems(lines: EstimateItemRow[], taxRatePercent: string): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = roundMaterialNumber(lines.reduce((sum, line) => sum + line.total, 0));
  const tax = roundMaterialNumber(subtotal * (parseInputNumber(taxRatePercent) / 100));
  const total = roundMaterialNumber(subtotal + tax);
  return {
    subtotal,
    tax,
    total,
  };
}

export function formatEstimateStatusLabel(status: EstimateStatus): string {
  return status.replace(/_/g, " ");
}

export function describeEstimateActivityType(type: EstimateActivityType): string {
  switch (type) {
    case "CREATED":
      return "Estimate created";
    case "UPDATED":
      return "Estimate updated";
    case "SHARE_LINK_CREATED":
      return "Share link generated";
    case "SHARE_LINK_REVOKED":
      return "Share link revoked";
    case "SENT":
      return "Estimate marked sent";
    case "VIEWED":
      return "Estimate viewed";
    case "APPROVED":
      return "Estimate approved";
    case "DECLINED":
      return "Estimate declined";
    case "ARCHIVED":
      return "Estimate archived";
    case "ITEM_ADDED":
      return "Line item added";
    case "ITEM_REMOVED":
      return "Line item removed";
    case "STATUS_CHANGED":
      return "Status updated";
    case "CONVERTED_TO_JOB":
      return "Converted to job";
    case "CONVERTED_TO_INVOICE":
      return "Converted to invoice";
    default:
      return String(type).replace(/_/g, " ");
  }
}

const estimateStatusTransitions: Record<EstimateStatus, EstimateStatus[]> = {
  DRAFT: ["SENT", "APPROVED", "DECLINED", "EXPIRED"],
  SENT: ["DRAFT", "VIEWED", "APPROVED", "DECLINED", "EXPIRED"],
  VIEWED: ["DRAFT", "SENT", "APPROVED", "DECLINED", "EXPIRED"],
  APPROVED: ["DRAFT", "CONVERTED"],
  DECLINED: ["DRAFT"],
  EXPIRED: ["DRAFT", "SENT"],
  CONVERTED: [],
};

export function canTransitionEstimateStatus(current: EstimateStatus, next: EstimateStatus): boolean {
  if (current === next) return true;
  return estimateStatusTransitions[current]?.includes(next) || false;
}

function serializeEstimateLead(
  lead:
    | {
        id: string;
        contactName: string | null;
        businessName: string | null;
        phoneE164: string;
      }
    | null
    | undefined,
): EstimateLeadSummary | null {
  if (!lead) return null;

  const label = lead.contactName || lead.businessName || lead.phoneE164;
  return {
    id: lead.id,
    label,
    phoneE164: lead.phoneE164,
    customerName: lead.contactName || lead.businessName || "",
  };
}

function serializeEstimateJob(
  job:
    | {
        id: string;
        customerName: string;
        projectType: string;
      }
    | null
    | undefined,
): EstimateJobSummary | null {
  if (!job) return null;
  return {
    id: job.id,
    customerName: job.customerName,
    projectType: job.projectType,
  };
}

function extractMetadataActorName(metadata: Prisma.JsonValue | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const metadataRecord = metadata as Record<string, unknown>;
  const candidateKeys = ["customerName", "decisionName", "recipientName"] as const;
  for (const key of candidateKeys) {
    const value = metadataRecord[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function deriveShareState(share: {
  expiresAt: Date | null;
  revokedAt: Date | null;
  approvedAt: Date | null;
  declinedAt: Date | null;
}): EstimateShareSummary["state"] {
  if (share.revokedAt) return "REVOKED";
  if (share.approvedAt) return "APPROVED";
  if (share.declinedAt) return "DECLINED";
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "ACTIVE";
}

export function serializeEstimateSummary(
  estimate: Prisma.EstimateGetPayload<{
    include: {
      lead: {
        select: {
          id: true;
          contactName: true;
          businessName: true;
          phoneE164: true;
        };
      };
      job: {
        select: {
          id: true;
          customerName: true;
          projectType: true;
        };
      };
      _count: {
        select: {
          lineItems: true;
        };
      };
    };
  }>,
): EstimateListItem {
  return {
    id: estimate.id,
    estimateNumber: estimate.estimateNumber,
    title: estimate.title,
    customerName: estimate.customerName || "",
    siteAddress: estimate.siteAddress || "",
    projectType: estimate.projectType || "",
    status: estimate.status,
    subtotal: Number(estimate.subtotal),
    tax: Number(estimate.tax),
    total: Number(estimate.total),
    validUntil: estimate.validUntil ? estimate.validUntil.toISOString() : null,
    sharedAt: estimate.sharedAt ? estimate.sharedAt.toISOString() : null,
    shareExpiresAt: estimate.shareExpiresAt ? estimate.shareExpiresAt.toISOString() : null,
    sentAt: estimate.sentAt ? estimate.sentAt.toISOString() : null,
    viewedAt: estimate.viewedAt ? estimate.viewedAt.toISOString() : null,
    customerViewedAt: estimate.customerViewedAt ? estimate.customerViewedAt.toISOString() : null,
    approvedAt: estimate.approvedAt ? estimate.approvedAt.toISOString() : null,
    declinedAt: estimate.declinedAt ? estimate.declinedAt.toISOString() : null,
    customerDecisionAt: estimate.customerDecisionAt ? estimate.customerDecisionAt.toISOString() : null,
    customerDecisionName: estimate.customerDecisionName || "",
    customerDecisionNote: estimate.customerDecisionNote || "",
    archivedAt: estimate.archivedAt ? estimate.archivedAt.toISOString() : null,
    createdAt: estimate.createdAt.toISOString(),
    updatedAt: estimate.updatedAt.toISOString(),
    lineItemCount: estimate._count.lineItems,
    lead: serializeEstimateLead(estimate.lead),
    job: serializeEstimateJob(estimate.job),
  };
}

export function serializeEstimateDetail(
  estimate: Prisma.EstimateGetPayload<{
    include: {
      lead: {
        select: {
          id: true;
          contactName: true;
          businessName: true;
          phoneE164: true;
        };
      };
      job: {
        select: {
          id: true;
          customerName: true;
          projectType: true;
        };
      };
      lineItems: true;
      shareLinks: {
        orderBy: {
          createdAt: "desc";
        };
        take: 1;
      };
      activities: {
        include: {
          actorUser: {
            select: {
              id: true;
              name: true;
              email: true;
            };
          };
        };
      };
      _count: {
        select: {
          lineItems: true;
        };
      };
    };
  }>,
): EstimateDetail {
  return {
    ...serializeEstimateSummary(estimate),
    description: estimate.description || "",
    notes: estimate.notes || "",
    terms: estimate.terms || "",
    taxRatePercent: taxRateToPercent(estimate.taxRate),
    taxRateSource: estimate.taxRateSource,
    taxZipCode: estimate.taxZipCode || "",
    taxJurisdiction: estimate.taxJurisdiction || "",
    taxLocationCode: estimate.taxLocationCode || "",
    taxCalculatedAt: estimate.taxCalculatedAt ? estimate.taxCalculatedAt.toISOString() : null,
    lineItems: [...estimate.lineItems]
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((line) => ({
        id: line.id,
        materialId: line.materialId,
        type: line.type,
        sortOrder: line.sortOrder,
        name: line.name,
        description: line.description || "",
        quantity: Number(line.quantity).toFixed(2).replace(/\.00$/, ""),
        unit: line.unit || "",
        unitPrice: Number(line.unitPrice).toFixed(2),
        total: Number(line.total),
      })),
    activities: [...estimate.activities]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((activity) => ({
        id: activity.id,
        type: activity.type,
        actorName:
          activity.actorUser?.name ||
          activity.actorUser?.email ||
          extractMetadataActorName(activity.metadata) ||
          "System",
        description: describeEstimateActivityType(activity.type),
        createdAt: activity.createdAt.toISOString(),
      })),
    latestShareLink: estimate.shareLinks[0]
      ? {
          id: estimate.shareLinks[0].id,
          recipientName: estimate.shareLinks[0].recipientName || "",
          recipientEmail: estimate.shareLinks[0].recipientEmail || "",
          recipientPhoneE164: estimate.shareLinks[0].recipientPhoneE164 || "",
          expiresAt: estimate.shareLinks[0].expiresAt ? estimate.shareLinks[0].expiresAt.toISOString() : null,
          revokedAt: estimate.shareLinks[0].revokedAt ? estimate.shareLinks[0].revokedAt.toISOString() : null,
          firstViewedAt: estimate.shareLinks[0].firstViewedAt ? estimate.shareLinks[0].firstViewedAt.toISOString() : null,
          lastViewedAt: estimate.shareLinks[0].lastViewedAt ? estimate.shareLinks[0].lastViewedAt.toISOString() : null,
          approvedAt: estimate.shareLinks[0].approvedAt ? estimate.shareLinks[0].approvedAt.toISOString() : null,
          declinedAt: estimate.shareLinks[0].declinedAt ? estimate.shareLinks[0].declinedAt.toISOString() : null,
          createdAt: estimate.shareLinks[0].createdAt.toISOString(),
          updatedAt: estimate.shareLinks[0].updatedAt.toISOString(),
          state: deriveShareState(estimate.shareLinks[0]),
        }
      : null,
  };
}
