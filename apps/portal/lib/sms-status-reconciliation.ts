import { Prisma, type MessageStatus } from "@prisma/client";
import { upsertCommunicationEvent } from "@/lib/communication-events";
import { prisma } from "@/lib/prisma";
import {
  mapTwilioLifecycleStatus,
  shouldAdvanceOutboundSmsLifecycle,
} from "@/lib/sms-lifecycle";
import {
  buildSmsFailureReason,
  classifySmsFailure,
} from "@/lib/sms-failure-intelligence";
import { buildUnmatchedSmsStatusCallbackEvent } from "@/lib/sms-status-diagnostics";

type SmsStatusMessageRecord = {
  id: string;
  leadId: string;
  status: MessageStatus | null;
  lead: {
    customerId: string | null;
    conversationState: {
      id: string;
    } | null;
  } | null;
};

type SmsStatusCommunicationEventRecord = {
  id: string;
  summary: string;
  providerStatus: string | null;
  metadataJson: unknown;
};

export type SmsStatusReconciliationClient = {
  message: {
    findFirst(input: unknown): Promise<SmsStatusMessageRecord | null>;
    update(input: unknown): Promise<unknown>;
  };
  communicationEvent: {
    findMany(input: unknown): Promise<SmsStatusCommunicationEventRecord[]>;
    update(input: unknown): Promise<unknown>;
  };
};

const UNMATCHED_SMS_STATUS_CALLBACK_SUMMARY =
  "Unmatched outbound SMS status callback";
const RECOVERED_SMS_STATUS_CALLBACK_SUMMARY =
  "Recovered outbound SMS status callback";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function recordString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeProviderMessageSid(
  value: string | null | undefined,
): string | null {
  const normalized = `${value || ""}`.trim();
  return normalized || null;
}

function readLifecycleFromMetadata(
  metadata: Record<string, unknown> | null,
  providerStatus: string | null,
): MessageStatus | null {
  const metadataStatus = recordString(metadata, "status");
  if (
    metadataStatus === "QUEUED" ||
    metadataStatus === "SENT" ||
    metadataStatus === "DELIVERED" ||
    metadataStatus === "FAILED"
  ) {
    return metadataStatus;
  }
  return mapTwilioLifecycleStatus(providerStatus);
}

