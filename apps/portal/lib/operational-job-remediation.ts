import type { DispatchSmsRemediation } from "@/lib/dispatch";

export type OperationalJobRemediationAction = {
  id: string;
  label: string;
  href: string;
  native?: boolean;
};

export type OperationalJobRemediationStateSnapshot = {
  lastCustomerUpdate: {
    remediation: DispatchSmsRemediation | null;
    operatorFailureReason: string | null;
    deliveryState: string | null;
  } | null;
  customerUpdate: {
    pending: boolean;
    canSend: boolean;
    blockedReason: string | null;
  };
};

export type OperationalJobRecoveryCompletion = {
  title: string;
  detail: string;
};

export type OperationalJobManualOutcomeCompletion = {
  title: string;
  detail: string;
};

export type OperationalJobRecoveryEscalation = {
  title: string;
  detail: string;
};

export type OperationalJobManualFollowThroughSummary = {
  title: string;
  detail: string;
};

export type OperationalJobManualClosureSummary = {
  state: "clear" | "update_pending" | "needs_action";
  badge: string;
  title: string;
  detail: string;
};

export type OperationalJobManualContactOutcome =
  | "confirmed_schedule"
  | "reschedule_needed"
  | "no_response";

export type OperationalJobManualContactOutcomeSummary = {
  badge: string;
  title: string;
  detail: string;
};

export type OperationalJobNoResponseStaleCue = {
  badge: string;
  detail: string;
};

export type OperationalJobPassiveWaitingContext = {
  label: string;
  lastTouchOccurredAt: string | Date | null;
  waitingSinceAt: string | Date;
  manualOutcomeOccurredAt: string | Date | null;
  deliveryState: string | null;
  deliveryStatusOccurredAt: string | Date | null;
};

export type OperationalJobInboundResponseContext = {
  label: string;
  title: string;
  detail: string;
  occurredAt: string | Date;
};

export function shouldShowOperationalJobAfterCallOutcomePrompt(input: {
  manualFollowThroughState: "started" | "handled" | null;
  manualFollowThroughActionId: string | null;
  manualContactOutcome: OperationalJobManualContactOutcome | null;
}): boolean {
  return (
    input.manualFollowThroughState === "started" &&
    input.manualFollowThroughActionId === "call-customer" &&
    !input.manualContactOutcome
  );
}

export type OperationalJobNextActionRecommendation =
  | {
      kind: "send_customer_update";
      label: string;
      detail: string;
    }
  | {
      kind: "edit_schedule";
      label: string;
      detail: string;
    }
  | ({
      kind: "handoff";
      detail: string;
    } & OperationalJobRemediationAction);

