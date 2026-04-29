import type { Prisma } from "@prisma/client";
import {
  describeDispatchSmsOperatorIssue,
  getDispatchSmsDeliveryState,
  getDispatchSmsRemediation,
} from "@/lib/dispatch";
import { prisma } from "@/lib/prisma";
import {
  asRecord,
  buildDispatchCustomerNotificationReadiness,
  buildDispatchNotificationIdempotencyKey,
  dispatchCustomerNotificationJobSelect,
  recordBoolean,
  recordDate,
  recordString,
  resolveDispatchNotificationEventStatus,
  resolveDispatchNotificationStatus,
  selectLatestDispatchScheduleChangeCandidate,
  type DispatchCustomerCommunicationState,
  type DispatchCustomerNotificationCandidate,
  type DispatchCustomerNotificationJobRecord,
  type DispatchCustomerResponseAfterSendState,
  type DispatchManualContactOutcomeState,
  type DispatchManualFollowThroughState,
  type DispatchNotificationEvent,
  type DispatchOperatorFollowUpAfterResponseState,
  type PendingDispatchScheduleCustomerUpdate,
} from "@/lib/dispatch-notification-core";
import { getDispatchNotificationSettings } from "@/lib/dispatch-notification-settings";
import { getSmsConsentState } from "@/lib/sms-consent";

export async function getDispatchCustomerNotificationJob(input: {
  orgId: string;
  jobId: string;
}): Promise<DispatchCustomerNotificationJobRecord | null> {
  return prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: dispatchCustomerNotificationJobSelect,
  });
}

