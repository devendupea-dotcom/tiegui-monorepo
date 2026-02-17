import type { LeadIntakeStage, MessageStatus } from "@prisma/client";
import { addMinutes } from "date-fns";
import { prisma } from "@/lib/prisma";
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
    await tx.message.create({
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
    });

    await tx.lead.update({
      where: { id: input.leadId },
      data: {
        lastContactedAt: now,
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
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let skippedOptOut = 0;

  for (const job of jobs) {
    if (job.lead.status === "DNC") {
      skippedOptOut += 1;
      await prisma.smsDispatchQueue.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastError: "Lead is opted out (DNC/STOP).",
        },
      });
      continue;
    }

    const timezone = job.org.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
    const isOpenWindow = isWithinSmsSendWindow({
      at: now,
      timeZone: timezone,
      startMinute: job.org.smsQuietHoursStartMinute,
      endMinute: job.org.smsQuietHoursEndMinute,
    });

    if (!isOpenWindow) {
      const retryAt = nextSmsSendWindowStartUtc({
        at: now,
        timeZone: timezone,
        startMinute: job.org.smsQuietHoursStartMinute,
        endMinute: job.org.smsQuietHoursEndMinute,
      });
      deferred += 1;
      await prisma.smsDispatchQueue.update({
        where: { id: job.id },
        data: {
          sendAfterAt: retryAt,
          lastError: "Deferred to next allowed SMS send window.",
        },
      });
      continue;
    }

    const providerResult = await sendOutboundSms({
      orgId: job.orgId,
      fromNumberE164: job.fromNumberE164,
      toNumberE164: job.toNumberE164,
      body: job.body,
    });

    if (providerResult.status === "QUEUED" && !providerResult.providerMessageSid) {
      deferred += 1;
      await prisma.smsDispatchQueue.update({
        where: { id: job.id },
        data: {
          sendAfterAt: addMinutes(now, RETRY_DELAY_MINUTES_WHEN_SMS_DISABLED),
          attemptCount: { increment: 1 },
          lastError: providerResult.notice || "Twilio sending unavailable; retrying.",
        },
      });
      continue;
    }

    await createOutboundMessageFromDispatch({
      orgId: job.orgId,
      leadId: job.leadId,
      messageType: job.messageType,
      fromNumberE164: providerResult.resolvedFromNumberE164 || job.fromNumberE164,
      toNumberE164: job.toNumberE164,
      body: job.body,
      providerMessageSid: providerResult.providerMessageSid,
      status: providerResult.status,
    });

    if (job.kind === "MISSED_CALL_INTRO" && providerResult.status !== "FAILED") {
      const nextStage = intakeStageAfterDispatch(job.org.intakeAutomationEnabled);
      await prisma.lead.updateMany({
        where: {
          id: job.leadId,
          intakeStage: {
            in: ["NONE", "INTRO_SENT"],
          },
        },
        data: { intakeStage: nextStage },
      });
    }

    await prisma.smsDispatchQueue.update({
      where: { id: job.id },
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
  };
}
