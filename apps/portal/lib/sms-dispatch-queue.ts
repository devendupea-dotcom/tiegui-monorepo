import type { LeadIntakeStage, MessageStatus } from "@prisma/client";
import { addMinutes } from "date-fns";
import { recordOutboundSmsCommunicationEvent } from "@/lib/communication-events";
import { prisma } from "@/lib/prisma";
import { getQueuedSmsSkipReason } from "@/lib/sms-automation-guards";
import { sendOutboundSms } from "@/lib/sms";
import { isWithinSmsSendWindow, nextSmsSendWindowStartUtc } from "@/lib/sms-quiet-hours";

type QueueDispatchInput = {
  orgId: string;
  leadId: string;
  kind: "MISSED_CALL_INTRO" | "AUTOMATION_GENERIC";
  messageType: "AUTOMATION" | "SYSTEM_NUDGE" | "MANUAL";
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
  sendAfterAt: Date;
};

const RETRY_DELAY_MINUTES_WHEN_SMS_DISABLED = 15;
const DISPATCH_CLAIM_HOLD_MINUTES = 5;

function intakeStageAfterDispatch(intakeAutomationEnabled: boolean): LeadIntakeStage {
  return intakeAutomationEnabled ? "WAITING_LOCATION" : "INTRO_SENT";
}

async function createOutboundMessageFromDispatch(input: {
  orgId: string;
  leadId: string;
  messageType: "AUTOMATION" | "SYSTEM_NUDGE" | "MANUAL";
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
  providerMessageSid: string | null;
  status: MessageStatus;
}) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const [lead, message] = await Promise.all([
      tx.lead.findUnique({
        where: { id: input.leadId },
        select: {
          customerId: true,
          conversationState: {
            select: {
              id: true,
            },
          },
        },
      }),
      tx.message.create({
        data: {
          orgId: input.orgId,
          leadId: input.leadId,
        direction: "OUTBOUND",
        type: input.messageType,
        fromNumberE164: input.fromNumberE164,
        toNumberE164: input.toNumberE164,
        body: input.body,
        provider: "TWILIO",
          providerMessageSid: input.providerMessageSid,
          status: input.status,
        },
        select: {
          id: true,
          createdAt: true,
        },
      }),
    ]);

    await recordOutboundSmsCommunicationEvent(tx, {
      orgId: input.orgId,
      leadId: input.leadId,
      contactId: lead?.customerId || null,
      conversationId: lead?.conversationState?.id || null,
      messageId: message.id,
      body: input.body,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      providerMessageSid: input.providerMessageSid,
      status: input.status,
      occurredAt: message.createdAt,
    });

    await tx.lead.update({
      where: { id: input.leadId },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
      },
    });

    await tx.leadConversationState.updateMany({
      where: { leadId: input.leadId },
      data: {
        lastOutboundAt: now,
      },
    });
  });
}

export async function queueSmsDispatch(input: QueueDispatchInput): Promise<{ id: string; created: boolean }> {
  const duplicate = await prisma.smsDispatchQueue.findFirst({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      kind: input.kind,
      messageType: input.messageType,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      body: input.body,
      status: "QUEUED",
      sendAfterAt: {
        lte: addMinutes(input.sendAfterAt, 3),
        gte: addMinutes(input.sendAfterAt, -3),
      },
    },
    select: { id: true },
  });

  if (duplicate) {
    return { id: duplicate.id, created: false };
  }

  const queued = await prisma.smsDispatchQueue.create({
    data: {
      orgId: input.orgId,
      leadId: input.leadId,
      kind: input.kind,
      messageType: input.messageType,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      body: input.body,
      sendAfterAt: input.sendAfterAt,
      status: "QUEUED",
    },
    select: { id: true },
  });

  return { id: queued.id, created: true };
}