export async function getDispatchScheduleNotificationCandidate(input: {
  orgId: string;
  jobId: string;
}): Promise<DispatchCustomerNotificationCandidate | null> {
  const [job, events] = await Promise.all([
    prisma.job.findFirst({
      where: {
        id: input.jobId,
        orgId: input.orgId,
      },
      select: {
        dispatchStatus: true,
      },
    }),
    prisma.jobEvent.findMany({
      where: {
        jobId: input.jobId,
        orgId: input.orgId,
        eventType: "JOB_UPDATED",
      },
      select: {
        id: true,
        eventType: true,
        fromValue: true,
        toValue: true,
        createdAt: true,
        metadata: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 12,
    }),
  ]);

  if (!job) {
    return null;
  }

  return selectLatestDispatchScheduleChangeCandidate({
    events: events as DispatchNotificationEvent[],
    status: resolveDispatchNotificationEventStatus(job.dispatchStatus),
  });
}

async function getLatestDispatchManualFollowThrough(input: {
  orgId: string;
  jobId: string;
  since: Date;
}): Promise<DispatchManualFollowThroughState | null> {
  const events = await prisma.jobEvent.findMany({
    where: {
      orgId: input.orgId,
      jobId: input.jobId,
      eventType: "JOB_UPDATED",
      createdAt: {
        gte: input.since,
      },
    },
    select: {
      createdAt: true,
      metadata: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 12,
  });

  for (const event of events) {
    const metadata = asRecord(event.metadata);
    if (!recordBoolean(metadata, "dispatchManualFollowThrough")) {
      continue;
    }

    const state = recordString(metadata, "dispatchManualFollowThroughState");
    if (state !== "started" && state !== "handled") {
      continue;
    }

    return {
      state,
      actionId: recordString(metadata, "dispatchManualFollowThroughActionId"),
      occurredAt: event.createdAt,
    };
  }

  return null;
}

async function getLatestDispatchManualContactOutcome(input: {
  orgId: string;
  jobId: string;
  since: Date;
}): Promise<DispatchManualContactOutcomeState | null> {
  const events = await prisma.jobEvent.findMany({
    where: {
      orgId: input.orgId,
      jobId: input.jobId,
      eventType: "JOB_UPDATED",
      createdAt: {
        gte: input.since,
      },
    },
    select: {
      createdAt: true,
      metadata: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 12,
  });

  for (const event of events) {
    const metadata = asRecord(event.metadata);
    if (!recordBoolean(metadata, "dispatchManualContactOutcome")) {
      continue;
    }

    const outcome = recordString(metadata, "dispatchManualContactOutcomeValue");
    if (outcome !== "confirmed_schedule" && outcome !== "reschedule_needed" && outcome !== "no_response") {
      continue;
    }

    return {
      outcome,
      occurredAt: event.createdAt,
    };
  }

  return null;
}

async function getLatestDispatchCustomerResponseAfterSend(input: {
  orgId: string;
  job: DispatchCustomerNotificationJobRecord;
  since: Date;
}): Promise<DispatchCustomerResponseAfterSendState | null> {
  const referenceFilters: Prisma.CommunicationEventWhereInput[] = [];
  if (input.job.customerId) {
    referenceFilters.push({ contactId: input.job.customerId });
  }
  if (input.job.leadId) {
    referenceFilters.push({ leadId: input.job.leadId });
  }

  if (referenceFilters.length === 0) {
    return null;
  }

  const responseEvent = await prisma.communicationEvent.findFirst({
    where: {
      orgId: input.orgId,
      OR: referenceFilters,
      type: {
        in: ["INBOUND_SMS_RECEIVED", "INBOUND_CALL_RECEIVED", "VOICEMAIL_LEFT"],
      },
      occurredAt: {
        gt: input.since,
      },
    },
    select: {
      occurredAt: true,
      summary: true,
      type: true,
    },
    orderBy: [{ occurredAt: "desc" }],
  });

  if (!responseEvent) {
    return null;
  }

  return {
    occurredAt: responseEvent.occurredAt,
    summary: responseEvent.summary,
    type:
      responseEvent.type === "INBOUND_SMS_RECEIVED"
        ? "sms"
        : responseEvent.type === "VOICEMAIL_LEFT"
          ? "voicemail"
          : "call",
  };
}

async function getLatestDispatchOperatorFollowUpAfterResponse(input: {
  orgId: string;
  job: DispatchCustomerNotificationJobRecord;
  since: Date;
}): Promise<DispatchOperatorFollowUpAfterResponseState | null> {
  const referenceFilters: Prisma.CommunicationEventWhereInput[] = [];
  if (input.job.customerId) {
    referenceFilters.push({ contactId: input.job.customerId });
  }
  if (input.job.leadId) {
    referenceFilters.push({ leadId: input.job.leadId });
  }

  if (referenceFilters.length === 0) {
    return null;
  }

  const event = await prisma.communicationEvent.findFirst({
    where: {
      orgId: input.orgId,
      OR: referenceFilters,
      type: "OUTBOUND_SMS_SENT",
      occurredAt: {
        gt: input.since,
      },
    },
    select: {
      occurredAt: true,
      summary: true,
    },
    orderBy: [{ occurredAt: "desc" }],
  });

  if (!event) {
    return null;
  }

  return {
    occurredAt: event.occurredAt,
    summary: event.summary,
  };
}

async function getLastDispatchCustomerUpdate(input: {
  orgId: string;
  job: DispatchCustomerNotificationJobRecord;
}): Promise<DispatchCustomerCommunicationState["lastCustomerUpdate"]> {
  const referenceFilters: Prisma.CommunicationEventWhereInput[] = [];
  if (input.job.customerId) {
    referenceFilters.push({ contactId: input.job.customerId });
  }
  if (input.job.leadId) {
    referenceFilters.push({ leadId: input.job.leadId });
  }

  const communicationEvents = await prisma.communicationEvent.findMany({
    where: {
      orgId: input.orgId,
      type: "OUTBOUND_SMS_SENT",
      ...(referenceFilters.length > 0 ? { OR: referenceFilters } : {}),
    },
    select: {
      id: true,
      summary: true,
      occurredAt: true,
      providerStatus: true,
      metadataJson: true,
    },
    orderBy: [{ occurredAt: "desc" }],
    take: referenceFilters.length > 0 ? 24 : 48,
  });

  const latest = communicationEvents.find(
    (event) => recordString(asRecord(event.metadataJson), "dispatchJobId") === input.job.id,
  );

  if (!latest) {
    return null;
  }

  const metadata = asRecord(latest.metadataJson);
  const kind = recordString(metadata, "dispatchNotificationKind");
  const status = recordString(metadata, "dispatchNotificationStatus") || recordString(metadata, "dispatchStatus");
  const providerStatus = latest.providerStatus || null;
  const recoverySend = recordBoolean(metadata, "dispatchRecoverySend");
  const deliveryState =
    getDispatchSmsDeliveryState(recordString(metadata, "dispatchDeliveryState")) || getDispatchSmsDeliveryState(providerStatus);
  const failureReason = recordString(metadata, "dispatchFailureReason");
  const providerErrorCode = recordString(metadata, "providerErrorCode");
  const providerErrorMessage = recordString(metadata, "providerErrorMessage");
  const operatorFailureReason = describeDispatchSmsOperatorIssue({
    deliveryState,
    providerStatus,
    blockedReason: null,
    failureReason,
    providerErrorCode,
    providerErrorMessage,
  });
  const manualFollowThrough =
    recoverySend && (deliveryState === "failed" || deliveryState === "suppressed")
      ? await getLatestDispatchManualFollowThrough({
          orgId: input.orgId,
          jobId: input.job.id,
          since: latest.occurredAt,
        })
      : null;
  const manualContactOutcome =
    recoverySend && (deliveryState === "failed" || deliveryState === "suppressed")
      ? await getLatestDispatchManualContactOutcome({
          orgId: input.orgId,
          jobId: input.job.id,
          since: latest.occurredAt,
        })
      : null;
  const customerResponseAfterSend = await getLatestDispatchCustomerResponseAfterSend({
    orgId: input.orgId,
    job: input.job,
    since: latest.occurredAt,
  });
  const operatorFollowUpAfterResponse = customerResponseAfterSend
    ? await getLatestDispatchOperatorFollowUpAfterResponse({
        orgId: input.orgId,
        job: input.job,
        since: customerResponseAfterSend.occurredAt,
      })
    : null;

  return {
    occurredAt: latest.occurredAt,
    statusUpdatedAt: recordDate(metadata, "providerStatusUpdatedAt") || latest.occurredAt,
    summary: latest.summary,
    providerStatus,
    deliveryState,
    body: recordString(metadata, "body"),
    failureReason,
    operatorFailureReason,
    providerErrorCode,
    providerErrorMessage,
    remediation: getDispatchSmsRemediation({
      deliveryState,
      providerStatus,
      blockedReason: null,
      failureReason,
      providerErrorCode,
      providerErrorMessage,
    }),
    recoverySend,
    manualFollowThrough,
    manualContactOutcome,
    customerResponseAfterSend,
    operatorFollowUpAfterResponse,
    kind: kind === "status" || kind === "schedule_change" ? kind : "legacy",
    status: resolveDispatchNotificationStatus(status),
  };
}

export async function getDispatchCustomerCommunicationState(input: {
  orgId: string;
  jobId: string;
}): Promise<DispatchCustomerCommunicationState> {
  const [settings, job, candidate] = await Promise.all([
    getDispatchNotificationSettings(input.orgId),
    getDispatchCustomerNotificationJob(input),
    getDispatchScheduleNotificationCandidate(input),
  ]);

  if (!job) {
    return {
      lastCustomerUpdate: null,
      customerUpdate: {
        pending: false,
        occurredAt: null,
        changedFields: [],
        alreadySentAt: null,
        canSend: false,
        blockedReason: "Dispatch job not found.",
        previewBody: null,
      },
    };
  }

  const lastCustomerUpdatePromise = getLastDispatchCustomerUpdate({
    orgId: input.orgId,
    job,
  });

  if (!candidate) {
    return {
      lastCustomerUpdate: await lastCustomerUpdatePromise,
      customerUpdate: {
        pending: false,
        occurredAt: null,
        changedFields: [],
        alreadySentAt: null,
        canSend: false,
        blockedReason: "No schedule change is waiting to send.",
        previewBody: null,
      },
    };
  }

  const existing = await prisma.communicationEvent.findUnique({
    where: {
      orgId_idempotencyKey: {
        orgId: input.orgId,
        idempotencyKey: buildDispatchNotificationIdempotencyKey({
          kind: candidate.kind,
          orgId: input.orgId,
          eventId: candidate.event.id,
          status: candidate.notificationStatus,
        }),
      },
    },
    select: {
      occurredAt: true,
    },
  });

  const pending = !existing;
  const smsConsent = await getSmsConsentState({
    orgId: input.orgId,
    phoneE164: job.phone,
  });

  const readiness = buildDispatchCustomerNotificationReadiness({
    settings,
    job,
    candidate,
    smsConsentStatus: smsConsent.status,
  });

  return {
    lastCustomerUpdate: await lastCustomerUpdatePromise,
    customerUpdate: {
      pending,
      occurredAt: candidate.event.createdAt,
      changedFields: candidate.changedFields,
      alreadySentAt: existing?.occurredAt || null,
      canSend: pending && readiness.allowed,
      blockedReason: pending
        ? readiness.blockedReason
        : existing?.occurredAt
          ? "Latest schedule change was already sent."
          : "No schedule change is waiting to send.",
      previewBody: readiness.previewBody,
    },
  };
}

export async function getPendingDispatchScheduleCustomerUpdate(input: {
  orgId: string;
  jobId: string;
}): Promise<PendingDispatchScheduleCustomerUpdate> {
  const state = await getDispatchCustomerCommunicationState(input);
  return {
    pending: state.customerUpdate.pending,
    occurredAt: state.customerUpdate.occurredAt,
    changedFields: state.customerUpdate.changedFields,
    alreadySentAt: state.customerUpdate.alreadySentAt,
  };
}
