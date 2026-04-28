import type { ConversationStage, ConversationTimeframe, MessageDirection, MessageType } from "@prisma/client";

const MISSED_CALL_RESTART_COOLDOWN_MINUTES = 30;
export const MIN_AUTOMATED_FOLLOW_UP_GAP_MINUTES = 90;

export const ACTIVE_CONVERSATION_FOLLOW_UP_STAGES = [
  "ASKED_WORK",
  "ASKED_ADDRESS",
  "ASKED_TIMEFRAME",
  "OFFERED_BOOKING",
] as const;

export type DispatchConversationSnapshot = {
  stage: ConversationStage;
  pausedUntil: Date | null;
  stoppedAt: Date | null;
};

export type SmsAutomationHardFailureSnapshot = {
  occurredAt: Date;
  category: string | null;
  label: string | null;
  operatorActionLabel: string | null;
  operatorDetail: string | null;
};

export type SmsAutomationFailureEventSnapshot = {
  occurredAt: Date;
  metadataJson: unknown;
  providerStatus?: string | null;
};

export type MissedCallKickoffStateSnapshot = {
  stage: ConversationStage;
  workSummary?: string | null;
  addressText?: string | null;
  addressCity?: string | null;
  timeframe?: ConversationTimeframe | null;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  nextFollowUpAt?: Date | null;
  pausedUntil?: Date | null;
  stoppedAt?: Date | null;
};

export type FollowUpStateSnapshot = {
  stage: ConversationStage;
  followUpStep: number;
  lastInboundAt: Date | null;
};

export type FollowUpStateCurrent = FollowUpStateSnapshot & {
  pausedUntil: Date | null;
  stoppedAt: Date | null;
};

