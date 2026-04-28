import type { MessageStatus, Prisma } from "@prisma/client";
import { dispatchStatusFromDb, getDispatchSmsDeliveryState } from "@/lib/dispatch";
import { upsertCommunicationEvent } from "@/lib/communication-events";
import { AppApiError } from "@/lib/app-api-permissions";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendOutboundSms } from "@/lib/sms";
import { getSmsConsentState } from "@/lib/sms-consent";
import {
  buildDispatchCustomerNotificationReadiness,
  buildDispatchNotificationAttemptIdempotencyKey,
  buildDispatchNotificationIdempotencyKey,
  createDispatchNotificationAttemptSummary,
  selectAutomaticDispatchCustomerNotificationCandidate,
  type DispatchCustomerCommunicationState,
  type DispatchCustomerNotificationCandidate,
  type DispatchCustomerNotificationJobRecord,
  type DispatchNotificationAttemptOutcome,
  type DispatchPersistedJobEvent,
  type PendingDispatchScheduleCustomerUpdate,
} from "@/lib/dispatch-notification-core";
import {
  getDispatchCustomerCommunicationState,
  getDispatchCustomerNotificationJob,
  getDispatchScheduleNotificationCandidate,
  getPendingDispatchScheduleCustomerUpdate,
} from "@/lib/dispatch-notification-state";
import {
  getDispatchNotificationSettings,
  updateDispatchNotificationSettings,
  type NotificationSettingsPayload,
} from "@/lib/dispatch-notification-settings";

export type { DispatchPersistedJobEvent, PendingDispatchScheduleCustomerUpdate, DispatchCustomerCommunicationState };
export { getDispatchCustomerCommunicationState, getPendingDispatchScheduleCustomerUpdate };
export { getDispatchNotificationSettings, updateDispatchNotificationSettings };
export type { NotificationSettingsPayload };

