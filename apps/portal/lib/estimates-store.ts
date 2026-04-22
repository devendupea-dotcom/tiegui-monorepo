import "server-only";

import {
  Prisma,
  type EstimateActivityType,
  type JobStatus,
} from "@prisma/client";
import {
  ESTIMATE_DESCRIPTION_MAX,
  ESTIMATE_LINE_DESCRIPTION_MAX,
  ESTIMATE_LINE_UNIT_MAX,
  ESTIMATE_SITE_ADDRESS_MAX,
  getEstimateCustomerFacingIssues,
  requiresEstimateCustomerFacingReadiness,
  serializeEstimateDetail,
  type EstimateItemRow,
  type EstimateReferenceLead,
} from "@/lib/estimates";
import {
  buildEstimateActivityMetadata,
  buildExistingLineFallback,
  buildInvoiceLineDescription,
  mergeJobNotes,
  normalizeEstimateLineItems,
  normalizeEstimatePayloadCore,
  normalizeLineType,
  normalizeNonNegativeDecimal,
  normalizeOptionalId,
  normalizeOptionalText,
  resolveActivityTypeForStatus,
  type EstimateItemPayload,
  type EstimatePayload,
  type NormalizedEstimatePayload,
} from "@/lib/estimates-store-core";
import { formatDispatchStatusLabel } from "@/lib/dispatch";
import {
  maybeSendDispatchCustomerNotifications,
  type DispatchPersistedJobEvent,
} from "@/lib/dispatch-notifications";
import { extractEstimateZipCode } from "@/lib/estimate-tax";
import {
  DEFAULT_INVOICE_TERMS,
  computeInvoiceDueDate,
  recomputeInvoiceTotals,
  reserveNextInvoiceNumber,
  roundMoney,
} from "@/lib/invoices";
import {
  buildEstimateAttachmentData,
  buildEstimateConversionJobLinkData,
} from "@/lib/estimate-job-linking";
import {
  bookingEventTypes,
  deriveJobBookingProjection,
} from "@/lib/booking-read-model";
import { maybeSendOrgDispatchNotifications } from "@/lib/org-owner-notifications";
import { findOperationalJobForLead } from "@/lib/operational-jobs";
import { prisma } from "@/lib/prisma";
import { AppApiError } from "@/lib/app-api-permissions";
import { roundMaterialNumber, type MaterialListItem } from "@/lib/materials";

const ZERO = new Prisma.Decimal(0);

async function getActiveBookingScheduleForJob(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    jobId: string | null;
  },
) {
  if (!input.jobId) {
    return {
      scheduledDateKey: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
    };
  }

  const [config, events] = await Promise.all([
    tx.orgDashboardConfig.findUnique({
      where: {
        orgId: input.orgId,
      },
      select: {
        calendarTimezone: true,
      },
    }),
    tx.event.findMany({
      where: {
        orgId: input.orgId,
        jobId: input.jobId,
        type: {
          in: bookingEventTypes,
        },
      },
      select: {
        id: true,
        type: true,
        status: true,
        startAt: true,
        endAt: true,
        createdAt: true,
        updatedAt: true,
        jobId: true,
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
      take: 12,
    }),
  ]);

  const projection = deriveJobBookingProjection({
    events,
    timeZone: config?.calendarTimezone || null,
  });

  if (!projection.activeBookingEvent) {
    return {
      scheduledDateKey: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
    };
  }

  return {
    scheduledDateKey: projection.scheduledDateKey,
    scheduledStartTime: projection.scheduledStartTime,
    scheduledEndTime: projection.scheduledEndTime,
  };
}

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

type EstimateRecord = Prisma.EstimateGetPayload<{
  include: typeof estimateDetailInclude;
}>;

async function resolveEstimateLeadDefaults(
  orgId: string,
  leadId: string | null,
) {
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
    throw new AppApiError(
      "Selected lead was not found for this organization.",
      400,
    );
  }

  return lead;
}

