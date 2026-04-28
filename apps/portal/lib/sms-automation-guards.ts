import type { ConversationStage, ConversationTimeframe } from "@prisma/client";

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
