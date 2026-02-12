import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";
import type { CalendarEventStatus, EventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

type RouteContext = {
  params: { jobId: string };
};

const IDEMPOTENT_ROUTE = "/api/jobs/[jobId]/status";

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

const JOB_EVENT_TYPES: EventType[] = ["JOB", "ESTIMATE", "CALL"];

function parseStatus(value: unknown): CalendarEventStatus {
  if (typeof value !== "string") {
    throw new AppApiError("status is required.", 400);
  }
  const normalized = value.trim().toUpperCase();
  if (!STATUS_VALUES.includes(normalized as CalendarEventStatus)) {
    throw new AppApiError("Invalid job status.", 400);
  }
  return normalized as CalendarEventStatus;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || "";
    const payload = (await req.json().catch(() => null)) as { status?: unknown; eventId?: unknown } | null;
    const status = parseStatus(payload?.status);
    const eventId = typeof payload?.eventId === "string" ? payload.eventId.trim() : "";

    const lead = await prisma.lead.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        orgId: true,
        contactName: true,
        businessName: true,
      },
    });

    if (!lead) {
      throw new AppApiError("Job not found.", 404);
    }

    await assertCanMutateLeadJob({
      actor,
      orgId: lead.orgId,
      leadId: lead.id,
    });

    if (idempotencyKey) {
      const existingReceipt = await prisma.clientMutationReceipt.findUnique({
        where: {
          orgId_idempotencyKey: {
            orgId: lead.orgId,
            idempotencyKey,
          },
        },
        select: {
          route: true,
          responseJson: true,
        },
      });

      if (existingReceipt && existingReceipt.route === IDEMPOTENT_ROUTE && existingReceipt.responseJson) {
        return NextResponse.json(existingReceipt.responseJson as { ok: boolean; event: unknown });
      }
    }

    const existingEvent = eventId
      ? await prisma.event.findFirst({
          where: {
            id: eventId,
            orgId: lead.orgId,
            leadId: lead.id,
            type: { in: JOB_EVENT_TYPES },
          },
          select: {
            id: true,
            assignedToUserId: true,
            workerAssignments: {
              select: { workerUserId: true },
            },
          },
        })
      : await prisma.event.findFirst({
          where: {
            orgId: lead.orgId,
            leadId: lead.id,
            type: { in: JOB_EVENT_TYPES },
          },
          orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            assignedToUserId: true,
            workerAssignments: {
              select: { workerUserId: true },
            },
          },
        });

    if (existingEvent && !canManageAnyOrgJobs(actor)) {
      const isAssigned =
        existingEvent.assignedToUserId === actor.id ||
        existingEvent.workerAssignments.some((assignment) => assignment.workerUserId === actor.id);
      if (!isAssigned) {
        throw new AppApiError("Workers can only update status for events assigned to them.", 403);
      }
    }

    const now = new Date();

    const event = existingEvent
      ? await prisma.event.update({
          where: { id: existingEvent.id },
          data: {
            status,
          },
          select: {
            id: true,
            leadId: true,
            type: true,
            status: true,
            startAt: true,
            endAt: true,
            assignedToUserId: true,
            updatedAt: true,
          },
        })
      : await prisma.event.create({
          data: {
            orgId: lead.orgId,
            leadId: lead.id,
            type: "JOB",
            status,
            title: `${lead.contactName || lead.businessName || "Job"} status update`,
            startAt: now,
            endAt: addMinutes(now, 30),
            assignedToUserId: actor.id,
            createdByUserId: actor.id,
            workerAssignments: {
              create: {
                orgId: lead.orgId,
                workerUserId: actor.id,
              },
            },
          },
          select: {
            id: true,
            leadId: true,
            type: true,
            status: true,
            startAt: true,
            endAt: true,
            assignedToUserId: true,
            updatedAt: true,
          },
        });

    await prisma.leadNote.create({
      data: {
        orgId: lead.orgId,
        leadId: lead.id,
        createdByUserId: actor.id,
        body: `Job status updated to ${status.replaceAll("_", " ")}.`,
      },
    });

    const responsePayload = { ok: true, event };
    const responseJson = JSON.parse(JSON.stringify(responsePayload)) as typeof responsePayload;

    if (idempotencyKey) {
      await prisma.clientMutationReceipt.upsert({
        where: {
          orgId_idempotencyKey: {
            orgId: lead.orgId,
            idempotencyKey,
          },
        },
        create: {
          orgId: lead.orgId,
          idempotencyKey,
          route: IDEMPOTENT_ROUTE,
          responseJson: responseJson as never,
        },
        update: {
          route: IDEMPOTENT_ROUTE,
          responseJson: responseJson as never,
        },
      });
    }

    return NextResponse.json(responseJson);
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update job status.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
