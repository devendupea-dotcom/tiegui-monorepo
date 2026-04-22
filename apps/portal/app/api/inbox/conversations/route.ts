import { NextResponse } from "next/server";
import type {
  LeadSource,
  LeadSourceType,
  LeadStatus,
  LeadPriority,
  CallStatus,
  MessageStatus,
} from "@prisma/client";
import { deriveLeadBookingProjection } from "@/lib/booking-read-model";
import { sanitizeConversationSnippet } from "@/lib/inbox-message-display";
import {
  derivePotentialSpamSignals,
  type PotentialSpamSignal,
} from "@/lib/lead-spam";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationRow = {
  id: string; // conversationId (leadId for v1)
  leadId: string;
  contactName: string;
  phoneE164: string;
  status: LeadStatus;
  priority: LeadPriority;
  sourceType: LeadSourceType;
  leadSource: LeadSource;
  nextFollowUpAt: string | null;
  lastEventAt: string;
  lastSnippet: string;
  lastChannel: "sms" | "call" | "system";
  channels: {
    sms: boolean;
    call: boolean;
    meta: boolean;
  };
  unreadCount: number;
  atRisk: boolean;
  potentialSpam: boolean;
  potentialSpamSignals: PotentialSpamSignal[];
  failedOutboundCount: number;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function callSnippet(status: CallStatus): string {
  if (status === "MISSED") return "Missed call";
  if (status === "VOICEMAIL") return "Voicemail";
  if (status === "ANSWERED") return "Answered call";
  return "Call";
}

function messageSnippet(input: {
  body: string;
  status: MessageStatus | null | undefined;
}): string {
  return sanitizeConversationSnippet({
    body: input.body,
    status: input.status,
  });
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

function isAtRisk(input: {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  now: Date;
}): boolean {
  if (!input.lastInboundAt) return false;
  if (input.lastOutboundAt && input.lastOutboundAt >= input.lastInboundAt)
    return false;
  const minutes =
    (input.now.getTime() - input.lastInboundAt.getTime()) / (60 * 1000);
  return minutes >= 12;
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const requestedOrgId = url.searchParams.get("orgId");
    const orgId = await resolveActorOrgId({ actor, requestedOrgId });

    const limit = clampInt(
      Number(url.searchParams.get("limit") || 70),
      10,
      200,
    );
    const now = new Date();

    const workerScoped =
      !actor.internalUser && actor.calendarAccessRole === "WORKER";

    const leadWhere = {
      orgId,
      AND: [
        {
          OR: [{ messages: { some: {} } }, { calls: { some: {} } }],
        },
        ...(workerScoped
          ? [
              {
                OR: [
                  { assignedToUserId: actor.id },
                  { createdByUserId: actor.id },
                  { events: { some: { assignedToUserId: actor.id } } },
                  {
                    events: {
                      some: {
                        workerAssignments: { some: { workerUserId: actor.id } },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };

    const leads = await prisma.lead.findMany({
      where: leadWhere,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        status: true,
        priority: true,
        leadSource: true,
        sourceType: true,
        nextFollowUpAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
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
        messages: {
          select: {
            direction: true,
            body: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        calls: {
          select: {
            direction: true,
            status: true,
            startedAt: true,
          },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
      take: 400,
    });

    const leadIds = leads.map((lead) => lead.id);
    const phoneNumbers = [
      ...new Set(leads.map((lead) => lead.phoneE164).filter(Boolean)),
    ];
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [blockedCallers, failedOutboundGroups, voiceRiskEvents] =
      await Promise.all([
        phoneNumbers.length > 0
          ? prisma.blockedCaller.findMany({
              where: {
                orgId,
                phoneE164: { in: phoneNumbers },
              },
              select: {
                phoneE164: true,
              },
            })
          : Promise.resolve([]),
        leadIds.length > 0
          ? prisma.message.groupBy({
              by: ["leadId"],
              where: {
                leadId: { in: leadIds },
                direction: "OUTBOUND",
                status: "FAILED",
              },
              _count: {
                _all: true,
              },
            })
          : Promise.resolve([]),
        leadIds.length > 0
          ? prisma.communicationEvent.findMany({
              where: {
                orgId,
                leadId: { in: leadIds },
                channel: "VOICE",
                occurredAt: { gte: since30d },
              },
              select: {
                leadId: true,
                occurredAt: true,
                metadataJson: true,
              },
              orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
              take: 2000,
            })
          : Promise.resolve([]),
      ]);

    const blockedCallerPhones = new Set(
      blockedCallers.map((blockedCaller) => blockedCaller.phoneE164),
    );
    const failedOutboundByLead = new Map(
      failedOutboundGroups.map((group) => [group.leadId, group._count._all]),
    );
    const latestVoiceRiskByLead = new Map<
      string,
      { disposition: string | null; score: number | null }
    >();

    for (const event of voiceRiskEvents) {
      if (!event.leadId || latestVoiceRiskByLead.has(event.leadId)) {
        continue;
      }
      const metadata = asRecord(event.metadataJson);
      const disposition = recordString(metadata, "riskDisposition") || null;
      const score = recordNumber(metadata, "riskScore") ?? null;
      if (!disposition && score == null) {
        continue;
      }
      latestVoiceRiskByLead.set(event.leadId, {
        disposition,
        score,
      });
    }

    const rows: ConversationRow[] = leads
      .map((lead) => {
        const lastMessage = lead.messages[0] || null;
        const lastCall = lead.calls[0] || null;

        const lastMessageAt = lastMessage?.createdAt
          ? new Date(lastMessage.createdAt)
          : null;
        const lastCallAt = lastCall?.startedAt
          ? new Date(lastCall.startedAt)
          : null;
        const lastEventAt = new Date(
          Math.max(
            lastMessageAt ? lastMessageAt.getTime() : 0,
            lastCallAt ? lastCallAt.getTime() : 0,
          ),
        );

        let lastSnippet = "";
        let lastChannel: ConversationRow["lastChannel"] = "system";
        if (lastMessageAt && (!lastCallAt || lastMessageAt >= lastCallAt)) {
          lastSnippet = messageSnippet({
            body: lastMessage?.body || "",
            status: lastMessage?.status,
          });
          lastChannel = "sms";
        } else if (lastCallAt) {
          lastSnippet = callSnippet(lastCall?.status || "RINGING");
          lastChannel = "call";
        }

        const contactName = (
          lead.contactName ||
          lead.businessName ||
          lead.phoneE164 ||
          ""
        ).trim();
        const unreadCount =
          lead.lastInboundAt &&
          (!lead.lastOutboundAt || lead.lastOutboundAt < lead.lastInboundAt)
            ? 1
            : 0;
        const bookingProjection = deriveLeadBookingProjection({
          leadStatus: lead.status,
          events: lead.events,
        });
        const failedOutboundCount = failedOutboundByLead.get(lead.id) || 0;
        const latestVoiceRisk = latestVoiceRiskByLead.get(lead.id);
        const potentialSpamSignals = derivePotentialSpamSignals({
          isBlockedCaller: blockedCallerPhones.has(lead.phoneE164),
          latestVoiceRiskDisposition: latestVoiceRisk?.disposition || null,
          latestVoiceRiskScore: latestVoiceRisk?.score ?? null,
          failedOutboundCount,
        });

        return {
          id: lead.id,
          leadId: lead.id,
          contactName: contactName || lead.phoneE164,
          phoneE164: lead.phoneE164,
          status: bookingProjection.derivedLeadStatus,
          priority: lead.priority,
          sourceType: lead.sourceType,
          leadSource: lead.leadSource,
          nextFollowUpAt: bookingProjection.hasActiveBooking
            ? null
            : lead.nextFollowUpAt
              ? lead.nextFollowUpAt.toISOString()
              : null,
          lastEventAt: lastEventAt.toISOString(),
          lastSnippet,
          lastChannel,
          channels: {
            sms: Boolean(lastMessage),
            call: Boolean(lastCall),
            meta: false,
          },
          unreadCount,
          atRisk: bookingProjection.hasActiveBooking
            ? false
            : isAtRisk({
                lastInboundAt: lead.lastInboundAt,
                lastOutboundAt: lead.lastOutboundAt,
                now,
              }),
          potentialSpam: potentialSpamSignals.length > 0,
          potentialSpamSignals,
          failedOutboundCount,
        };
      })
      .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
      .slice(0, limit);

    return NextResponse.json({ ok: true, conversations: rows });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to load conversations.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