async function validateEstimateMaterials(
  orgId: string,
  lineItems: EstimateItemRow[],
) {
  const materialIds = [
    ...new Set(lineItems.map((line) => line.materialId).filter(Boolean)),
  ] as string[];
  if (materialIds.length === 0) return;

  const matches = await prisma.material.findMany({
    where: {
      id: { in: materialIds },
      orgId,
    },
    select: { id: true },
  });

  if (matches.length !== materialIds.length) {
    throw new AppApiError(
      "One or more selected materials are not available for this organization.",
      400,
    );
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

async function recomputeLeadEstimateStats(
  tx: Prisma.TransactionClient,
  leadId: string | null,
) {
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
  const fallbackLines = buildExistingLineFallback(existing?.lineItems);
  const rawLeadId =
    payload.leadId === null
      ? null
      : payload.leadId === undefined
        ? existing?.leadId || null
        : normalizeOptionalId(payload.leadId);
  const lead = await resolveEstimateLeadDefaults(input.orgId, rawLeadId);
  const rawLineItems = normalizeEstimateLineItems(
    payload.lineItems,
    fallbackLines,
  );
  await validateEstimateMaterials(input.orgId, rawLineItems);
  const siteAddressCandidate =
    normalizeOptionalText(
      payload.siteAddress,
      "Site address",
      ESTIMATE_SITE_ADDRESS_MAX,
    ) ||
    existing?.siteAddress ||
    lead?.intakeLocationText ||
    null;
  return normalizeEstimatePayloadCore({
    payload: input.payload,
    existingEstimate: existing
      ? {
          leadId: existing.leadId,
          title: existing.title,
          customerName: existing.customerName,
          siteAddress: existing.siteAddress,
          projectType: existing.projectType,
          description: existing.description,
          notes: existing.notes,
          terms: existing.terms,
          taxRate: existing.taxRate,
          taxRateSource: existing.taxRateSource,
          taxZipCode: existing.taxZipCode,
          taxJurisdiction: existing.taxJurisdiction,
          taxLocationCode: existing.taxLocationCode,
          taxCalculatedAt: existing.taxCalculatedAt,
          subtotal: existing.subtotal,
          tax: existing.tax,
          total: existing.total,
          validUntil: existing.validUntil,
          status: existing.status,
        }
      : null,
    leadDefaults: lead
      ? {
          id: lead.id,
          contactName: lead.contactName,
          businessName: lead.businessName,
          businessType: lead.businessType,
          intakeLocationText: lead.intakeLocationText,
        }
      : null,
    lineItemInputs: rawLineItems,
    siteZipCode: extractEstimateZipCode(siteAddressCandidate || ""),
  });
}

async function recomputeEstimateTotals(
  tx: Prisma.TransactionClient,
  estimateId: string,
) {
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

  const subtotal = roundMoney(
    freshItems.reduce((sum, line) => sum.plus(line.total), ZERO),
  );
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
  if (requiresEstimateCustomerFacingReadiness(normalized.status)) {
    const readinessLead = await resolveEstimateLeadDefaults(
      input.orgId,
      normalized.leadId,
    );
    const customerFacingIssues = getEstimateCustomerFacingIssues({
      title: normalized.title,
      customerName: normalized.customerName,
      leadLabel:
        readinessLead?.contactName ||
        readinessLead?.businessName ||
        readinessLead?.phoneE164 ||
        "",
      lineItemCount: normalized.lineItems.length,
      total: Number(normalized.total),
    });
    if (customerFacingIssues.length > 0) {
      throw new AppApiError(
        `Estimate is not ready for ${normalized.status.toLowerCase()}. ${customerFacingIssues.join(" ")}`,
        400,
      );
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const estimate = existing
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
            sentAt:
              normalized.status === "SENT"
                ? existing.sentAt || now
                : existing.sentAt,
            viewedAt:
              normalized.status === "VIEWED"
                ? existing.viewedAt || now
                : existing.viewedAt,
            approvedAt:
              normalized.status === "APPROVED"
                ? existing.approvedAt || now
                : existing.approvedAt,
            declinedAt:
              normalized.status === "DECLINED"
                ? existing.declinedAt || now
                : existing.declinedAt,
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
      metadata: buildEstimateActivityMetadata({
        status: estimate.status,
        total: estimate.total,
        estimateNumber: estimate.estimateNumber,
      }),
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
  let material: {
    id: string;
    name: string;
    unit: string;
    sellPrice: number;
    notes: string | null;
  } | null = null;
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
    normalizeOptionalText(
      payload.name,
      "Line item name",
      ESTIMATE_LINE_DESCRIPTION_MAX,
    ) ||
    material?.name ||
    (type === "LABOR" ? "Labor" : "New Line Item");
  const description =
    normalizeOptionalText(
      payload.description,
      "Line item description",
      ESTIMATE_DESCRIPTION_MAX,
    ) ||
    material?.notes ||
    null;
  const quantity = normalizeNonNegativeDecimal(
    payload.quantity ?? "1",
    "Line item quantity",
  );
  const unit =
    normalizeOptionalText(
      payload.unit,
      "Line item unit",
      ESTIMATE_LINE_UNIT_MAX,
    ) ||
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
    throw new AppApiError(
      "This estimate is no longer sendable from the internal portal flow.",
      400,
    );
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
    throw new AppApiError(
      "Attach a lead before sending this estimate into dispatch or invoicing.",
      400,
    );
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
      name:
        input.estimate.customerName ||
        lead.contactName ||
        lead.businessName ||
        input.estimate.title,
      phoneE164: lead.phoneE164,
      addressLine:
        input.estimate.siteAddress || lead.intakeLocationText || null,
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
    throw new AppApiError(
      "Add at least one line item before converting this estimate.",
      400,
    );
  }

  if (input.createInvoice && existing.total.lte(0)) {
    throw new AppApiError(
      "Set a positive total before creating an invoice from this estimate.",
      400,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    let createdJobId: string | null = null;
    let createdInvoiceId: string | null = null;
    let bookingSchedule = {
      scheduledDateKey: null as string | null,
      scheduledStartTime: null as string | null,
      scheduledEndTime: null as string | null,
    };
    const dispatchEvents: DispatchPersistedJobEvent[] = [];
    const shouldEnsureOperationalJob = input.createJob || input.createInvoice;
    const resolvedCustomer = shouldEnsureOperationalJob
      ? await resolveCustomerForEstimateConversion({
          tx,
          estimate: existing,
          actorId: input.actorId,
        })
      : null;
    const reusableOperationalJob =
      shouldEnsureOperationalJob && resolvedCustomer
        ? await findOperationalJobForLead(tx, {
            orgId: existing.orgId,
            leadId: resolvedCustomer.leadId || existing.leadId || null,
            preferredJobId: existing.jobId || null,
            preferredEstimateId: existing.id,
          })
        : null;

    if (shouldEnsureOperationalJob) {
      const jobStatus: JobStatus = "DRAFT";
      const mergedNotes = mergeJobNotes(
        reusableOperationalJob?.notes,
        existing.description,
        existing.notes,
      );
      const customerName =
        existing.customerName ||
        existing.lead?.contactName ||
        existing.lead?.businessName ||
        existing.title;
      const phone =
        resolvedCustomer?.phoneE164 || existing.lead?.phoneE164 || null;
      const address =
        existing.siteAddress || reusableOperationalJob?.address || "";
      const serviceType =
        existing.projectType ||
        reusableOperationalJob?.serviceType ||
        "Project";
      const projectType =
        existing.projectType ||
        reusableOperationalJob?.projectType ||
        "Project";

      if (reusableOperationalJob) {
        createdJobId = reusableOperationalJob.id;
        await tx.job.update({
          where: { id: reusableOperationalJob.id },
          data: {
            customerId: resolvedCustomer?.customerId || null,
            leadId: resolvedCustomer?.leadId || existing.leadId || null,
            ...buildEstimateConversionJobLinkData(existing.id),
            customerName,
            phone,
            address,
            serviceType,
            projectType,
            notes: mergedNotes,
            status:
              reusableOperationalJob.status === "COMPLETED" ||
              reusableOperationalJob.status === "CANCELLED"
                ? "DRAFT"
                : reusableOperationalJob.status,
          },
        });
      } else {
        const job = await tx.job.create({
          data: {
            orgId: existing.orgId,
            createdByUserId: input.actorId,
            customerId: resolvedCustomer?.customerId || null,
            leadId: resolvedCustomer?.leadId || existing.leadId || null,
            ...buildEstimateConversionJobLinkData(existing.id),
            customerName,
            phone,
            address,
            serviceType,
            projectType,
            dispatchStatus: "SCHEDULED",
            notes: mergedNotes,
            status: jobStatus,
          },
          select: { id: true },
        });
        createdJobId = job.id;
      }

      const materialLines = existing.lineItems.filter(
        (line) => line.type !== "LABOR",
      );
      const laborLines = existing.lineItems.filter(
        (line) => line.type === "LABOR",
      );
      const targetJobId = createdJobId;
      const [materialCount, laborCount] = await Promise.all([
        targetJobId
          ? tx.jobMaterial.count({ where: { jobId: targetJobId } })
          : Promise.resolve(0),
        targetJobId
          ? tx.jobLabor.count({ where: { jobId: targetJobId } })
          : Promise.resolve(0),
      ]);

      if (targetJobId && materialLines.length > 0 && materialCount === 0) {
        await tx.jobMaterial.createMany({
          data: materialLines.map((line) => ({
            orgId: existing.orgId,
            jobId: targetJobId,
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

      if (targetJobId && laborLines.length > 0 && laborCount === 0) {
        await tx.jobLabor.createMany({
          data: laborLines.map((line) => ({
            orgId: existing.orgId,
            jobId: targetJobId,
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

      bookingSchedule = await getActiveBookingScheduleForJob(tx, {
        orgId: existing.orgId,
        jobId: targetJobId,
      });

      if (input.createJob && createdJobId) {
        const dispatchEvent = await tx.jobEvent.create({
          data: {
            orgId: existing.orgId,
            jobId: createdJobId,
            actorUserId: input.actorId,
            eventType: "JOB_CREATED",
            metadata: {
              source: "dispatch",
              origin: "estimate_conversion",
              customerId: resolvedCustomer?.customerId || null,
              leadId: resolvedCustomer?.leadId || existing.leadId || null,
              linkedEstimateId: existing.id,
              scheduledDate: bookingSchedule.scheduledDateKey,
              scheduledStartTime: bookingSchedule.scheduledStartTime,
              scheduledEndTime: bookingSchedule.scheduledEndTime,
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

      await appendEstimateActivity(tx, {
        estimateId: existing.id,
        type: "CONVERTED_TO_JOB",
        actorUserId: input.actorId,
        metadata: {
          jobId: createdJobId,
        },
      });
    }

    if (input.createInvoice) {
      if (!resolvedCustomer) {
        throw new AppApiError("Customer conversion data is unavailable.", 500);
      }
      const issueDate = new Date();
      const dueDate = computeInvoiceDueDate(issueDate, DEFAULT_INVOICE_TERMS);
      const invoiceNumber = await reserveNextInvoiceNumber(
        tx,
        existing.orgId,
        issueDate,
      );
      const invoice = await tx.invoice.create({
        data: {
          orgId: existing.orgId,
          legacyLeadId: resolvedCustomer.leadId,
          sourceEstimateId: existing.id,
          sourceJobId:
            createdJobId ||
            reusableOperationalJob?.id ||
            existing.jobId ||
            null,
          customerId: resolvedCustomer.customerId,
          invoiceNumber,
          status: "DRAFT",
          issueDate,
          dueDate,
          notes:
            [existing.notes, existing.terms].filter(Boolean).join("\n\n") ||
            null,
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
        ...buildEstimateAttachmentData(
          createdJobId || reusableOperationalJob?.id || existing.jobId,
        ),
      },
      include: estimateDetailInclude,
    });

    return {
      estimate: converted,
      jobId: createdJobId,
      invoiceId: createdInvoiceId,
      dispatchDate: bookingSchedule.scheduledDateKey,
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
    await maybeSendOrgDispatchNotifications({
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

export { buildEstimateListWhere } from "@/lib/estimates-store-core";
