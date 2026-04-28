import { prisma } from "@/lib/prisma";
import { upsertCommunicationEvent } from "@/lib/communication-events";
import {
  queueConversationalIntroForQuietHours,
  startConversationalSmsFromMissedCall,
} from "@/lib/conversational-sms";
import {
  MISSED_CALL_DUPLICATE_WINDOW_MINUTES,
  buildMissedCallRecoveryKey,
  createMissedCallRecoveryRunner,
  evaluateMissedCallTextEligibility,
  type MissedCallRecoveryDecision,
  type RecoveryCandidate,
} from "@/lib/missed-call-recovery-core";
import { isWithinSmsSendWindow, nextSmsSendWindowStartUtc } from "@/lib/sms-quiet-hours";

function decisionSummary(decision: MissedCallRecoveryDecision) {
  if (decision.action === "send") {
    return "Missed-call text sent";
  }
  if (decision.action === "queue") {
    return "Missed-call text queued for business hours";
  }
  switch (decision.reason) {
    case "already_processed":
      return "Missed-call text already processed";
    case "answered":
      return "Missed-call text skipped because the call was answered";
    case "disabled":
      return "Missed-call text skipped because automation is disabled";
    case "missing_phone":
      return "Missed-call text skipped because the caller number is missing";
    case "missing_sender":
      return "Missed-call text skipped because no sender number is configured";
    case "dnc":
      return "Missed-call text skipped because the lead is opted out";
    case "recent_outbound":
      return "Missed-call text skipped because a recent outbound message already exists";
    default:
      return "Missed-call text skipped";
  }
}

function decisionEventType(decision: MissedCallRecoveryDecision) {
  if (decision.action === "send") {
    return "MISSED_CALL_TEXT_SENT" as const;
  }
  if (decision.action === "queue") {
    return "MISSED_CALL_TEXT_QUEUED" as const;
  }
  return "MISSED_CALL_TEXT_SKIPPED" as const;
}

function mapDispatchSkipDecision(input: {
  reason: string;
  withinBusinessHours: boolean;
}): MissedCallRecoveryDecision {
  switch (input.reason) {
    case "lead_dnc":
      return { action: "skip", reason: "dnc", withinBusinessHours: input.withinBusinessHours };
    case "auto_reply_disabled":
      return { action: "skip", reason: "disabled", withinBusinessHours: input.withinBusinessHours };
    default:
      return { action: "skip", reason: "already_processed", withinBusinessHours: input.withinBusinessHours };
  }
}

async function finalizeReservedDecisionEvent(input: {
  eventId: string;
  candidate: RecoveryCandidate;
  decision: MissedCallRecoveryDecision;
  senderNumberE164?: string | null;
  dispatchReason?: string | null;
}) {
  await prisma.communicationEvent.update({
    where: { id: input.eventId },
    data: {
      type: decisionEventType(input.decision),
      summary: decisionSummary(input.decision),
      metadataJson: {
        source: input.candidate.source,
        reason: input.decision.reason,
        withinBusinessHours: input.decision.withinBusinessHours,
        sendAfterAt: input.decision.action === "queue" ? input.decision.sendAfterAt.toISOString() : null,
        duplicateWindowMinutes: MISSED_CALL_DUPLICATE_WINDOW_MINUTES,
        fromNumberE164: input.candidate.fromNumberE164,
        senderNumberE164: input.senderNumberE164 || null,
        occurredAt: input.candidate.occurredAt.toISOString(),
        forwardedTo: input.candidate.forwardedTo || null,
        dispatchReason: input.dispatchReason || null,
        finalizedAt: new Date().toISOString(),
      },
    },
  });
}

async function releaseReservedDecisionEvent(eventId: string | undefined) {
  if (!eventId) {
    return;
  }
  await prisma.communicationEvent.delete({ where: { id: eventId } }).catch(() => undefined);
}

