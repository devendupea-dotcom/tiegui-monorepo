import type { MessageStatus } from "@prisma/client";
import { buildCommunicationIdempotencyKey } from "@/lib/communication-events";
import { buildSmsFailureReason, classifySmsFailure } from "@/lib/sms-failure-intelligence";

export function buildUnmatchedSmsStatusCallbackEvent(input: {
  orgId: string;
  providerMessageSid: string;
  providerStatus: string;
  lifecycleStatus: MessageStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  occurredAt: Date;
}) {
  const providerStatus = input.providerStatus.trim().toLowerCase();
  const providerErrorCode = input.errorCode?.trim() || null;
  const providerErrorMessage = input.errorMessage?.trim() || null;
  const failureClassification = classifySmsFailure({
    providerStatus,
    lifecycleStatus: input.lifecycleStatus,
    errorCode: providerErrorCode,
    errorMessage: providerErrorMessage,
  });

  return {
    summary: "Unmatched outbound SMS status callback",
    idempotencyKey: buildCommunicationIdempotencyKey(
      "sms-status-unmatched",
      input.orgId,
      input.providerMessageSid,
      providerStatus,
    ),
    metadataJson: {
      unmatchedStatusCallback: true,
      providerMessageSid: input.providerMessageSid,
      providerStatus,
      status: input.lifecycleStatus,
      providerStatusUpdatedAt: input.occurredAt.toISOString(),
      providerErrorCode,
      providerErrorMessage,
      failureCategory: failureClassification?.category || null,
      failureLabel: failureClassification?.label || null,
      failureOperatorAction: failureClassification?.operatorAction || null,
      failureOperatorActionLabel: failureClassification?.operatorActionLabel || null,
      failureOperatorDetail: failureClassification?.operatorDetail || null,
      failureRetryRecommended: failureClassification?.retryRecommended ?? null,
      failureBlocksAutomationRetry: failureClassification?.blocksAutomationRetry ?? null,
      failureReason:
        input.lifecycleStatus === "FAILED"
          ? buildSmsFailureReason({
              providerStatus,
              errorCode: providerErrorCode,
              errorMessage: providerErrorMessage,
              lifecycleStatus: input.lifecycleStatus,
            })
          : null,
    },
  };
}
