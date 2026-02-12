import { NextResponse } from "next/server";
import type { LeadPriority, LeadSourceType, LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import {
  AppApiError,
  assertCanMutateLeadJob,
  assertOrgWriteAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

type RouteContext = {
  params: { leadId: string };
};

type PatchLeadPayload = {
  contactName?: string | null;
  businessName?: string | null;
  phone?: string | null;
  city?: string | null;
  businessType?: string | null;
  notes?: string | null;
  status?: string;
  priority?: string;
  nextFollowUpAt?: string | null;
  assignedToUserId?: string | null;
  customerId?: string | null;
  sourceType?: string;
  sourceDetail?: string | null;
  attributionLocked?: boolean;
  commissionEligible?: boolean;
};

const STATUSES: LeadStatus[] = [
  "NEW",
  "CALLED_NO_ANSWER",
  "VOICEMAIL",
  "INTERESTED",
  "FOLLOW_UP",
  "BOOKED",
  "NOT_INTERESTED",
  "DNC",
];
const PRIORITIES: LeadPriority[] = ["HIGH", "MEDIUM", "LOW"];
const SOURCE_TYPES: LeadSourceType[] = ["PAID", "ORGANIC", "REFERRAL", "WALKIN", "REPEAT", "UNKNOWN"];

function parseStatus(value: unknown): LeadStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return STATUSES.includes(normalized as LeadStatus) ? (normalized as LeadStatus) : null;
}

function parsePriority(value: unknown): LeadPriority | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return PRIORITIES.includes(normalized as LeadPriority) ? (normalized as LeadPriority) : null;
}

function parseSourceType(value: unknown): LeadSourceType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return SOURCE_TYPES.includes(normalized as LeadSourceType) ? (normalized as LeadSourceType) : null;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as PatchLeadPayload | null;

    if (!payload) {
      throw new AppApiError("Invalid JSON payload.", 400);
    }

    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        id: true,
        orgId: true,
      },
    });

    if (!lead) {
      throw new AppApiError("Lead not found.", 404);
    }

    assertOrgWriteAccess(actor, lead.orgId);

    if (!canManageAnyOrgJobs(actor)) {
      await assertCanMutateLeadJob({
        actor,
        orgId: lead.orgId,
        leadId: lead.id,
      });
    }

    const updateData: Record<string, unknown> = {};

    if (payload.contactName !== undefined) {
      updateData.contactName = payload.contactName?.trim() || null;
    }

    if (payload.businessName !== undefined) {
      updateData.businessName = payload.businessName?.trim() || null;
    }

    if (payload.phone !== undefined) {
      const nextPhone = payload.phone ? normalizeE164(payload.phone) : null;
      if (!nextPhone) {
        throw new AppApiError("Phone must be a valid E.164 number.", 400);
      }
      updateData.phoneE164 = nextPhone;
    }

    if (payload.city !== undefined) {
      updateData.city = payload.city?.trim() || null;
    }

    if (payload.businessType !== undefined) {
      updateData.businessType = payload.businessType?.trim() || null;
    }

    if (payload.notes !== undefined) {
      if (payload.notes && payload.notes.length > 4000) {
        throw new AppApiError("Notes must be 4000 characters or less.", 400);
      }
      updateData.notes = payload.notes?.trim() || null;
    }

    if (payload.status !== undefined) {
      const status = parseStatus(payload.status);
      if (!status) {
        throw new AppApiError("Invalid lead status.", 400);
      }
      updateData.status = status;
    }

    if (payload.priority !== undefined) {
      const priority = parsePriority(payload.priority);
      if (!priority) {
        throw new AppApiError("Invalid lead priority.", 400);
      }
      updateData.priority = priority;
    }

    if (payload.nextFollowUpAt !== undefined) {
      if (!payload.nextFollowUpAt) {
        updateData.nextFollowUpAt = null;
      } else {
        const parsed = new Date(payload.nextFollowUpAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new AppApiError("nextFollowUpAt must be a valid ISO datetime.", 400);
        }
        updateData.nextFollowUpAt = parsed;
      }
    }

    if (payload.assignedToUserId !== undefined) {
      if (!canManageAnyOrgJobs(actor)) {
        throw new AppApiError("Only owners/admins/internal users can reassign leads.", 403);
      }

      const assignedToUserId = payload.assignedToUserId || null;
      if (assignedToUserId) {
        const assignedUser = await prisma.user.findFirst({
          where: {
            id: assignedToUserId,
            OR: [{ orgId: lead.orgId }, { role: "INTERNAL" }],
          },
          select: { id: true },
        });
        if (!assignedUser) {
          throw new AppApiError("Assigned user is invalid for this organization.", 400);
        }
      }

      updateData.assignedToUserId = assignedToUserId;
    }

    if (payload.customerId !== undefined) {
      const customerId = payload.customerId || null;
      if (customerId) {
        const customer = await prisma.customer.findFirst({
          where: {
            id: customerId,
            orgId: lead.orgId,
          },
          select: { id: true },
        });
        if (!customer) {
          throw new AppApiError("Customer is invalid for this organization.", 400);
        }
      }
      updateData.customerId = customerId;
    }

    const attributionFieldsTouched =
      payload.sourceType !== undefined ||
      payload.sourceDetail !== undefined ||
      payload.attributionLocked !== undefined ||
      payload.commissionEligible !== undefined;

    if (attributionFieldsTouched && !actor.internalUser) {
      throw new AppApiError("Only internal users can edit attribution and commission fields.", 403);
    }

    if (payload.sourceType !== undefined) {
      const sourceType = parseSourceType(payload.sourceType);
      if (!sourceType) {
        throw new AppApiError("Invalid sourceType value.", 400);
      }
      updateData.sourceType = sourceType;
    }

    if (payload.sourceDetail !== undefined) {
      if (payload.sourceDetail && payload.sourceDetail.length > 2000) {
        throw new AppApiError("sourceDetail must be 2000 characters or less.", 400);
      }
      updateData.sourceDetail = payload.sourceDetail?.trim() || null;
    }

    if (payload.attributionLocked !== undefined) {
      updateData.attributionLocked = Boolean(payload.attributionLocked);
    }

    if (payload.commissionEligible !== undefined) {
      updateData.commissionEligible = Boolean(payload.commissionEligible);
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppApiError("No valid fields to update.", 400);
    }

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: updateData,
      select: {
        id: true,
        orgId: true,
        customerId: true,
        assignedToUserId: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        status: true,
        priority: true,
        notes: true,
        sourceType: true,
        sourceDetail: true,
        attributionLocked: true,
        commissionEligible: true,
        nextFollowUpAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, lead: updated });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update lead.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
