import { buildCommunicationIdempotencyKey } from "@/lib/communication-events";

export const MISSED_CALL_DUPLICATE_WINDOW_MINUTES = 5;

export type MissedCallRecoveryDecision =
  | {
      action: "send";
      reason: "eligible";
      withinBusinessHours: true;
    }
  | {
      action: "queue";
      reason: "quiet_hours";
      withinBusinessHours: false;
      sendAfterAt: Date;
    }
  | {
      action: "skip";
      reason:
        | "already_processed"
        | "answered"
        | "disabled"
        | "missing_phone"
        | "missing_sender"
        | "dnc"
        | "recent_outbound";
      withinBusinessHours: boolean;
    };

export type MissedCallEligibilityInput = {
  missedCallAutoReplyOn: boolean;
  leadStatus: string | null;
  fromNumberE164: string | null;
  senderNumberE164: string | null;
  hasAnsweredEvent: boolean;
  hasRecentOutbound: boolean;
  withinBusinessHours: boolean;
  sendAfterAt: Date | null;
};

export type RecoveryCandidate = {
  orgId: string;
  leadId: string;
  contactId?: string | null;
  conversationId?: string | null;
  callId?: string | null;
  callSid?: string | null;
  fromNumberE164: string | null;
  toNumberE164?: string | null;
  forwardedTo?: string | null;
  occurredAt: Date;
  source: "realtime" | "cron";
};

type MissedCallRecoveryDeps = {
  reserveDecision: (candidate: RecoveryCandidate) => Promise<{
    alreadyProcessed: boolean;
    decisionKey: string;
    eventId?: string;
    decision?: MissedCallRecoveryDecision;
  }>;
  dispatchDecision: (
    candidate: RecoveryCandidate,
    reserved: {
      decisionKey: string;
      eventId?: string;
      decision?: MissedCallRecoveryDecision;
    },
  ) => Promise<MissedCallRecoveryDecision>;
};

export function evaluateMissedCallTextEligibility(input: MissedCallEligibilityInput): MissedCallRecoveryDecision {
  if (input.hasAnsweredEvent) {
    return {
      action: "skip",
      reason: "answered",
      withinBusinessHours: input.withinBusinessHours,
    };
  }

  if (!input.missedCallAutoReplyOn) {
    return {
      action: "skip",
      reason: "disabled",
      withinBusinessHours: input.withinBusinessHours,
    };
  }

  if (!input.fromNumberE164) {
    return {
      action: "skip",
      reason: "missing_phone",
      withinBusinessHours: input.withinBusinessHours,
    };
  }

  if (!input.senderNumberE164) {
    return {
      action: "skip",
      reason: "missing_sender",
      withinBusinessHours: input.withinBusinessHours,
    };
  }

  if (input.leadStatus === "DNC") {
    return {
      action: "skip",
      reason: "dnc",
      withinBusinessHours: input.withinBusinessHours,
    };
  }

  if (input.hasRecentOutbound) {
    return {
      action: "skip",
      reason: "recent_outbound",
      withinBusinessHours: input.withinBusinessHours,
    };
  }

  if (!input.withinBusinessHours && input.sendAfterAt) {
    return {
      action: "queue",
      reason: "quiet_hours",
      withinBusinessHours: false,
      sendAfterAt: input.sendAfterAt,
    };
  }

  return {
    action: "send",
    reason: "eligible",
    withinBusinessHours: true,
  };
}

export function buildMissedCallRecoveryKey(candidate: RecoveryCandidate) {
  return buildCommunicationIdempotencyKey(
    "missed-call-recovery",
    candidate.callSid || candidate.callId || null,
    candidate.leadId,
    candidate.fromNumberE164,
    candidate.occurredAt.toISOString(),
  );
}

export function createMissedCallRecoveryRunner(deps: MissedCallRecoveryDeps) {
  return async function processMissedCallRecovery(candidate: RecoveryCandidate) {
    const reserved = await deps.reserveDecision(candidate);
    if (reserved.alreadyProcessed && reserved.decision) {
      return reserved.decision;
    }
    return deps.dispatchDecision(candidate, reserved);
  };
}