export async function processDueSmsDispatchQueue(input?: {
  maxJobs?: number;
}): Promise<{
  scanned: number;
  sent: number;
  failed: number;
  deferred: number;
  skippedOptOut: number;
  skippedStale: number;
}> {
  const now = new Date();
  const maxJobs = Math.max(1, Math.min(500, input?.maxJobs ?? 100));

  const jobs = await prisma.smsDispatchQueue.findMany({
    where: {
      status: "QUEUED",
      sendAfterAt: { lte: now },
    },
    orderBy: [{ sendAfterAt: "asc" }, { createdAt: "asc" }],
    take: maxJobs,
    select: {
      id: true,
      orgId: true,
      leadId: true,
      kind: true,
      messageType: true,
      fromNumberE164: true,
      toNumberE164: true,
      body: true,
      attemptCount: true,
      sendAfterAt: true,
      createdAt: true,
      org: {
        select: {
          intakeAutomationEnabled: true,
          smsQuietHoursStartMinute: true,
          smsQuietHoursEndMinute: true,
          dashboardConfig: {
            select: { calendarTimezone: true },
          },
        },
      },
      lead: {
        select: {
          status: true,
          intakeStage: true,
          lastInboundAt: true,
          conversationState: {
            select: {
              stage: true,
              pausedUntil: true,
              stoppedAt: true,
            },
          },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let skippedOptOut = 0;
  let skippedStale = 0;

  for (const job of jobs) {
    const claimUntil = addMinutes(now, DISPATCH_CLAIM_HOLD_MINUTES);
    const claim = await prisma.smsDispatchQueue.updateMany({
      where: {
        id: job.id,
        status: "QUEUED",
        sendAfterAt: job.sendAfterAt,
      },
      data: {
        sendAfterAt: claimUntil,
      },
    });

    if (claim.count === 0) {
      continue;
    }

    const liveJob = await prisma.smsDispatchQueue.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        orgId: true,
        leadId: true,
        kind: true,
        messageType: true,
        fromNumberE164: true,
        toNumberE164: true,
        body: true,
        attemptCount: true,
        createdAt: true,
        status: true,
        org: {
          select: {
            intakeAutomationEnabled: true,
            smsQuietHoursStartMinute: true,
            smsQuietHoursEndMinute: true,
            dashboardConfig: {
              select: { calendarTimezone: true },
            },
          },
        },
        lead: {
          select: {
            status: true,
            intakeStage: true,
            lastInboundAt: true,
            conversationState: {
              select: {
                stage: true,
                pausedUntil: true,
                stoppedAt: true,
              },
            },
          },
        },
      },
    });

    if (!liveJob || liveJob.status !== "QUEUED") {
      continue;
    }

    const skipReason = getQueuedSmsSkipReason({
      jobCreatedAt: liveJob.createdAt,
      leadStatus: liveJob.lead.status,
      leadLastInboundAt: liveJob.lead.lastInboundAt,
      messageType: liveJob.messageType,
      conversationState: liveJob.lead.conversationState,
      now,
    });

    if (skipReason) {
      if (liveJob.lead.status === "DNC") {
        skippedOptOut += 1;
      } else {
        skippedStale += 1;
      }
      await prisma.smsDispatchQueue.update({
        where: { id: liveJob.id },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastError: skipReason,
        },
      });
      continue;
    }

    const timezone = liveJob.org.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
    const isOpenWindow = isWithinSmsSendWindow({
      at: now,
      timeZone: timezone,
      startMinute: liveJob.org.smsQuietHoursStartMinute,
      endMinute: liveJob.org.smsQuietHoursEndMinute,
    });

    if (!isOpenWindow) {
      const retryAt = nextSmsSendWindowStartUtc({
        at: now,
        timeZone: timezone,
        startMinute: liveJob.org.smsQuietHoursStartMinute,
        endMinute: liveJob.org.smsQuietHoursEndMinute,
      });
      deferred += 1;
      await prisma.smsDispatchQueue.update({
        where: { id: liveJob.id },
        data: {
          sendAfterAt: retryAt,
          lastError: "Deferred to next allowed SMS send window.",
        },
      });
      continue;
    }

    const providerResult = await sendOutboundSms({
      orgId: liveJob.orgId,
      fromNumberE164: liveJob.fromNumberE164,
      toNumberE164: liveJob.toNumberE164,
      body: liveJob.body,
      allowPendingA2P: liveJob.kind === "MISSED_CALL_INTRO",
    });

    if (providerResult.suppressed) {
      skippedOptOut += 1;
      await prisma.smsDispatchQueue.update({
        where: { id: liveJob.id },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastError: providerResult.notice || "Suppressed outbound SMS because the contact is opted out.",
        },
      });
      continue;
    }

    if (providerResult.status === "QUEUED" && !providerResult.providerMessageSid) {
      deferred += 1;
      await prisma.smsDispatchQueue.update({
        where: { id: liveJob.id },
        data: {
          sendAfterAt: addMinutes(now, RETRY_DELAY_MINUTES_WHEN_SMS_DISABLED),
          attemptCount: { increment: 1 },
          lastError: providerResult.notice || "Twilio sending unavailable; retrying.",
        },
      });
      continue;
    }

    await createOutboundMessageFromDispatch({
      orgId: liveJob.orgId,
      leadId: liveJob.leadId,
      messageType: liveJob.messageType,
      fromNumberE164: providerResult.resolvedFromNumberE164 || liveJob.fromNumberE164,
      toNumberE164: liveJob.toNumberE164,
      body: liveJob.body,
      providerMessageSid: providerResult.providerMessageSid,
      status: providerResult.status,
    });

    if (liveJob.kind === "MISSED_CALL_INTRO" && providerResult.status !== "FAILED") {
      const nextStage = intakeStageAfterDispatch(liveJob.org.intakeAutomationEnabled);
      await prisma.lead.updateMany({
        where: {
          id: liveJob.leadId,
          intakeStage: {
            in: ["NONE", "INTRO_SENT"],
          },
        },
        data: { intakeStage: nextStage },
      });
    }

    await prisma.smsDispatchQueue.update({
      where: { id: liveJob.id },
      data: {
        status: providerResult.status === "FAILED" ? "FAILED" : "SENT",
        attemptCount: { increment: 1 },
        lastError: providerResult.notice || null,
      },
    });

    if (providerResult.status === "FAILED") {
      failed += 1;
    } else {
      sent += 1;
    }
  }

  return {
    scanned: jobs.length,
    sent,
    failed,
    deferred,
    skippedOptOut,
    skippedStale,
  };
}
