import type {
  MessagingOpsTriageReason,
  MessagingOpsTriageTargetType,
} from "@prisma/client";

export const MESSAGING_OPS_TRIAGE_REASONS: MessagingOpsTriageReason[] = [
  "HISTORICAL_TEST_DATA",
  "BAD_DESTINATION_NUMBER",
  "CARRIER_FILTERING_ACCEPTED",
  "RECOVERED_OR_DUPLICATE",
  "ACCEPTED_FOR_CONTROLLED_ROLLOUT",
  "OTHER",
];

export type MessagingOpsTriageRow = {
  targetType: MessagingOpsTriageTargetType;
  targetId: string;
};

export type MessagingOpsTriageSets = {
  failedSmsMessageIds: Set<string>;
  unmatchedStatusCallbackIds: Set<string>;
};

export function normalizeMessagingOpsTriageReason(
  value: string | null | undefined,
): MessagingOpsTriageReason | null {
  const normalized = (value || "").trim();
  return MESSAGING_OPS_TRIAGE_REASONS.includes(
    normalized as MessagingOpsTriageReason,
  )
    ? (normalized as MessagingOpsTriageReason)
    : null;
}

export function normalizeMessagingOpsTriageNote(
  value: string | null | undefined,
): string | null {
  const normalized = redactMessagingOpsTriageNote(
    (value || "").replace(/\s+/g, " ").trim(),
  );
  if (!normalized) return null;
  return normalized.slice(0, 280);
}

function redactPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return "[redacted-phone]";
  return `+***${digits.slice(-4)}`;
}

export function redactMessagingOpsTriageNote(value: string): string {
  return value
    .replace(/\b(?:AC|CA|IM|MG|MM|SM)[A-Za-z0-9]{16,}\b/g, "[redacted-sid]")
    .replace(
      /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g,
      redactPhone,
    )
    .replace(
      /\b(auth\s*token|api\s*key|secret|session\s*token|cookie)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, (token) =>
      /[A-Za-z]/.test(token) && /[\d+/=]/.test(token)
        ? "[redacted-token]"
        : token,
    );
}

export function buildMessagingOpsTriageSets(
  rows: MessagingOpsTriageRow[],
): MessagingOpsTriageSets {
  const failedSmsMessageIds = new Set<string>();
  const unmatchedStatusCallbackIds = new Set<string>();

  for (const row of rows) {
    if (row.targetType === "FAILED_SMS_MESSAGE") {
      failedSmsMessageIds.add(row.targetId);
    }
    if (row.targetType === "UNMATCHED_STATUS_CALLBACK") {
      unmatchedStatusCallbackIds.add(row.targetId);
    }
  }

  return { failedSmsMessageIds, unmatchedStatusCallbackIds };
}

export function countUnacceptedMessagingOpsIssues(input: {
  failedMessages: Array<{ id: string }>;
  unmatchedCallbacks: Array<{ id: string }>;
  triageRows: MessagingOpsTriageRow[];
}) {
  const accepted = buildMessagingOpsTriageSets(input.triageRows);
  const activeFailedMessages = input.failedMessages.filter(
    (message) => !accepted.failedSmsMessageIds.has(message.id),
  );
  const activeUnmatchedCallbacks = input.unmatchedCallbacks.filter(
    (event) => !accepted.unmatchedStatusCallbackIds.has(event.id),
  );

  return {
    accepted,
    activeFailedMessages,
    activeUnmatchedCallbacks,
    acceptedFailedSmsCount:
      input.failedMessages.length - activeFailedMessages.length,
    acceptedUnmatchedCallbackCount:
      input.unmatchedCallbacks.length - activeUnmatchedCallbacks.length,
  };
}

export function buildMessagingOpsTriageCreateRows(input: {
  orgId: string;
  reason: MessagingOpsTriageReason;
  note: string | null;
  decidedByUserId: string | null;
  failedMessages: Array<{ id: string; createdAt: Date }>;
  unmatchedCallbacks: Array<{ id: string; createdAt: Date }>;
  triageRows: MessagingOpsTriageRow[];
}) {
  const accepted = buildMessagingOpsTriageSets(input.triageRows);
  return [
    ...input.failedMessages
      .filter((message) => !accepted.failedSmsMessageIds.has(message.id))
      .map((message) => ({
        orgId: input.orgId,
        targetType: "FAILED_SMS_MESSAGE" as const,
        targetId: message.id,
        reason: input.reason,
        note: input.note,
        decidedByUserId: input.decidedByUserId,
        targetCreatedAt: message.createdAt,
      })),
    ...input.unmatchedCallbacks
      .filter((event) => !accepted.unmatchedStatusCallbackIds.has(event.id))
      .map((event) => ({
        orgId: input.orgId,
        targetType: "UNMATCHED_STATUS_CALLBACK" as const,
        targetId: event.id,
        reason: input.reason,
        note: input.note,
        decidedByUserId: input.decidedByUserId,
        targetCreatedAt: event.createdAt,
      })),
  ];
}