const processMissedCallRecoveryImpl = createMissedCallRecoveryRunner({
  async reserveDecision(candidate) {
    const decisionKey = buildMissedCallRecoveryKey(candidate);

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${candidate.orgId}), hashtext(${decisionKey}))
      `;

      const existing = await tx.communicationEvent.findUnique({
        where: {
          orgId_idempotencyKey: {
            orgId: candidate.orgId,
            idempotencyKey: decisionKey,
          },
        },
        select: {
          id: true,
          type: true,
          metadataJson: true,
        },
      });

      if (existing) {
        const metadata = (existing.metadataJson && typeof existing.metadataJson === "object"
          ? existing.metadataJson
          : {}) as Record<string, unknown>;
        const action =
          existing.type === "MISSED_CALL_TEXT_SENT"
            ? "send"
            : existing.type === "MISSED_CALL_TEXT_QUEUED"
              ? "queue"
              : "skip";
        const reason = typeof metadata.reason === "string" ? metadata.reason : "already_processed";
        return {
          alreadyProcessed: true,
          decisionKey,
          eventId: existing.id,
          decision:
            action === "send"
              ? ({ action, reason: "eligible", withinBusinessHours: true } as MissedCallRecoveryDecision)
              : action === "queue"
                ? ({
                    action,
                    reason: "quiet_hours",
                    withinBusinessHours: false,
                    sendAfterAt: new Date(
                      typeof metadata.sendAfterAt === "string" ? metadata.sendAfterAt : candidate.occurredAt.toISOString(),
                    ),
                  } as MissedCallRecoveryDecision)
                : ({
                    action,
                    reason:
                      reason === "answered" ||
                      reason === "disabled" ||
                      reason === "missing_phone" ||
                      reason === "missing_sender" ||
                      reason === "dnc" ||
                      reason === "recent_outbound" ||
                      reason === "already_processed"
                        ? reason
                        : "already_processed",
                    withinBusinessHours: Boolean(metadata.withinBusinessHours),
                  } as MissedCallRecoveryDecision),
        };
      }

      const [lead, organization, hasAnsweredEvent, recentOutbound] = await Promise.all([
        tx.lead.findUnique({
          where: { id: candidate.leadId },
          select: {
            id: true,
            status: true,
            customerId: true,
            conversationState: {
              select: { id: true },
            },
          },
        }),
        tx.organization.findUnique({
          where: { id: candidate.orgId },
          select: {
            id: true,
            missedCallAutoReplyOn: true,
            autoReplyEnabled: true,
            smsFromNumberE164: true,
            smsQuietHoursStartMinute: true,
            smsQuietHoursEndMinute: true,
            messagingSettings: {
              select: {
                autoReplyEnabled: true,
              },
            },
            dashboardConfig: {
              select: {
                calendarTimezone: true,
              },
            },
            twilioConfig: {
              select: {
                phoneNumber: true,
              },
            },
          },
        }),
        candidate.callSid
          ? tx.communicationEvent.findFirst({
              where: {
                orgId: candidate.orgId,
                providerCallSid: candidate.callSid,
                type: {
                  in: ["OWNER_ANSWERED", "COMPLETED"],
                },
              },
              select: { id: true },
            })
          : Promise.resolve(null),
        tx.message.findFirst({
          where: {
            orgId: candidate.orgId,
            leadId: candidate.leadId,
            direction: "OUTBOUND",
            createdAt: {
              gte: new Date(candidate.occurredAt.getTime() - MISSED_CALL_DUPLICATE_WINDOW_MINUTES * 60 * 1000),
            },
          },
          select: { id: true },
        }),
      ]);

      const timeZone = organization?.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
      const withinBusinessHours = isWithinSmsSendWindow({
        at: new Date(),
        timeZone,
        startMinute: organization?.smsQuietHoursStartMinute || 480,
        endMinute: organization?.smsQuietHoursEndMinute || 1200,
      });
      const sendAfterAt = withinBusinessHours
        ? null
        : nextSmsSendWindowStartUtc({
            at: new Date(),
            timeZone,
            startMinute: organization?.smsQuietHoursStartMinute || 480,
            endMinute: organization?.smsQuietHoursEndMinute || 1200,
          });

      const senderNumber =
        organization?.smsFromNumberE164 || organization?.twilioConfig?.phoneNumber || candidate.toNumberE164 || null;

      const decision = evaluateMissedCallTextEligibility({
        missedCallAutoReplyOn: Boolean(
          organization?.missedCallAutoReplyOn &&
            (organization?.messagingSettings?.autoReplyEnabled ?? organization?.autoReplyEnabled ?? true),
        ),
        leadStatus: lead?.status || null,
        fromNumberE164: candidate.fromNumberE164,
        senderNumberE164: senderNumber,
        hasAnsweredEvent: Boolean(hasAnsweredEvent),
        hasRecentOutbound: Boolean(recentOutbound),
        withinBusinessHours,
        sendAfterAt,
      });

      const event = await upsertCommunicationEvent(tx, {
        orgId: candidate.orgId,
        leadId: lead?.id || candidate.leadId,
        contactId: candidate.contactId || lead?.customerId || null,
        conversationId: candidate.conversationId || lead?.conversationState?.id || null,
        callId: candidate.callId || null,
        type: decisionEventType(decision),
        channel: "SYSTEM",
        occurredAt: new Date(),
        summary: decisionSummary(decision),
        provider: "TWILIO",
        providerCallSid: candidate.callSid || null,
        metadataJson: {
          source: candidate.source,
          reason: decision.reason,
          withinBusinessHours: decision.withinBusinessHours,
          sendAfterAt: decision.action === "queue" ? decision.sendAfterAt.toISOString() : null,
          duplicateWindowMinutes: MISSED_CALL_DUPLICATE_WINDOW_MINUTES,
          fromNumberE164: candidate.fromNumberE164,
          senderNumberE164: senderNumber,
          occurredAt: candidate.occurredAt.toISOString(),
          forwardedTo: candidate.forwardedTo || null,
        },
        idempotencyKey: decisionKey,
      });

      return {
        alreadyProcessed: false,
        decisionKey,
        eventId: event.id,
        decision,
      };
    });
  },

  async dispatchDecision(candidate, reserved) {
    const decision = reserved.decision;
    if (!decision || decision.action === "skip") {
      return decision || { action: "skip", reason: "already_processed", withinBusinessHours: true };
    }

    if (decision.action === "send") {
      const result = await startConversationalSmsFromMissedCall({
        orgId: candidate.orgId,
        leadId: candidate.leadId,
        toNumberE164: candidate.fromNumberE164 || "",
      });

      if (result.outcome === "sent") {
        return decision;
      }

      if (result.outcome === "skipped") {
        const skippedDecision = mapDispatchSkipDecision({
          reason: result.reason,
          withinBusinessHours: decision.withinBusinessHours,
        });
        if (reserved.eventId) {
          await finalizeReservedDecisionEvent({
            eventId: reserved.eventId,
            candidate,
            decision: skippedDecision,
            senderNumberE164: candidate.toNumberE164 || null,
            dispatchReason: result.reason,
          });
        }
        return skippedDecision;
      }

      await releaseReservedDecisionEvent(reserved.eventId);
      return {
        action: "skip",
        reason: "already_processed",
        withinBusinessHours: decision.withinBusinessHours,
      };
    }

    const result = await queueConversationalIntroForQuietHours({
      orgId: candidate.orgId,
      leadId: candidate.leadId,
      toNumberE164: candidate.fromNumberE164 || "",
      sendAfterAt: decision.sendAfterAt,
    });

    if (result.outcome === "queued") {
      return decision;
    }

    if (result.outcome === "skipped") {
      const skippedDecision = mapDispatchSkipDecision({
        reason: result.reason,
        withinBusinessHours: decision.withinBusinessHours,
      });
      if (reserved.eventId) {
        await finalizeReservedDecisionEvent({
          eventId: reserved.eventId,
          candidate,
          decision: skippedDecision,
          senderNumberE164: candidate.toNumberE164 || null,
          dispatchReason: result.reason,
        });
      }
      return skippedDecision;
    }

    await releaseReservedDecisionEvent(reserved.eventId);
    return {
      action: "skip",
      reason: "already_processed",
      withinBusinessHours: decision.withinBusinessHours,
    };
  },
});

export async function processMissedCallRecovery(candidate: RecoveryCandidate) {
  return processMissedCallRecoveryImpl(candidate);
}
