import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";
import type { CalendarEventStatus, EventType, LeadSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";
import { parseUtcDateTime } from "@/lib/calendar/dates";
import { capturePortalError, trackPortalEvent } from "@/lib/telemetry";
import {
  AppApiError,
  assertCanCreateOrganicLead,
  canManageAnyOrgJobs,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";

type CreateLeadPayload = {
  orgId?: string;
  name?: string;
  phone?: string;
  preferredLanguage?: string;
  email?: string;
  address?: string;
  note?: string;
  sourceType?: string;
  sourceDetail?: string;
  scheduleNow?: boolean;
  schedule?: {
    startAt?: string;
    durationMinutes?: number;
    type?: string;
    status?: string;
    workerIds?: string[];
  };
  linkCustomerId?: string;
  ignorePossibleMatch?: boolean;
};

const SOURCE_TYPES: LeadSourceType[] = ["PAID", "ORGANIC", "REFERRAL", "WALKIN", "REPEAT", "UNKNOWN"];
const CLIENT_ALLOWED_SOURCE_TYPES: LeadSourceType[] = ["ORGANIC", "REFERRAL", "WALKIN", "REPEAT", "UNKNOWN"];
const SCHEDULABLE_EVENT_TYPES: EventType[] = ["JOB", "ESTIMATE", "CALL"];
const STATUS_VALUES: CalendarEventStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "EN_ROUTE",
  "ON_SITE",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];
const QUICK_SCHEDULE_DURATIONS = [30, 60, 90] as const;

function parseSourceType(input: string | undefined): LeadSourceType {
  const normalized = (input || "ORGANIC").trim().toUpperCase();
  return SOURCE_TYPES.includes(normalized as LeadSourceType) ? (normalized as LeadSourceType) : "ORGANIC";
}

function parsePreferredLanguage(input: string | undefined): "EN" | "ES" | null {
  const normalized = (input || "").trim().toUpperCase();
  if (normalized === "EN" || normalized === "ES") {
    return normalized;
  }
  return null;
}

function parseEventType(input: string | undefined): EventType {
  const normalized = (input || "JOB").trim().toUpperCase();
  return SCHEDULABLE_EVENT_TYPES.includes(normalized as EventType) ? (normalized as EventType) : "JOB";
}

function parseEventStatus(input: string | undefined): CalendarEventStatus {
  const normalized = (input || "SCHEDULED").trim().toUpperCase();
  return STATUS_VALUES.includes(normalized as CalendarEventStatus)
    ? (normalized as CalendarEventStatus)
    : "SCHEDULED";
}

function parseWorkerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return [...deduped];
}

function mapLeadSource(sourceType: LeadSourceType): "REFERRAL" | "OTHER" {
  if (sourceType === "REFERRAL") {
    return "REFERRAL";
  }
  return "OTHER";
}

function parseSchedule(payload: CreateLeadPayload["schedule"] | undefined): {
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  type: EventType;
  status: CalendarEventStatus;
  workerIds: string[];
} | null {
  if (!payload?.startAt) {
    return null;
  }

  const startAt = parseUtcDateTime(payload.startAt);
  if (!startAt) {
    throw new AppApiError("schedule.startAt must be a valid ISO datetime with timezone.", 400);
  }

  const durationMinutesRaw = Number(payload.durationMinutes || 30);
  const durationMinutes = QUICK_SCHEDULE_DURATIONS.includes(durationMinutesRaw as (typeof QUICK_SCHEDULE_DURATIONS)[number])
    ? durationMinutesRaw
    : 30;

  const endAt = addMinutes(startAt, durationMinutes);

  return {
    startAt,
    endAt,
    durationMinutes,
    type: parseEventType(payload.type),
    status: parseEventStatus(payload.status),
    workerIds: parseWorkerIds(payload.workerIds),
  };
}

async function resolveWorkerIds(input: {
  orgId: string;
  actor: Awaited<ReturnType<typeof requireAppApiActor>>;
  requestedWorkerIds: string[];
}): Promise<string[]> {
  if (!input.actor.internalUser && !canManageAnyOrgJobs(input.actor)) {
    return [input.actor.id];
  }

  const fallback = input.requestedWorkerIds.length > 0 ? input.requestedWorkerIds : [input.actor.id];

  const users = await prisma.user.findMany({
    where: {
      id: { in: fallback },
      OR: input.actor.internalUser ? [{ orgId: input.orgId }, { role: "INTERNAL" }] : [{ orgId: input.orgId }],
    },
    select: { id: true },
  });

  if (users.length !== fallback.length) {
    throw new AppApiError("One or more assigned workers are invalid for this organization.", 400);
  }

  return users.map((row) => row.id);
}

