import { NextResponse } from "next/server";
import type {
  CallDirection,
  CallStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  MessageProvider,
} from "@prisma/client";
import { deriveLeadBookingProjection } from "@/lib/booking-read-model";
import { findBlockedCallerByPhone } from "@/lib/blocked-callers";
import {
  mapMessageStatusToTimelineStatus,
  sortTimelineEventsStable,
} from "@/lib/communication-events";
import { sanitizeConversationMessageBody } from "@/lib/inbox-message-display";
import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import { normalizeLeadCity } from "@/lib/lead-location";
import { derivePotentialSpamSignals } from "@/lib/lead-spam";
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

type VoiceRiskSignal = {
  disposition: string | null;
  score: number | null;
};

function mapMessageDirection(
  direction: MessageDirection,
): "inbound" | "outbound" {
  return direction === "INBOUND" ? "inbound" : "outbound";
}

function mapCallDirection(direction: CallDirection): "inbound" | "outbound" {
  return direction === "INBOUND" ? "inbound" : "outbound";
}

function mapCallStatus(status: CallStatus): string {
  if (status === "MISSED") return "Missed";
  if (status === "VOICEMAIL") return "Voicemail";
  if (status === "ANSWERED") return "Answered";
  return "Call";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function recordString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function findLatestVoiceRiskSignal(
  events: Array<{ metadataJson: unknown }>,
): VoiceRiskSignal {
  for (const event of events) {
    const metadata = asRecord(event.metadataJson);
    const disposition = recordString(metadata, "riskDisposition") || null;
    const score = recordNumber(metadata, "riskScore") ?? null;
    if (disposition || score !== null) {
      return { disposition, score };
    }
  }

  return {
    disposition: null,
    score: null,
  };
}

function communicationCallLabel(type: string): string {
  if (
    type === "VOICEMAIL_REACHED" ||
    type === "VOICEMAIL_LEFT" ||
    type === "ABANDONED"
  ) {
    return "Voicemail";
  }
  if (type === "FORWARDED_TO_OWNER") {
    return "Forwarded";
  }
  return "Call";
}

function mapCommunicationEventToTimelineEvent(event: {
  id: string;
  type: string;
  channel: string;
  summary: string;
  occurredAt: Date;
  metadataJson: unknown;
  providerMessageSid: string | null;
  providerCallSid: string | null;
  providerStatus: string | null;
  voicemailArtifact: {
    recordingSid: string | null;
    recordingUrl: string | null;
    recordingDurationSeconds: number | null;
    transcriptionStatus: string | null;
    transcriptionText: string | null;
  } | null;
}): TimelineEvent {
  const metadata = asRecord(event.metadataJson);

  if (event.channel === "SMS") {
    const direction =
      event.type === "INBOUND_SMS_RECEIVED" ? "inbound" : "outbound";
    const rawStatus =
      recordString(metadata, "status") || event.providerStatus || undefined;
    return {
      id: event.id,
      type: "message",
      channel: "sms",
      direction,
      body: sanitizeConversationMessageBody({
        body: recordString(metadata, "body") || event.summary,
        direction,
        status: rawStatus,
      }),
      status: mapMessageStatusToTimelineStatus(
        (rawStatus || "").toUpperCase() as MessageStatus,
      ),
      createdAt: event.occurredAt.toISOString(),
      meta: {
        providerMessageSid: event.providerMessageSid,
        providerStatus: rawStatus,
      },
    };
  }

  if (event.channel === "VOICE") {
    const recordingDurationSeconds =
      event.voicemailArtifact?.recordingDurationSeconds ??
      recordNumber(metadata, "recordingDurationSeconds");
    const durationSeconds =
      recordNumber(metadata, "durationSeconds") ?? recordingDurationSeconds;
    return {
      id: event.id,
      type: "call",
      channel: "call",
      direction: "inbound",
      createdAt: event.occurredAt.toISOString(),
      meta: {
        label: communicationCallLabel(event.type),
        status: event.summary,
        fromNumberE164: recordString(metadata, "from"),
        toNumberE164: recordString(metadata, "to"),
        forwardedTo: recordString(metadata, "forwardedTo"),
        durationSeconds,
        twilioCallSid: event.providerCallSid,
        recordingSid:
          event.voicemailArtifact?.recordingSid ||
          recordString(metadata, "recordingSid"),
        recordingUrl:
          event.voicemailArtifact?.recordingUrl ||
          recordString(metadata, "recordingUrl"),
        transcriptionStatus:
          event.voicemailArtifact?.transcriptionStatus ||
          recordString(metadata, "transcriptionStatus"),
        transcriptionText:
          event.voicemailArtifact?.transcriptionText ||
          recordString(metadata, "transcriptionText"),
      },
    };
  }

  return {
    id: event.id,
    type: "system",
    channel: "system",
    createdAt: event.occurredAt.toISOString(),
    body: event.summary,
    meta: metadata || undefined,
  };
}

async function assertWorkerCanViewLead(input: {
  actorId: string;
  orgId: string;
  leadId: string;
}) {
  const allowed = await prisma.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
      OR: [
        { assignedToUserId: input.actorId },
        { createdByUserId: input.actorId },
        { events: { some: { assignedToUserId: input.actorId } } },
        {
          events: {
            some: {
              workerAssignments: { some: { workerUserId: input.actorId } },
            },
          },
        },
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
        businessType: true,
        status: true,
        priority: true,
        nextFollowUpAt: true,
        estimatedRevenueCents: true,
        notes: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            addressLine: true,
          },
        },
        events: {
          where: {
            type: {
              in: ["JOB", "ESTIMATE"],
            },
          },
          select: {
            id: true,
            jobId: true,
            type: true,
            status: true,
            startAt: true,
            endAt: true,
            createdAt: true,
            updatedAt: true,
          },
          take: 12,
        },
      },
    });

    if (!lead) {
      throw new AppApiError("Conversation not found.", 404);
    }

    assertOrgReadAccess(actor, lead.orgId);

    if (
      !actor.internalUser &&
      !canManageAnyOrgJobs(actor) &&
      actor.calendarAccessRole === "WORKER"
    ) {
      await assertWorkerCanViewLead({
        actorId: actor.id,
        orgId: lead.orgId,
        leadId: lead.id,
      });
    }

    const bookingProjection = deriveLeadBookingProjection({
      leadStatus: lead.status,
      events: lead.events,
    });

    const url = new URL(req.url);
    const limit = Math.max(
      20,
      Math.min(240, Number(url.searchParams.get("limit") || 180)),
    );

    const communicationEventsDesc = await prisma.communicationEvent.findMany({
      where: { leadId: lead.id },
      select: {
        id: true,
        type: true,
        channel: true,
        summary: true,
        occurredAt: true,
        metadataJson: true,
        providerMessageSid: true,
        providerCallSid: true,
        providerStatus: true,
        messageId: true,
        callId: true,
        voicemailArtifact: {
          select: {
            recordingSid: true,
            recordingUrl: true,
            recordingDurationSeconds: true,
            transcriptionStatus: true,
            transcriptionText: true,
          },
        },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    const communicationMessageIds = communicationEventsDesc
      .map((event) => event.messageId)
      .filter((value): value is string => Boolean(value));
    const communicationCallIds = communicationEventsDesc
      .map((event) => event.callId)
      .filter((value): value is string => Boolean(value));

    const [messagesDesc, callsDesc, blockedCaller, failedOutboundCount] =
      await Promise.all([
        prisma.message.findMany({
          where: {
            leadId: lead.id,
            ...(communicationMessageIds.length > 0
              ? {
                  id: {
                    notIn: communicationMessageIds,
                  },
                }
              : {}),
          },
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
          where: {
            leadId: lead.id,
            ...(communicationCallIds.length > 0
              ? {
                  id: {
                    notIn: communicationCallIds,
                  },
                }
              : {}),
          },
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
        findBlockedCallerByPhone({
          orgId: lead.orgId,
          phone: lead.phoneE164,
        }),
        prisma.message.count({
          where: {
            leadId: lead.id,
            direction: "OUTBOUND",
            status: "FAILED",
          },
        }),
      ]);

    const messageEvents: TimelineEvent[] = messagesDesc
      .slice()
      .reverse()
      .map((msg) => ({
        id: msg.id,
        type: "message",
        channel:
          msg.provider === ("TWILIO" as MessageProvider) ? "sms" : "system",
        direction: mapMessageDirection(msg.direction),
        leadId: lead.id,
        body: sanitizeConversationMessageBody({
          body: msg.body,
          direction: mapMessageDirection(msg.direction),
          status: msg.status,
        }),
        status: mapMessageStatusToTimelineStatus(msg.status),
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
          ended &&
          started &&
          !Number.isNaN(ended.getTime()) &&
          !Number.isNaN(started.getTime())
            ? Math.max(
                0,
                Math.round((ended.getTime() - started.getTime()) / 1000),
              )
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

    const communicationTimelineEvents = communicationEventsDesc
      .slice()
      .reverse()
      .map((event) => mapCommunicationEventToTimelineEvent(event));
    const voiceRiskSignal = findLatestVoiceRiskSignal(communicationEventsDesc);
    const potentialSpamSignals = derivePotentialSpamSignals({
      isBlockedCaller: Boolean(blockedCaller),
      latestVoiceRiskDisposition: voiceRiskSignal.disposition,
      latestVoiceRiskScore: voiceRiskSignal.score,
      failedOutboundCount,
    });

    const events = sortTimelineEventsStable([
      ...communicationTimelineEvents,
      ...messageEvents,
      ...callEvents,
    ]);

    return NextResponse.json({
      ok: true,
      lead: {
        id: lead.id,
        orgId: lead.orgId,
        contactName: lead.contactName,
        businessName: lead.businessName,
        phoneE164: lead.phoneE164,
        city: normalizeLeadCity(lead.city),
        businessType: sanitizeLeadBusinessTypeLabel(lead.businessType),
        status: bookingProjection.derivedLeadStatus,
        priority: lead.priority,
        nextFollowUpAt: bookingProjection.hasActiveBooking
          ? null
          : lead.nextFollowUpAt
            ? lead.nextFollowUpAt.toISOString()
            : null,
        estimatedRevenueCents: lead.estimatedRevenueCents,
        notes: lead.notes,
        customer: lead.customer,
        isBlockedCaller: Boolean(blockedCaller),
        potentialSpam: potentialSpamSignals.length > 0,
        potentialSpamSignals,
        failedOutboundCount,
      },
      events,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to load thread.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  // Convenience endpoint to mark worker access via shared guard patterns (no-op for v1).
  // Real read-state tracking is handled client-side for now.
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as {
      orgId?: unknown;
    } | null;
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
      await assertCanMutateLeadJob({
        actor,
        orgId: lead.orgId,
        leadId: lead.id,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to update state.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