async function sendDispatchCustomerNotification(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  candidate: DispatchCustomerNotificationCandidate;
  explicit: boolean;
  recovery?: boolean;
}): Promise<{ sent: boolean; alreadySent: boolean }> {
  const [settings, job] = await Promise.all([
    getDispatchNotificationSettings(input.orgId),
    getDispatchCustomerNotificationJob({
      orgId: input.orgId,
      jobId: input.jobId,
    }),
  ]);

  const idempotencyKey = buildDispatchNotificationIdempotencyKey({
    kind: input.candidate.kind,
    orgId: input.orgId,
    eventId: input.candidate.event.id,
    status: input.candidate.notificationStatus,
  });
  const existingDispatchEvent = await prisma.communicationEvent.findUnique({
    where: {
      orgId_idempotencyKey: {
        orgId: input.orgId,
        idempotencyKey,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingDispatchEvent) {
    return {
      sent: false,
      alreadySent: true,
    };
  }

  if (!job) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  const smsConsent = await getSmsConsentState({
    orgId: input.orgId,
    phoneE164: job.phone,
  });

  const readiness = buildDispatchCustomerNotificationReadiness({
    settings,
    job,
    candidate: input.candidate,
    smsConsentStatus: smsConsent.status,
  });

  if (!readiness.allowed || !readiness.previewBody || !readiness.toNumberE164) {
    throw new AppApiError(readiness.blockedReason || "Failed to send customer update.", 409);
  }

  const body = readiness.previewBody;
  const toNumberE164 = readiness.toNumberE164;
  const occurredAt = input.explicit ? new Date() : input.candidate.event.createdAt;

  const dispatched = await sendOutboundSms({
    orgId: input.orgId,
    fromNumberE164: job.org.smsFromNumberE164 || null,
    toNumberE164,
    body,
  });

  if (dispatched.suppressed) {
    await persistDispatchCustomerNotificationAttempt({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      job,
      candidate: input.candidate,
      recovery: input.recovery === true,
      occurredAt,
      body,
      outcome: "suppressed",
      providerStatus: "SUPPRESSED",
      messageStatus: "FAILED",
      providerMessageSid: dispatched.providerMessageSid,
      failureReason: dispatched.notice || "Customer SMS was suppressed.",
    });
    throw new AppApiError(dispatched.notice || "Customer SMS was suppressed.", 409);
  }

  if (dispatched.status === "FAILED") {
    await persistDispatchCustomerNotificationAttempt({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      job,
      candidate: input.candidate,
      recovery: input.recovery === true,
      occurredAt,
      body,
      outcome: "failed",
      providerStatus: "FAILED",
      messageStatus: "FAILED",
      providerMessageSid: dispatched.providerMessageSid,
      failureReason: dispatched.notice || "Failed to send customer update.",
    });
    throw new AppApiError(dispatched.notice || "Failed to send customer update.", 409);
  }

  await persistDispatchCustomerNotificationAttempt({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    job,
    candidate: input.candidate,
    recovery: input.recovery === true,
    occurredAt,
    body,
    outcome: "sent",
    providerStatus: dispatched.status,
    messageStatus: dispatched.status as MessageStatus,
    providerMessageSid: dispatched.providerMessageSid,
    resolvedFromNumberE164: dispatched.resolvedFromNumberE164 || job.org.smsFromNumberE164 || "",
  });

  return {
    sent: true,
    alreadySent: false,
  };
}

async function persistDispatchCustomerNotificationAttempt(input: {
  orgId: string;
  actorUserId: string | null;
  job: DispatchCustomerNotificationJobRecord;
  candidate: DispatchCustomerNotificationCandidate;
  recovery: boolean;
  occurredAt: Date;
  body: string;
  outcome: DispatchNotificationAttemptOutcome;
  providerStatus: string | null;
  messageStatus: MessageStatus;
  providerMessageSid: string | null;
  failureReason?: string | null;
  resolvedFromNumberE164?: string | null;
}) {
  const idempotencyKey = buildDispatchNotificationAttemptIdempotencyKey({
    kind: input.candidate.kind,
    orgId: input.orgId,
    eventId: input.candidate.event.id,
    status: input.candidate.notificationStatus,
    outcome: input.outcome,
  });

  await prisma.$transaction(async (tx) => {
    let messageId: string | null = null;

    if (input.job.leadId) {
      const messageToNumberE164 = normalizeE164(input.job.phone || null) || input.job.phone || "";
      const message = await tx.message.create({
        data: {
          orgId: input.orgId,
          leadId: input.job.leadId,
          direction: "OUTBOUND",
          type: "SYSTEM_NUDGE",
          fromNumberE164: input.resolvedFromNumberE164 || input.job.org.smsFromNumberE164 || "",
          toNumberE164: messageToNumberE164,
          body: input.body,
          provider: "TWILIO",
          providerMessageSid: input.providerMessageSid,
          status: input.messageStatus,
        },
        select: {
          id: true,
        },
      });
      messageId = message.id;

      await tx.lead.update({
        where: { id: input.job.leadId },
        data: {
          lastContactedAt: input.occurredAt,
          lastOutboundAt: input.occurredAt,
        },
      });

      await tx.leadConversationState.updateMany({
        where: {
          leadId: input.job.leadId,
        },
        data: {
          lastOutboundAt: input.occurredAt,
        },
      });
    }

    await upsertCommunicationEvent(tx, {
      orgId: input.orgId,
      leadId: input.job.leadId,
      contactId: input.job.customerId || input.job.lead?.customerId || null,
      conversationId: input.job.lead?.conversationState?.id || null,
      messageId,
      actorUserId: input.actorUserId,
      type: "OUTBOUND_SMS_SENT",
      channel: "SMS",
      occurredAt: input.occurredAt,
      summary: createDispatchNotificationAttemptSummary({
        candidate: input.candidate,
        outcome: input.outcome,
      }),
      metadataJson: {
        body: input.body,
        dispatchJobId: input.job.id,
        dispatchStatus: dispatchStatusFromDb(input.job.dispatchStatus),
        dispatchNotificationKind: input.candidate.kind,
        dispatchNotificationStatus: input.candidate.notificationStatus,
        dispatchChangedFields: input.candidate.changedFields,
        dispatchRecoverySend: input.recovery,
        dispatchSourceEventId: input.candidate.event.id,
        dispatchAttemptOutcome: input.outcome,
        dispatchFailureReason: input.failureReason || null,
        dispatchDeliveryState: getDispatchSmsDeliveryState(input.providerStatus) || input.outcome,
      } satisfies Prisma.InputJsonValue,
      provider: "TWILIO",
      providerMessageSid: input.providerMessageSid,
      providerStatus: input.providerStatus,
      idempotencyKey,
    });
  });
}

export async function maybeSendDispatchCustomerNotifications(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  events: DispatchPersistedJobEvent[];
}) {
  if (input.events.length === 0) {
    return;
  }

  const scopedJob = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: {
      dispatchStatus: true,
    },
  });

  if (!scopedJob) {
    return;
  }

  const candidate = selectAutomaticDispatchCustomerNotificationCandidate({
    events: input.events,
    status: dispatchStatusFromDb(scopedJob.dispatchStatus),
  });

  if (!candidate) {
    return;
  }

  try {
    await sendDispatchCustomerNotification({
      orgId: input.orgId,
      jobId: input.jobId,
      actorUserId: input.actorUserId,
      candidate,
      explicit: false,
    });
  } catch {
    return;
  }
}