function readCookieValue(req: Request, cookieName: string): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  if (!cookieHeader) return null;

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split("=");
    if (!rawKey) continue;
    if (rawKey.trim() !== cookieName) continue;
    const rawValue = rest.join("=").trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as CreateLeadPayload | null;

    if (!payload) {
      throw new AppApiError("Invalid JSON payload.", 400);
    }

    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: payload.orgId,
    });

    const fbClickId = readCookieValue(req, "_fbc");
    const fbBrowserId = readCookieValue(req, "_fbp");

    await assertCanCreateOrganicLead(actor, orgId);

    const name = (payload.name || "").trim();
    const rawPhone = (payload.phone || "").trim();
    const preferredLanguage = parsePreferredLanguage(payload.preferredLanguage);
    const email = (payload.email || "").trim() || null;
    const address = (payload.address || "").trim() || null;
    const note = (payload.note || "").trim() || null;
    const sourceType = parseSourceType(payload.sourceType);
    const sourceDetail = (payload.sourceDetail || "").trim() || null;

    if (!name) {
      throw new AppApiError("Name is required.", 400);
    }

    const phoneE164 = normalizeE164(rawPhone);
    if (!phoneE164) {
      throw new AppApiError("Phone must be a valid E.164 number.", 400);
    }

    if (email && email.length > 320) {
      throw new AppApiError("Email is too long.", 400);
    }

    if (sourceDetail && sourceDetail.length > 2000) {
      throw new AppApiError("Source detail must be 2000 characters or less.", 400);
    }

    if (!actor.internalUser && !CLIENT_ALLOWED_SOURCE_TYPES.includes(sourceType)) {
      throw new AppApiError("Clients cannot set paid attribution on lead entry.", 403);
    }

    const schedule = payload.scheduleNow ? parseSchedule(payload.schedule) : null;
    if (payload.scheduleNow && !schedule) {
      throw new AppApiError("Schedule start time is required when scheduleNow is enabled.", 400);
    }
    const workerIds = schedule
      ? await resolveWorkerIds({
          orgId,
          actor,
          requestedWorkerIds: schedule.workerIds,
        })
      : [];

    const linkCustomerId = (payload.linkCustomerId || "").trim() || null;
    const existingMatches = await prisma.customer.findMany({
      where: {
        orgId,
        phoneE164,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        addressLine: true,
      },
    });

    const autoLinkedCustomerId = !linkCustomerId && !payload.ignorePossibleMatch ? existingMatches[0]?.id || null : null;

    const targetCustomerId = linkCustomerId || autoLinkedCustomerId;
    const linkedCustomer = targetCustomerId
      ? await prisma.customer.findFirst({
          where: {
            id: targetCustomerId,
            orgId,
          },
          select: {
            id: true,
            name: true,
          },
        })
      : null;

    if (targetCustomerId && !linkedCustomer) {
      throw new AppApiError("Selected customer was not found in this organization.", 404);
    }

    const created = await prisma.$transaction(async (tx) => {
      const customer =
        linkedCustomer ||
        (await tx.customer.create({
          data: {
            orgId,
            createdByUserId: actor.id,
            name,
            phoneE164,
            email,
            addressLine: address,
          },
          select: {
            id: true,
            name: true,
            phoneE164: true,
            email: true,
            addressLine: true,
          },
        }));

      const lead = await tx.lead.create({
        data: {
          orgId,
          customerId: customer.id,
          createdByUserId: actor.id,
          assignedToUserId: actor.id,
          contactName: name,
          phoneE164,
          preferredLanguage,
          notes: note,
          sourceType,
          sourceDetail,
          attributionLocked: true,
          commissionEligible: false,
          leadSource: mapLeadSource(sourceType),
          fbClickId: fbClickId || null,
          fbBrowserId: fbBrowserId || null,
        },
        select: {
          id: true,
          orgId: true,
          customerId: true,
          contactName: true,
          phoneE164: true,
          sourceType: true,
          sourceDetail: true,
          attributionLocked: true,
          commissionEligible: true,
          createdAt: true,
        },
      });

      if (note) {
        await tx.leadNote.create({
          data: {
            orgId,
            leadId: lead.id,
            createdByUserId: actor.id,
            body: note,
          },
        });
      }

      const event =
        schedule && workerIds.length > 0
          ? await tx.event.create({
              data: {
                orgId,
                leadId: lead.id,
                customerId: customer.id,
                type: schedule.type,
                status: schedule.status,
                title: `${name} ${schedule.type === "ESTIMATE" ? "Estimate" : "Job"}`,
                customerName: customer.name,
                addressLine: address,
                startAt: schedule.startAt,
                endAt: schedule.endAt,
                assignedToUserId: workerIds[0] || actor.id,
                createdByUserId: actor.id,
                description: note,
                workerAssignments: {
                  createMany: {
                    data: workerIds.map((workerUserId) => ({
                      orgId,
                      workerUserId,
                    })),
                  },
                },
              },
              select: {
                id: true,
                type: true,
                status: true,
                startAt: true,
                endAt: true,
                assignedToUserId: true,
              },
            })
          : null;

      return {
        customer,
        lead,
        event,
      };
    });

    if (created.event?.assignedToUserId) {
      void enqueueGoogleSyncJob({
        orgId,
        userId: created.event.assignedToUserId,
        eventId: created.event.id,
        action: "UPSERT_EVENT",
      });
    }

    await trackPortalEvent("Lead Created", {
      orgId,
      actorId: actor.id,
      leadId: created.lead.id,
      scheduled: Boolean(created.event),
    });

    return NextResponse.json({
      ok: true,
      lead: created.lead,
      customer: created.customer,
      event: created.event,
      linkedCustomerId: autoLinkedCustomerId,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/leads",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create lead.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