function appendAction(
  target: OperationalJobRemediationAction[],
  seen: Set<string>,
  action: OperationalJobRemediationAction | null,
) {
  if (!action?.href) {
    return;
  }

  const key = `${action.label}:${action.href}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(action);
}

function getManualFollowThroughActionLabel(
  actionId: string | null | undefined,
): string | null {
  switch (actionId || "") {
    case "open-inbox":
      return "Open Inbox Thread";
    case "open-crm":
      return "Open Lead";
    case "edit-phone":
      return "Edit Phone";
    case "call-customer":
      return "Call Customer";
    case "open-settings":
      return "Open Settings";
    case "open-integrations":
      return "Open Integrations";
    case "mark-handled":
      return "Mark Handled Manually";
    default:
      return null;
  }
}

function getManualContactOutcomeLabel(
  outcome: OperationalJobManualContactOutcome,
): string {
  switch (outcome) {
    case "confirmed_schedule":
      return "Confirmed schedule";
    case "reschedule_needed":
      return "Reschedule needed";
    case "no_response":
      return "No response";
    default:
      return outcome;
  }
}

function getTimeOrNull(value: string | Date | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasCustomerUpdateAfterOutcome(input: {
  outcomeOccurredAt: string | Date | null | undefined;
  customerUpdateOccurredAt: string | Date | null | undefined;
}): boolean {
  const outcomeAt = getTimeOrNull(input.outcomeOccurredAt);
  const customerUpdateAt = getTimeOrNull(input.customerUpdateOccurredAt);

  if (outcomeAt === null || customerUpdateAt === null) {
    return false;
  }

  return customerUpdateAt > outcomeAt;
}

function hasCustomerResponseAfterFollowUp(input: {
  customerUpdateAlreadySentAt: string | Date | null | undefined;
  customerResponseOccurredAt: string | Date | null | undefined;
}): boolean {
  const sentAt = getTimeOrNull(input.customerUpdateAlreadySentAt);
  const responseAt = getTimeOrNull(input.customerResponseOccurredAt);

  if (sentAt === null || responseAt === null) {
    return false;
  }

  return responseAt > sentAt;
}

function hasOperatorFollowUpAfterResponse(input: {
  customerResponseOccurredAt: string | Date | null | undefined;
  operatorFollowUpOccurredAt: string | Date | null | undefined;
}): boolean {
  const responseAt = getTimeOrNull(input.customerResponseOccurredAt);
  const followUpAt = getTimeOrNull(input.operatorFollowUpOccurredAt);

  if (responseAt === null || followUpAt === null) {
    return false;
  }

  return followUpAt > responseAt;
}

function getElapsedAgeLabel(elapsedMs: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(elapsedMs / dayMs);
  if (days >= 7) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "about a week" : `${weeks} weeks`;
  }
  if (days >= 2) {
    return `${days} days`;
  }
  return "over a day";
}

export function buildOperationalJobRemediationActions(input: {
  remediation: DispatchSmsRemediation | null;
  inboxThreadHref?: string | null;
  crmHref?: string | null;
  editPhoneHref?: string | null;
  callHref?: string | null;
  settingsHref?: string | null;
  integrationsHref?: string | null;
}): OperationalJobRemediationAction[] {
  if (!input.remediation) {
    return [];
  }

  const actions: OperationalJobRemediationAction[] = [];
  const seen = new Set<string>();

  switch (input.remediation.kind) {
    case "check_phone":
      appendAction(
        actions,
        seen,
        input.editPhoneHref
          ? { id: "edit-phone", label: "Edit Phone", href: input.editPhoneHref }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.callHref
          ? {
              id: "call-customer",
              label: "Call Customer",
              href: input.callHref,
              native: true,
            }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.crmHref
          ? { id: "open-crm", label: "Open Lead", href: input.crmHref }
          : null,
      );
      break;
    case "opted_out":
      appendAction(
        actions,
        seen,
        input.inboxThreadHref
          ? {
              id: "open-inbox",
              label: "Open Inbox Thread",
              href: input.inboxThreadHref,
            }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.crmHref
          ? { id: "open-crm", label: "Open Lead", href: input.crmHref }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.callHref
          ? {
              id: "call-customer",
              label: "Call Customer",
              href: input.callHref,
              native: true,
            }
          : null,
      );
      break;
    case "check_twilio":
      appendAction(
        actions,
        seen,
        input.settingsHref
          ? {
              id: "open-settings",
              label: "Open Settings",
              href: input.settingsHref,
            }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.integrationsHref
          ? {
              id: "open-integrations",
              label: "Open Integrations",
              href: input.integrationsHref,
            }
          : null,
      );
      break;
    case "call_customer":
      appendAction(
        actions,
        seen,
        input.callHref
          ? {
              id: "call-customer",
              label: "Call Customer",
              href: input.callHref,
              native: true,
            }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.inboxThreadHref
          ? {
              id: "open-inbox",
              label: "Open Inbox Thread",
              href: input.inboxThreadHref,
            }
          : null,
      );
      break;
    case "retry_later":
      appendAction(
        actions,
        seen,
        input.inboxThreadHref
          ? {
              id: "open-inbox",
              label: "Open Inbox Thread",
              href: input.inboxThreadHref,
            }
          : null,
      );
      appendAction(
        actions,
        seen,
        input.callHref
          ? {
              id: "call-customer",
              label: "Call Customer",
              href: input.callHref,
              native: true,
            }
          : null,
      );
      break;
    default:
      break;
  }

  return actions;
}

export function getOperationalJobRemediationIssueKey(
  input: OperationalJobRemediationStateSnapshot,
): string | null {
  const remediationKind = input.lastCustomerUpdate?.remediation?.kind;
  if (remediationKind) {
    return `remediation:${remediationKind}`;
  }

  if (input.customerUpdate.pending && input.customerUpdate.blockedReason) {
    return `blocked:${input.customerUpdate.blockedReason}`;
  }

  if (
    input.lastCustomerUpdate?.operatorFailureReason &&
    (input.lastCustomerUpdate.deliveryState === "failed" ||
      input.lastCustomerUpdate.deliveryState === "suppressed")
  ) {
    return `delivery:${input.lastCustomerUpdate.operatorFailureReason}`;
  }

  return null;
}

export function shouldAutoRefreshOperationalJobRemediation(
  input: OperationalJobRemediationStateSnapshot,
): boolean {
  return Boolean(getOperationalJobRemediationIssueKey(input));
}

export function shouldShowOperationalJobRecoveryCta(input: {
  previousIssueKey: string | null;
  current: OperationalJobRemediationStateSnapshot;
}): boolean {
  if (!input.previousIssueKey) {
    return false;
  }

  const currentIssueKey = getOperationalJobRemediationIssueKey(input.current);
  if (currentIssueKey) {
    return false;
  }

  return (
    input.current.customerUpdate.pending &&
    input.current.customerUpdate.canSend &&
    !input.current.customerUpdate.blockedReason
  );
}

export function describeOperationalJobRecoveryCompletion(input: {
  deliveryState: string | null;
  reflectedInServerState: boolean;
}): OperationalJobRecoveryCompletion {
  if (!input.reflectedInServerState) {
    return {
      title: "Customer update resumed",
      detail: "Customer update sent. Waiting on delivery confirmation.",
    };
  }

  if (input.deliveryState === "delivered") {
    return {
      title: "Customer update resumed",
      detail: "Customer update sent and delivery was confirmed.",
    };
  }

  if (
    input.deliveryState === "failed" ||
    input.deliveryState === "suppressed"
  ) {
    return {
      title: "Customer update resumed",
      detail: "Customer update sent, but delivery still needs attention.",
    };
  }

  return {
    title: "Customer update resumed",
    detail: "Customer update sent. Waiting on delivery confirmation.",
  };
}

export function describeOperationalJobManualOutcomeCompletion(input: {
  outcome: OperationalJobManualContactOutcome;
  deliveryState: string | null;
  reflectedInServerState: boolean;
}): OperationalJobManualOutcomeCompletion {
  const title =
    input.outcome === "reschedule_needed"
      ? "Reschedule follow-up sent"
      : input.outcome === "confirmed_schedule"
        ? "Confirmed schedule follow-up sent"
        : "Customer update sent";

  if (!input.reflectedInServerState) {
    return {
      title,
      detail: "Customer update sent. Waiting on delivery confirmation.",
    };
  }

  if (input.deliveryState === "delivered") {
    return {
      title,
      detail: "Customer update sent and delivery was confirmed.",
    };
  }

  if (
    input.deliveryState === "failed" ||
    input.deliveryState === "suppressed"
  ) {
    return {
      title,
      detail: "Customer update sent, but delivery still needs attention.",
    };
  }

  return {
    title,
    detail: "Customer update sent. Waiting on delivery confirmation.",
  };
}

export function getOperationalJobNoResponseStaleCue(input: {
  outcome: OperationalJobManualContactOutcome | null;
  outcomeOccurredAt: string | Date | null;
  customerUpdateOccurredAt: string | Date | null;
  customerUpdatePending: boolean;
  customerUpdateCanSend: boolean;
  customerUpdateBlockedReason: string | null;
  customerUpdateAlreadySent: boolean;
  customerUpdateAlreadySentAt?: string | Date | null;
  customerResponseOccurredAt?: string | Date | null;
  operatorFollowUpOccurredAt?: string | Date | null;
  now: string | Date | null;
}): OperationalJobNoResponseStaleCue | null {
  if (input.outcome !== "no_response") {
    return null;
  }

  if (
    hasCustomerResponseAfterFollowUp({
      customerUpdateAlreadySentAt: input.customerUpdateAlreadySentAt,
      customerResponseOccurredAt: input.customerResponseOccurredAt,
    }) ||
    hasOperatorFollowUpAfterResponse({
      customerResponseOccurredAt: input.customerResponseOccurredAt,
      operatorFollowUpOccurredAt: input.operatorFollowUpOccurredAt,
    })
  ) {
    return null;
  }

  const referenceTime = hasCustomerUpdateAfterOutcome({
    outcomeOccurredAt: input.outcomeOccurredAt,
    customerUpdateOccurredAt: input.customerUpdateOccurredAt,
  })
    ? getTimeOrNull(input.customerUpdateOccurredAt)
    : getTimeOrNull(input.outcomeOccurredAt);
  const nowTime = getTimeOrNull(input.now);

  if (referenceTime === null || nowTime === null) {
    return null;
  }

  const elapsedMs = nowTime - referenceTime;
  const staleThresholdMs = 24 * 60 * 60 * 1000;
  if (elapsedMs < staleThresholdMs) {
    return null;
  }

  const ageLabel = getElapsedAgeLabel(elapsedMs);

  if (
    input.customerUpdatePending &&
    input.customerUpdateCanSend &&
    !input.customerUpdateBlockedReason
  ) {
    return {
      badge: "No follow-up yet",
      detail: `A schedule-change update has been ready to send for ${ageLabel}.`,
    };
  }

  if (input.customerUpdatePending) {
    return {
      badge: "Still blocked",
      detail: input.customerUpdateBlockedReason
        ? `The next customer update has still been blocked for ${ageLabel}: ${input.customerUpdateBlockedReason}`
        : `The next customer update has still been blocked for ${ageLabel}.`,
    };
  }

  if (input.customerUpdateAlreadySent) {
    return {
      badge: "Still waiting on customer",
      detail: `The last follow-up was already sent ${ageLabel} ago and the job is still waiting on customer response.`,
    };
  }

  return {
    badge: "No follow-up yet",
    detail: `No new follow-up has been recorded for ${ageLabel} since the customer did not respond.`,
  };
}

export function getOperationalJobPassiveWaitingContext(input: {
  outcome: OperationalJobManualContactOutcome | null;
  outcomeOccurredAt: string | Date | null;
  customerUpdatePending: boolean;
  customerUpdateAlreadySentAt: string | Date | null;
  lastCustomerUpdateOccurredAt: string | Date | null;
  deliveryState: string | null;
  deliveryStatusOccurredAt: string | Date | null;
  customerResponseOccurredAt?: string | Date | null;
}): OperationalJobPassiveWaitingContext | null {
  if (
    input.outcome !== "no_response" ||
    input.customerUpdatePending ||
    hasCustomerResponseAfterFollowUp({
      customerUpdateAlreadySentAt: input.customerUpdateAlreadySentAt,
      customerResponseOccurredAt: input.customerResponseOccurredAt,
    })
  ) {
    return null;
  }

  const waitingSinceAt = getTimeOrNull(input.customerUpdateAlreadySentAt);
  if (waitingSinceAt === null) {
    return null;
  }

  return {
    label: "Last touch",
    lastTouchOccurredAt:
      input.lastCustomerUpdateOccurredAt || input.customerUpdateAlreadySentAt,
    waitingSinceAt: input.customerUpdateAlreadySentAt as string | Date,
    manualOutcomeOccurredAt: input.outcomeOccurredAt,
    deliveryState: input.deliveryState,
    deliveryStatusOccurredAt: input.deliveryStatusOccurredAt,
  };
}

export function getOperationalJobInboundResponseContext(input: {
  customerUpdateAlreadySentAt: string | Date | null;
  customerResponseOccurredAt: string | Date | null;
  customerResponseType: "sms" | "call" | "voicemail" | null;
  operatorFollowUpOccurredAt?: string | Date | null;
}): OperationalJobInboundResponseContext | null {
  if (
    !hasCustomerResponseAfterFollowUp({
      customerUpdateAlreadySentAt: input.customerUpdateAlreadySentAt,
      customerResponseOccurredAt: input.customerResponseOccurredAt,
    }) ||
    hasOperatorFollowUpAfterResponse({
      customerResponseOccurredAt: input.customerResponseOccurredAt,
      operatorFollowUpOccurredAt: input.operatorFollowUpOccurredAt,
    })
  ) {
    return null;
  }

  const title =
    input.customerResponseType === "sms"
      ? "New customer text received"
      : input.customerResponseType === "voicemail"
        ? "New voicemail received"
        : "New customer call received";

  return {
    label: "New customer activity",
    title,
    detail: "Recorded after the last follow-up.",
    occurredAt: input.customerResponseOccurredAt as string | Date,
  };
}

export function getOperationalJobInboundResponseHandoff(input: {
  customerResponseType: "sms" | "call" | "voicemail" | null;
  inboxThreadHref?: string | null;
  crmHref?: string | null;
  callHref?: string | null;
}): OperationalJobRemediationAction | null {
  if (input.customerResponseType === "sms") {
    return input.inboxThreadHref
      ? {
          id: "open-inbox",
          label: "Open Inbox Thread",
          href: input.inboxThreadHref,
        }
      : null;
  }

  if (
    input.customerResponseType === "call" ||
    input.customerResponseType === "voicemail"
  ) {
    if (input.callHref) {
      return {
        id: "call-customer",
        label: "Call Customer",
        href: input.callHref,
        native: true,
      };
    }

    return input.crmHref
      ? {
          id: "open-crm",
          label: "Open Lead",
          href: input.crmHref,
        }
      : null;
  }

  return null;
}

export function shouldReEmphasizeNoResponseAction(input: {
  outcome: OperationalJobManualContactOutcome | null;
  staleCue: OperationalJobNoResponseStaleCue | null;
  nextActionKind: OperationalJobNextActionRecommendation["kind"] | null;
}): boolean {
  if (input.outcome !== "no_response" || !input.staleCue) {
    return false;
  }

  return (
    input.nextActionKind === "send_customer_update" ||
    input.nextActionKind === "handoff"
  );
}

export function describeOperationalJobRecoveryEscalation(input: {
  recoverySend: boolean;
  deliveryState: string | null;
  providerStatus: string | null;
  operatorFailureReason: string | null;
}): OperationalJobRecoveryEscalation | null {
  if (!input.recoverySend) {
    return null;
  }

  if (
    input.deliveryState !== "failed" &&
    input.deliveryState !== "suppressed"
  ) {
    return null;
  }

  const normalizedProviderStatus = (input.providerStatus || "")
    .trim()
    .toLowerCase();

  if (normalizedProviderStatus === "undelivered") {
    return {
      title: "Customer update was not delivered after resume",
      detail:
        input.operatorFailureReason ||
        "The carrier could not deliver the resumed customer update.",
    };
  }

  if (input.deliveryState === "suppressed") {
    return {
      title: "Customer update was blocked after resume",
      detail:
        input.operatorFailureReason ||
        "The resumed customer update was blocked before delivery.",
    };
  }

  return {
    title: "Customer update failed after resume",
    detail:
      input.operatorFailureReason ||
      "The resumed customer update still needs follow-up.",
  };
}

export function describeOperationalJobManualFollowThrough(input: {
  state: "started" | "handled";
  actionId: string | null;
}): OperationalJobManualFollowThroughSummary {
  const actionLabel = getManualFollowThroughActionLabel(input.actionId);

  if (input.state === "handled") {
    return {
      title: "Handled manually",
      detail:
        actionLabel && actionLabel !== "Mark Handled Manually"
          ? `Marked handled manually after ${actionLabel}.`
          : "This resumed update was handled manually.",
    };
  }

  return {
    title: "Manual follow-up in progress",
    detail: actionLabel
      ? `Follow-through started from ${actionLabel}.`
      : "A manual follow-up is already in progress.",
  };
}

export function describeOperationalJobManualClosure(input: {
  actionId: string | null;
  outcome: OperationalJobManualContactOutcome | null;
  outcomeOccurredAt: string | Date | null;
  customerUpdateOccurredAt: string | Date | null;
  customerUpdatePending: boolean;
  customerUpdateCanSend: boolean;
  customerUpdateBlockedReason: string | null;
  customerUpdateAlreadySent: boolean;
  customerUpdateAlreadySentAt?: string | Date | null;
  customerResponseOccurredAt?: string | Date | null;
  customerResponseSummary?: string | null;
  operatorFollowUpOccurredAt?: string | Date | null;
  operatorFollowUpSummary?: string | null;
}): OperationalJobManualClosureSummary {
  const actionLabel = getManualFollowThroughActionLabel(input.actionId);
  const actionPrefix =
    actionLabel && actionLabel !== "Mark Handled Manually"
      ? `Customer contact was completed after ${actionLabel}.`
      : "Manual handling was recorded.";
  const rescheduleStepCompleted =
    input.outcome === "reschedule_needed"
      ? hasCustomerUpdateAfterOutcome({
          outcomeOccurredAt: input.outcomeOccurredAt,
          customerUpdateOccurredAt: input.customerUpdateOccurredAt,
        })
      : false;

  if (input.outcome === "no_response") {
    if (
      input.customerUpdatePending &&
      input.customerUpdateCanSend &&
      !input.customerUpdateBlockedReason
    ) {
      return {
        state: "update_pending",
        badge: "New update pending",
        title: "No response recorded; customer update still pending",
        detail: `${actionPrefix} The customer did not respond during manual contact, but a schedule-change update is now ready to send from this job.`,
      };
    }

    if (input.customerUpdatePending) {
      return {
        state: "needs_action",
        badge: "Still needs action",
        title: "No response recorded; update still blocked",
        detail: input.customerUpdateBlockedReason
          ? `${actionPrefix} The customer did not respond, and the next customer update is still blocked: ${input.customerUpdateBlockedReason}`
          : `${actionPrefix} The customer did not respond, and the next customer update is still waiting on another action.`,
      };
    }

    if (
      hasOperatorFollowUpAfterResponse({
        customerResponseOccurredAt: input.customerResponseOccurredAt,
        operatorFollowUpOccurredAt: input.operatorFollowUpOccurredAt,
      })
    ) {
      return {
        state: "needs_action",
        badge: "Waiting on follow-up",
        title: "Customer follow-up already recorded",
        detail: input.operatorFollowUpSummary
          ? `${actionPrefix} A newer outbound customer follow-up was recorded after the inbound response: ${input.operatorFollowUpSummary}`
          : `${actionPrefix} A newer outbound customer follow-up was recorded after the inbound response, so this job is now waiting on customer follow-up again.`,
      };
    }

    if (
      hasCustomerResponseAfterFollowUp({
        customerUpdateAlreadySentAt: input.customerUpdateAlreadySentAt,
        customerResponseOccurredAt: input.customerResponseOccurredAt,
      })
    ) {
      return {
        state: "clear",
        badge: "New customer activity",
        title: "Customer activity recorded after follow-up",
        detail: input.customerResponseSummary
          ? `${actionPrefix} A newer inbound customer activity was recorded after the last follow-up: ${input.customerResponseSummary}`
          : `${actionPrefix} A newer inbound customer activity was recorded after the last follow-up, so this job is no longer only waiting on that outreach.`,
      };
    }

    if (input.customerUpdateAlreadySent) {
      return {
        state: "needs_action",
        badge: "Waiting on follow-up",
        title: "No response recorded; waiting on follow-up",
        detail: `${actionPrefix} The latest schedule change is already recorded as sent, so this job is now waiting on customer follow-up.`,
      };
    }

    return {
      state: "needs_action",
      badge: "Still needs manual contact",
      title: "No response recorded; still needs manual contact",
      detail: `${actionPrefix} The customer did not respond during manual contact, and no new customer update is currently pending from this job.`,
    };
  }

  if (input.outcome === "reschedule_needed") {
    if (!rescheduleStepCompleted) {
      return {
        state: "needs_action",
        badge: "Still needs action",
        title: "Reschedule needed; the job still needs action",
        detail: input.customerUpdateBlockedReason
          ? `${actionPrefix} The customer asked to reschedule, but the next update is still blocked: ${input.customerUpdateBlockedReason}`
          : `${actionPrefix} The customer asked to reschedule, so this job is not operationally clear yet.`,
      };
    }

    if (
      input.customerUpdatePending &&
      input.customerUpdateCanSend &&
      !input.customerUpdateBlockedReason
    ) {
      return {
        state: "update_pending",
        badge: "Update still pending",
        title: "Reschedule saved; customer update still pending",
        detail: `${actionPrefix} The new schedule is saved, and the customer update is ready to send from this job.`,
      };
    }

    if (input.customerUpdatePending) {
      return {
        state: "needs_action",
        badge: "Still needs action",
        title: "Reschedule saved, but the job still needs action",
        detail: input.customerUpdateBlockedReason
          ? `${actionPrefix} The new schedule is saved, but the next customer update is still blocked: ${input.customerUpdateBlockedReason}`
          : `${actionPrefix} The new schedule is saved, but the next customer update is still waiting on another action.`,
      };
    }

    if (input.customerUpdateAlreadySent) {
      return {
        state: "clear",
        badge: "Operationally clear",
        title: "Reschedule saved; latest update already sent",
        detail: `${actionPrefix} The new schedule is saved and the matching customer update is already recorded as sent.`,
      };
    }

    return {
      state: "clear",
      badge: "Operationally clear",
      title: "Reschedule saved; no further dispatch update pending",
      detail: `${actionPrefix} The new schedule is saved and no dispatch update is currently waiting to send.`,
    };
  }

  if (input.customerUpdatePending) {
    if (input.customerUpdateCanSend && !input.customerUpdateBlockedReason) {
      return {
        state: "update_pending",
        badge: "Update still pending",
        title:
          input.outcome === "confirmed_schedule"
            ? "Schedule confirmed; customer update still pending"
            : "Customer contacted; schedule-change update still pending",
        detail:
          input.outcome === "confirmed_schedule"
            ? `${actionPrefix} The schedule was confirmed manually, but the matching customer update is still ready to send from this job.`
            : `${actionPrefix} A schedule-change update is still ready to send from this job.`,
      };
    }

    return {
      state: "needs_action",
      badge: "Still needs action",
      title:
        input.outcome === "confirmed_schedule"
          ? "Schedule confirmed, but the job still needs action"
          : "Manual handling recorded, but the job still needs action",
      detail: input.customerUpdateBlockedReason
        ? `${actionPrefix} A schedule-change update is still blocked: ${input.customerUpdateBlockedReason}`
        : `${actionPrefix} A schedule-change update is still waiting on another action.`,
    };
  }

  if (input.customerUpdateAlreadySent) {
    return {
      state: "clear",
      badge: "Operationally clear",
      title:
        input.outcome === "confirmed_schedule"
          ? "Schedule confirmed; latest update already sent"
          : "Customer contacted; latest update already sent",
      detail:
        input.outcome === "confirmed_schedule"
          ? `${actionPrefix} The schedule was confirmed and the latest update is already recorded as sent.`
          : `${actionPrefix} The latest schedule change is already recorded as sent.`,
    };
  }

  return {
    state: "clear",
    badge: "Operationally clear",
    title:
      input.outcome === "confirmed_schedule"
        ? "Schedule confirmed; no further dispatch update pending"
        : "Customer contacted; no further dispatch update pending",
    detail:
      input.outcome === "confirmed_schedule"
        ? `${actionPrefix} The schedule was confirmed and no dispatch update is currently waiting to send.`
        : `${actionPrefix} No dispatch update is currently waiting to send.`,
  };
}

export function describeOperationalJobManualContactOutcome(input: {
  outcome: OperationalJobManualContactOutcome;
}): OperationalJobManualContactOutcomeSummary {
  switch (input.outcome) {
    case "confirmed_schedule":
      return {
        badge: getManualContactOutcomeLabel(input.outcome),
        title: "Confirmed schedule",
        detail:
          "The customer confirmed the current timing during manual follow-up.",
      };
    case "reschedule_needed":
      return {
        badge: getManualContactOutcomeLabel(input.outcome),
        title: "Reschedule needed",
        detail: "The customer said the schedule still needs to change.",
      };
    case "no_response":
      return {
        badge: getManualContactOutcomeLabel(input.outcome),
        title: "No response",
        detail:
          "Manual contact was attempted, but the customer did not respond.",
      };
    default:
      return {
        badge: getManualContactOutcomeLabel(input.outcome),
        title: getManualContactOutcomeLabel(input.outcome),
        detail: "Manual contact outcome recorded.",
      };
  }
}

export function getOperationalJobOutcomeNextAction(input: {
  outcome: OperationalJobManualContactOutcome | null;
  outcomeOccurredAt: string | Date | null;
  customerUpdateOccurredAt: string | Date | null;
  customerUpdatePending: boolean;
  customerUpdateCanSend: boolean;
  customerUpdateBlockedReason: string | null;
  customerUpdateAlreadySent: boolean;
  remediationActions: OperationalJobRemediationAction[];
}): OperationalJobNextActionRecommendation | null {
  if (!input.outcome) {
    return null;
  }

  const updateReady =
    input.customerUpdatePending &&
    input.customerUpdateCanSend &&
    !input.customerUpdateBlockedReason;
  const rescheduleStepCompleted =
    input.outcome === "reschedule_needed"
      ? hasCustomerUpdateAfterOutcome({
          outcomeOccurredAt: input.outcomeOccurredAt,
          customerUpdateOccurredAt: input.customerUpdateOccurredAt,
        })
      : false;

  if (input.outcome === "confirmed_schedule" && updateReady) {
    return {
      kind: "send_customer_update",
      label: "Send Update Now",
      detail:
        "The schedule was confirmed manually. Send the customer update from this job now.",
    };
  }

  if (input.outcome === "reschedule_needed") {
    if (rescheduleStepCompleted && updateReady) {
      return {
        kind: "send_customer_update",
        label: "Send Update Now",
        detail:
          "The new schedule is saved and the matching customer update is ready to send.",
      };
    }

    if (rescheduleStepCompleted) {
      return null;
    }

    return {
      kind: "edit_schedule",
      label: "Edit Schedule Now",
      detail:
        "The customer needs a new time. Update the schedule before closing this out.",
    };
  }

  if (input.outcome === "no_response") {
    if (updateReady) {
      return {
        kind: "send_customer_update",
        label: "Send Update Now",
        detail:
          "The customer did not respond manually, but a new schedule-change update is ready to send from this job.",
      };
    }

    if (input.customerUpdateAlreadySent) {
      return null;
    }

    const handoff =
      input.remediationActions.find((action) => action.id === "open-inbox") ||
      input.remediationActions.find((action) => action.id === "call-customer");

    if (!handoff) {
      return null;
    }

    return {
      ...handoff,
      kind: "handoff",
      detail:
        handoff.id === "open-inbox"
          ? "The customer did not respond. Open the thread if you want to continue follow-up there."
          : "The customer did not respond. Try calling again if this update is still time-sensitive.",
    };
  }

  return null;
}
