import { NextResponse } from "next/server";
import type { CallDirection, CallStatus, MessageDirection, MessageStatus, MessageType, MessageProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  assertOrgReadAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: { leadId: string };
};

export type TimelineEvent = {
  id: string;
  type: "message" | "call" | "system";
  channel: "sms" | "meta" | "call" | "system";
  direction?: "inbound" | "outbound";
  leadId?: string;
  body?: string;
  status?: "queued" | "sent" | "delivered" | "failed" | "read";
  createdAt: string;
  meta?: Record<string, unknown>;
};

function mapMessageDirection(direction: MessageDirection): "inbound" | "outbound" {
  return direction === "INBOUND" ? "inbound" : "outbound";
}

function mapCallDirection(direction: CallDirection): "inbound" | "outbound" {
  return direction === "INBOUND" ? "inbound" : "outbound";
}

function mapMessageStatus(status: MessageStatus | null | undefined): TimelineEvent["status"] {
  switch ((status || "").toString()) {
    case "QUEUED":
      return "queued";
    case "SENT":
      return "sent";
    case "DELIVERED":
      return "delivered";
    case "FAILED":
      return "failed";
    default:
      return undefined;
  }
}

function mapCallStatus(status: CallStatus): string {
  if (status === "MISSED") return "Missed";
  if (status === "VOICEMAIL") return "Voicemail";
  if (status === "ANSWERED") return "Answered";
  return "Call";
}

async function assertWorkerCanViewLead(input: { actorId: string; orgId: string; leadId: string }) {
  const allowed = await prisma.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
      OR: [
        { assignedToUserId: input.actorId },
        { createdByUserId: input.actorId },
        { events: { some: { assignedToUserId: input.actorId } } },
        { events: { some: { workerAssignments: { some: { workerUserId: input.actorId } } } } },
      ],
    },
    select: { id: true },
  });

  if (!allowed) {
    throw new AppApiError("Workers can only access assigned jobs.", 403);
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const leadId = params.leadId;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        orgId: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        status: true,
        priority: true,
        nextFollowUpAt: true,
        estimatedRevenueCents: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            addressLine: true,
          },
        },
      },
    });

    if (!lead) {
      throw new AppApiError("Conversation not found.", 404);
    }

    assertOrgReadAccess(actor, lead.orgId);

    if (!actor.internalUser && !canManageAnyOrgJobs(actor) && actor.calendarAccessRole === "WORKER") {
      await assertWorkerCanViewLead({ actorId: actor.id, orgId: lead.orgId, leadId: lead.id });
    }

    const url = new URL(req.url);
    const limit = Math.max(20, Math.min(240, Number(url.searchParams.get("limit") || 180)));

    const [messagesDesc, callsDesc] = await Promise.all([
      prisma.message.findMany({
        where: { leadId: lead.id },
        select: {
          id: true,
          direction: true,
          body: true,
          status: true,
          type: true,
          provider: true,
          providerMessageSid: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.call.findMany({
        where: { leadId: lead.id },
        select: {
          id: true,
          direction: true,
          status: true,
          fromNumberE164: true,
          toNumberE164: true,
          twilioCallSid: true,
          startedAt: true,
          endedAt: true,
        },
        orderBy: { startedAt: "desc" },
        take: limit,
      }),
    ]);

    const messageEvents: TimelineEvent[] = messagesDesc
      .slice()
      .reverse()
      .map((msg) => ({
        id: msg.id,
        type: "message",
        channel: msg.provider === ("TWILIO" as MessageProvider) ? "sms" : "system",
        direction: mapMessageDirection(msg.direction),
        leadId: lead.id,
        body: msg.body,
        status: mapMessageStatus(msg.status),
        createdAt: msg.createdAt.toISOString(),
        meta: {
          provider: msg.provider,
          providerMessageSid: msg.providerMessageSid,
          messageType: msg.type as MessageType,
        },
      }));

    const callEvents: TimelineEvent[] = callsDesc
      .slice()
      .reverse()
      .map((call) => {
        const started = call.startedAt;
        const ended = call.endedAt;
        const durationSeconds =
          ended && started && !Number.isNaN(ended.getTime()) && !Number.isNaN(started.getTime())
            ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000))
            : null;

        return {
          id: call.id,
          type: "call",
          channel: "call",
          direction: mapCallDirection(call.direction),
          leadId: lead.id,
          createdAt: (started || new Date()).toISOString(),
          meta: {
            label: mapCallStatus(call.status),
            status: call.status,
            fromNumberE164: call.fromNumberE164,
            toNumberE164: call.toNumberE164,
            durationSeconds,
            twilioCallSid: call.twilioCallSid,
          },
        };
      });

    const events = [...messageEvents, ...callEvents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return NextResponse.json({
      ok: true,
      lead: {
        id: lead.id,
        orgId: lead.orgId,
        contactName: lead.contactName,
        businessName: lead.businessName,
        phoneE164: lead.phoneE164,
        city: lead.city,
        status: lead.status,
        priority: lead.priority,
        nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : null,
        estimatedRevenueCents: lead.estimatedRevenueCents,
        customer: lead.customer,
      },
      events,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load thread.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  // Convenience endpoint to mark worker access via shared guard patterns (no-op for v1).
  // Real read-state tracking is handled client-side for now.
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as { orgId?: unknown } | null;
    const orgId = typeof payload?.orgId === "string" ? payload.orgId : null;
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      select: { id: true, orgId: true },
    });
    if (!lead) {
      throw new AppApiError("Conversation not found.", 404);
    }
    assertOrgReadAccess(actor, lead.orgId);

    if (orgId && orgId !== lead.orgId) {
      throw new AppApiError("Forbidden", 403);
    }

    // Workers must be allowed to mutate the lead/job to mark read (matches message-send permissions).
    if (!actor.internalUser && actor.calendarAccessRole === "WORKER") {
      await assertCanMutateLeadJob({ actor, orgId: lead.orgId, leadId: lead.id });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to update state.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