export async function reconcileOutboundSmsProviderStatus(input: {
  orgId: string;
  providerMessageSid: string;
  providerStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  occurredAt?: Date;
  client?: SmsStatusReconciliationClient;
}): Promise<{
  updatedMessages: number;
  updatedEvents: number;
  unmatchedCallbacks: number;
}> {
  const providerMessageSid = normalizeProviderMessageSid(input.providerMessageSid);
  const normalizedProviderStatus = input.providerStatus.trim().toLowerCase();
  const nextLifecycle = mapTwilioLifecycleStatus(normalizedProviderStatus);
  if (!providerMessageSid || !normalizedProviderStatus || !nextLifecycle) {
    return {
      updatedMessages: 0,
      updatedEvents: 0,
      unmatchedCallbacks: 0,
    };
  }
  const client = (input.client || prisma) as SmsStatusReconciliationClient;

  const [message, communicationEvents] = await Promise.all([
    client.message.findFirst({
      where: {
        orgId: input.orgId,
        providerMessageSid,
      },
      select: {
        id: true,
        leadId: true,
        status: true,
        lead: {
          select: {
            customerId: true,
            conversationState: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    client.communicationEvent.findMany({
      where: {
        orgId: input.orgId,
        providerMessageSid,
      },
      select: {
        id: true,
        summary: true,
        providerStatus: true,
        metadataJson: true,
      },
    }),
  ]);

  if (!message && communicationEvents.length === 0) {
    const occurredAt = input.occurredAt || new Date();
    const diagnostic = buildUnmatchedSmsStatusCallbackEvent({
      orgId: input.orgId,
      providerMessageSid,
      providerStatus: normalizedProviderStatus,
      lifecycleStatus: nextLifecycle,
      errorCode: input.errorCode || null,
      errorMessage: input.errorMessage || null,
      occurredAt,
    });

    await prisma.$transaction(async (tx) => {
      await upsertCommunicationEvent(tx, {
        orgId: input.orgId,
        type: "OUTBOUND_SMS_SENT",
        channel: "SMS",
        occurredAt,
        summary: diagnostic.summary,
        metadataJson: diagnostic.metadataJson as Prisma.InputJsonValue,
        provider: "TWILIO",
        providerMessageSid,
        providerStatus: normalizedProviderStatus,
        idempotencyKey: diagnostic.idempotencyKey,
      });
    });

    return {
      updatedMessages: 0,
      updatedEvents: 1,
      unmatchedCallbacks: 1,
    };
  }

  let updatedMessages = 0;
  if (
    message &&
    shouldAdvanceOutboundSmsLifecycle(message.status, nextLifecycle)
  ) {
    await client.message.update({
      where: {
        id: message.id,
      },
      data: {
        status: nextLifecycle,
      },
    });
    updatedMessages = 1;
  }

  let updatedEvents = 0;
  for (const event of communicationEvents) {
    const metadata = asRecord(event.metadataJson);
    const currentLifecycle = mapTwilioLifecycleStatus(
      recordString(metadata, "status") || event.providerStatus || null,
    );
    if (!shouldAdvanceOutboundSmsLifecycle(currentLifecycle, nextLifecycle)) {
      continue;
    }

    const hasDispatchContext = Boolean(recordString(metadata, "dispatchJobId"));
    const recoveringUnmatched =
      Boolean(message) && event.summary === UNMATCHED_SMS_STATUS_CALLBACK_SUMMARY;
    const failureClassification = classifySmsFailure({
      providerStatus: normalizedProviderStatus,
      lifecycleStatus: nextLifecycle,
      errorCode: input.errorCode || null,
      errorMessage: input.errorMessage || null,
    });
    const nextMetadata: Record<string, unknown> = {
      ...(metadata || {}),
      status: nextLifecycle,
      providerStatus: normalizedProviderStatus,
      providerStatusUpdatedAt: (input.occurredAt || new Date()).toISOString(),
      providerErrorCode: input.errorCode?.trim() || null,
      providerErrorMessage: input.errorMessage?.trim() || null,
      failureCategory: failureClassification?.category || null,
      failureLabel: failureClassification?.label || null,
      failureOperatorAction: failureClassification?.operatorAction || null,
      failureOperatorActionLabel:
        failureClassification?.operatorActionLabel || null,
      failureOperatorDetail: failureClassification?.operatorDetail || null,
      failureRetryRecommended:
        failureClassification?.retryRecommended ?? null,
      failureBlocksAutomationRetry:
        failureClassification?.blocksAutomationRetry ?? null,
      ...(recoveringUnmatched
        ? {
            unmatchedStatusCallback: false,
            recoveredFromUnmatchedStatusCallback: true,
            recoveredAt: new Date().toISOString(),
            recoveredMessageId: message?.id || null,
          }
        : {}),
    };

    if (hasDispatchContext) {
      nextMetadata.dispatchDeliveryState = normalizedProviderStatus;
      nextMetadata.dispatchFailureReason =
        nextLifecycle === "FAILED"
          ? buildSmsFailureReason({
              providerStatus: normalizedProviderStatus,
              errorCode: input.errorCode || null,
              errorMessage: input.errorMessage || null,
              lifecycleStatus: nextLifecycle,
            })
          : null;
    }

    await client.communicationEvent.update({
      where: {
        id: event.id,
      },
      data: {
        ...(recoveringUnmatched
          ? {
              summary: RECOVERED_SMS_STATUS_CALLBACK_SUMMARY,
              messageId: message?.id || null,
              leadId: message?.leadId || null,
              contactId: message?.lead?.customerId || null,
              conversationId: message?.lead?.conversationState?.id || null,
            }
          : {}),
        providerStatus: normalizedProviderStatus,
        metadataJson: nextMetadata as Prisma.InputJsonValue,
      },
    });
    updatedEvents += 1;
  }

  return {
    updatedMessages,
    updatedEvents,
    unmatchedCallbacks: 0,
  };
}

export async function recoverUnmatchedOutboundSmsStatusCallbacks(input: {
  orgId: string;
  providerMessageSid: string | null | undefined;
  client?: SmsStatusReconciliationClient;
}): Promise<{
  recoveredCallbacks: number;
  updatedMessages: number;
  updatedEvents: number;
}> {
  const providerMessageSid = normalizeProviderMessageSid(input.providerMessageSid);
  if (!providerMessageSid) {
    return {
      recoveredCallbacks: 0,
      updatedMessages: 0,
      updatedEvents: 0,
    };
  }

  const client = (input.client || prisma) as SmsStatusReconciliationClient;
  const callbacks = await client.communicationEvent.findMany({
    where: {
      orgId: input.orgId,
      channel: "SMS",
      type: "OUTBOUND_SMS_SENT",
      summary: UNMATCHED_SMS_STATUS_CALLBACK_SUMMARY,
      providerMessageSid,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      summary: true,
      providerStatus: true,
      metadataJson: true,
    },
  });

  let recoveredCallbacks = 0;
  let updatedMessages = 0;
  let updatedEvents = 0;

  for (const callback of callbacks) {
    const metadata = asRecord(callback.metadataJson);
    const providerStatus =
      recordString(metadata, "providerStatus") || callback.providerStatus || "";
    const lifecycleStatus = readLifecycleFromMetadata(metadata, providerStatus);
    if (!providerStatus || !lifecycleStatus) {
      continue;
    }

    const statusUpdatedAt = recordString(metadata, "providerStatusUpdatedAt");
    const result = await reconcileOutboundSmsProviderStatus({
      orgId: input.orgId,
      providerMessageSid,
      providerStatus,
      errorCode: recordString(metadata, "providerErrorCode"),
      errorMessage: recordString(metadata, "providerErrorMessage"),
      occurredAt: statusUpdatedAt ? new Date(statusUpdatedAt) : undefined,
      client,
    });

    if (result.unmatchedCallbacks === 0 && result.updatedEvents > 0) {
      recoveredCallbacks += 1;
      updatedMessages += result.updatedMessages;
      updatedEvents += result.updatedEvents;
    }
  }

  return {
    recoveredCallbacks,
    updatedMessages,
    updatedEvents,
  };
}