export type GhostBusterMessageSnapshot = {
  direction: MessageDirection;
  type: MessageType;
  createdAt: Date;
  body?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordBoolean(record: Record<string, unknown> | null, key: string): boolean {
  const value = record?.[key];
  if (typeof value === "boolean") {
    return value;
  }

  return typeof value === "string" && ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

function normalizeSmsStatus(value: string | null | undefined): string | null {
  const normalized = `${value || ""}`.trim().toLowerCase();
  return normalized || null;
}

function hasDeliveredAfterFailure(event: SmsAutomationFailureEventSnapshot): boolean {
  const metadata = asRecord(event.metadataJson);
  const status =
    normalizeSmsStatus(recordString(metadata, "providerStatus")) ||
    normalizeSmsStatus(recordString(metadata, "status")) ||
    normalizeSmsStatus(event.providerStatus);

  return status === "delivered" || status === "read";
}

export function getRecentHardSmsFailureForAutomation(
  events: readonly SmsAutomationFailureEventSnapshot[],
): SmsAutomationHardFailureSnapshot | null {
  const ordered = [...events].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());

  for (const event of ordered) {
    if (hasDeliveredAfterFailure(event)) {
      return null;
    }

    const metadata = asRecord(event.metadataJson);
    if (!recordBoolean(metadata, "failureBlocksAutomationRetry")) {
      continue;
    }

    return {
      occurredAt: event.occurredAt,
      category: recordString(metadata, "failureCategory"),
      label: recordString(metadata, "failureLabel") || recordString(metadata, "failureReason"),
      operatorActionLabel: recordString(metadata, "failureOperatorActionLabel"),
      operatorDetail: recordString(metadata, "failureOperatorDetail"),
    };
  }

  return null;
}

export function getAutomatedFollowUpThrottleUntil(input: {
  lastOutboundAt: Date | null;
  now: Date;
  minimumGapMinutes?: number;
}): Date | null {
  if (!input.lastOutboundAt) {
    return null;
  }

  const minimumGapMinutes = Math.max(1, input.minimumGapMinutes ?? MIN_AUTOMATED_FOLLOW_UP_GAP_MINUTES);
  const throttleUntil = new Date(input.lastOutboundAt.getTime() + minimumGapMinutes * 60 * 1000);

  return throttleUntil.getTime() > input.now.getTime() ? throttleUntil : null;
}

function isActiveFollowUpStage(stage: ConversationStage): boolean {
  return (ACTIVE_CONVERSATION_FOLLOW_UP_STAGES as readonly ConversationStage[]).includes(stage);
}

export function shouldSuppressMissedCallKickoff(input: {
  state: MissedCallKickoffStateSnapshot;
  now: Date;
}): boolean {
  const { state, now } = input;

  if (state.stoppedAt) {
    return true;
  }

  if (state.pausedUntil && state.pausedUntil.getTime() > now.getTime()) {
    return true;
  }

  if (["BOOKED", "CLOSED", "HUMAN_TAKEOVER"].includes(state.stage)) {
    return true;
  }

  if (state.nextFollowUpAt) {
    return true;
  }

  const hasCapturedContext = Boolean(state.workSummary || state.addressText || state.addressCity || state.timeframe);
  if (state.stage !== "NEW" && hasCapturedContext) {
    return true;
  }

  if (state.stage !== "NEW") {
    const latestActivityAt = [state.lastInboundAt, state.lastOutboundAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (
      latestActivityAt &&
      now.getTime() - latestActivityAt.getTime() < MISSED_CALL_RESTART_COOLDOWN_MINUTES * 60 * 1000
    ) {
      return true;
    }
  }

  return false;
}

export function shouldSkipQueuedFollowUp(input: {
  loaded: FollowUpStateSnapshot;
  current: FollowUpStateCurrent;
  now: Date;
}): boolean {
  if (input.current.stoppedAt) {
    return true;
  }

  if (input.current.pausedUntil && input.current.pausedUntil.getTime() > input.now.getTime()) {
    return true;
  }

  if (!isActiveFollowUpStage(input.current.stage)) {
    return true;
  }

  if (input.current.stage !== input.loaded.stage) {
    return true;
  }

  if (input.current.followUpStep !== input.loaded.followUpStep) {
    return true;
  }

  return (input.current.lastInboundAt?.getTime() ?? 0) > (input.loaded.lastInboundAt?.getTime() ?? 0);
}

export function getQueuedSmsSkipReason(input: {
  jobCreatedAt: Date;
  leadStatus: string;
  leadLastInboundAt: Date | null;
  messageType: "AUTOMATION" | "SYSTEM_NUDGE" | "MANUAL";
  recentHardSmsFailure?: SmsAutomationHardFailureSnapshot | null;
  conversationState: DispatchConversationSnapshot | null;
  now: Date;
}): string | null {
  if (input.leadStatus === "DNC") {
    return "Lead is opted out (DNC/STOP).";
  }

  if (input.messageType === "MANUAL") {
    return null;
  }

  if (input.leadLastInboundAt && input.leadLastInboundAt.getTime() > input.jobCreatedAt.getTime()) {
    return "Skipped stale automation after a newer inbound reply.";
  }

  if (input.recentHardSmsFailure) {
    const action =
      input.recentHardSmsFailure.operatorActionLabel ||
      input.recentHardSmsFailure.label ||
      "Review latest SMS failure";
    const detail =
      input.recentHardSmsFailure.operatorDetail || "Review the latest Twilio failure before automation sends again.";
    return `Skipped automation after hard SMS failure: ${action}. ${detail}`;
  }

  if (!input.conversationState) {
    return null;
  }

  if (input.conversationState.stoppedAt) {
    return "Skipped automation because the conversation is stopped.";
  }

  if (input.conversationState.pausedUntil && input.conversationState.pausedUntil.getTime() > input.now.getTime()) {
    return "Skipped automation because the conversation is paused for human follow-up.";
  }

  if (["HUMAN_TAKEOVER", "BOOKED", "CLOSED"].includes(input.conversationState.stage)) {
    return `Skipped automation because the conversation is in ${input.conversationState.stage}.`;
  }

  return null;
}

export function getGhostBusterSkipReason(input: {
  leadStatus: string;
  lastInboundAt: Date | null;
  messages: readonly GhostBusterMessageSnapshot[];
  conversationState: DispatchConversationSnapshot | null;
  now: Date;
}): string | null {
  if (input.leadStatus === "DNC") {
    return "Lead is opted out (DNC/STOP).";
  }

  if (!input.lastInboundAt) {
    return "Skipped ghost nudge because the lead has no latest inbound message.";
  }

  if (input.conversationState?.stoppedAt) {
    return "Skipped ghost nudge because the conversation is stopped.";
  }

  if (input.conversationState?.pausedUntil && input.conversationState.pausedUntil.getTime() > input.now.getTime()) {
    return "Skipped ghost nudge because the conversation is paused for human follow-up.";
  }

  if (input.conversationState && ["HUMAN_TAKEOVER", "BOOKED", "CLOSED"].includes(input.conversationState.stage)) {
    return `Skipped ghost nudge because the conversation is in ${input.conversationState.stage}.`;
  }

  const latestInboundAt = input.lastInboundAt.getTime();
  const messagesAfterLatestInbound = input.messages.filter((message) => message.createdAt.getTime() >= latestInboundAt);
  const latestManualOutbound = messagesAfterLatestInbound
    .filter((message) => message.direction === "OUTBOUND" && message.type === "MANUAL")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  if (!latestManualOutbound) {
    const hasAutomationOnlyResponse = messagesAfterLatestInbound.some(
      (message) => message.direction === "OUTBOUND" && message.type !== "MANUAL",
    );

    return hasAutomationOnlyResponse
      ? "Skipped ghost nudge because the latest inbound request has only automated replies."
      : "Skipped ghost nudge because the latest inbound request has not received a human reply.";
  }

  const newerInboundAfterManualReply = messagesAfterLatestInbound.some(
    (message) =>
      message.direction === "INBOUND" && message.createdAt.getTime() > latestManualOutbound.createdAt.getTime(),
  );

  if (newerInboundAfterManualReply) {
    return "Skipped ghost nudge because the customer replied after the latest human response.";
  }

  return null;
}

function isHumanReviewAckBody(body: string | null | undefined): boolean {
  const normalized = `${body || ""}`.toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(someone|office|team|estimator|owner|manager|cesar)\b.{0,80}\b(follow up|contact|call|get back|review)\b/.test(
    normalized,
  ) ||
    /\b(i['’]?ll|we['’]?ll)\b.{0,80}\b(review|get back|follow up|contact|call)\b/.test(normalized) ||
    /\b(follow up shortly|contact you shortly|call you shortly|get back to you)\b/.test(normalized);
}

export function getConversationalFollowUpSkipReason(input: {
  leadStatus: string;
  lastInboundAt: Date | null;
  messages: readonly GhostBusterMessageSnapshot[];
  conversationState: DispatchConversationSnapshot | null;
  now: Date;
}): string | null {
  const baseSkip = getQueuedSmsSkipReason({
    jobCreatedAt: new Date(0),
    leadStatus: input.leadStatus,
    leadLastInboundAt: null,
    messageType: "AUTOMATION",
    conversationState: input.conversationState,
    now: input.now,
  });
  if (baseSkip) {
    return baseSkip.replace("Skipped automation", "Skipped conversational follow-up");
  }

  const latestInboundAt = input.lastInboundAt?.getTime() ?? 0;
  const latestOutboundAfterInbound = input.messages
    .filter((message) => message.direction === "OUTBOUND" && message.createdAt.getTime() >= latestInboundAt)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  if (!latestOutboundAfterInbound) {
    return input.lastInboundAt
      ? "Skipped conversational follow-up because the latest customer message is waiting on a reply."
      : "Skipped conversational follow-up because there is no outbound prompt to follow up on.";
  }

  if (latestOutboundAfterInbound.type === "MANUAL") {
    return "Skipped conversational follow-up because a human already replied after the latest customer message.";
  }

  if (isHumanReviewAckBody(latestOutboundAfterInbound.body)) {
    return "Skipped conversational follow-up because the latest automated reply promised human review.";
  }

  return null;
}