export async function sendPendingDispatchScheduleCustomerUpdate(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  recovery?: boolean;
}) {
  const candidate = await getDispatchScheduleNotificationCandidate(input);
  if (!candidate) {
    throw new AppApiError("No meaningful schedule change is waiting for a customer update.", 409);
  }

  const result = await sendDispatchCustomerNotification({
    orgId: input.orgId,
    jobId: input.jobId,
    actorUserId: input.actorUserId,
    candidate,
    explicit: true,
    recovery: input.recovery === true,
  });

  return {
    status: result.alreadySent ? "already_sent" : "sent",
    changedFields: candidate.changedFields,
  };
}

export async function recordDispatchManualFollowThrough(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  state: "started" | "handled";
  actionId?: string | null;
}) {
  const state = await getDispatchCustomerCommunicationState({
    orgId: input.orgId,
    jobId: input.jobId,
  });

  if (
    !state.lastCustomerUpdate?.recoverySend ||
    (state.lastCustomerUpdate.deliveryState !== "failed" && state.lastCustomerUpdate.deliveryState !== "suppressed")
  ) {
    throw new AppApiError("No recovery follow-up is waiting for manual handling.", 409);
  }

  await prisma.jobEvent.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      actorUserId: input.actorUserId,
      eventType: "JOB_UPDATED",
      metadata: {
        dispatchManualFollowThrough: true,
        dispatchManualFollowThroughState: input.state,
        dispatchManualFollowThroughActionId: input.actionId || null,
      } satisfies Prisma.InputJsonValue,
    },
  });
}

export async function recordDispatchManualContactOutcome(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  outcome: "confirmed_schedule" | "reschedule_needed" | "no_response";
}) {
  const state = await getDispatchCustomerCommunicationState({
    orgId: input.orgId,
    jobId: input.jobId,
  });

  if (
    !state.lastCustomerUpdate?.recoverySend ||
    (state.lastCustomerUpdate.deliveryState !== "failed" && state.lastCustomerUpdate.deliveryState !== "suppressed")
  ) {
    throw new AppApiError("No recovery follow-up is waiting for a manual contact outcome.", 409);
  }

  if (state.lastCustomerUpdate.manualFollowThrough?.state !== "handled") {
    throw new AppApiError("Mark the manual follow-up handled before recording the contact outcome.", 409);
  }

  await prisma.jobEvent.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      actorUserId: input.actorUserId,
      eventType: "JOB_UPDATED",
      metadata: {
        dispatchManualContactOutcome: true,
        dispatchManualContactOutcomeValue: input.outcome,
      } satisfies Prisma.InputJsonValue,
    },
  });
}
