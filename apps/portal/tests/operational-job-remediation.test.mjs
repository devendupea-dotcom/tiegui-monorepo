import assert from "node:assert/strict";
import test from "node:test";
import {
  describeOperationalJobManualClosure,
  describeOperationalJobManualContactOutcome,
  describeOperationalJobManualOutcomeCompletion,
  buildOperationalJobRemediationActions,
  describeOperationalJobManualFollowThrough,
  getOperationalJobNoResponseStaleCue,
  getOperationalJobOutcomeNextAction,
  describeOperationalJobRecoveryEscalation,
  describeOperationalJobRecoveryCompletion,
  getOperationalJobInboundResponseHandoff,
  getOperationalJobInboundResponseContext,
  getOperationalJobPassiveWaitingContext,
  getOperationalJobRemediationIssueKey,
  shouldShowOperationalJobAfterCallOutcomePrompt,
  shouldReEmphasizeNoResponseAction,
  shouldShowOperationalJobRecoveryCta,
  shouldAutoRefreshOperationalJobRemediation,
} from "../lib/operational-job-remediation.ts";

test("phone remediation shows edit, call, and CRM handoffs when available", () => {
  assert.deepEqual(
    buildOperationalJobRemediationActions({
      remediation: {
        kind: "check_phone",
        title: "Check customer phone number",
        detail: "Verify it before retrying.",
      },
      editPhoneHref: "/app/inbox?leadId=lead_123&context=edit",
      callHref: "tel:+15551234567",
      crmHref: "/app/jobs/lead_123",
    }),
    [
      { id: "edit-phone", label: "Edit Phone", href: "/app/inbox?leadId=lead_123&context=edit" },
      { id: "call-customer", label: "Call Customer", href: "tel:+15551234567", native: true },
      { id: "open-crm", label: "Open CRM Folder", href: "/app/jobs/lead_123" },
    ],
  );
});

test("twilio remediation only shows real settings destinations", () => {
  assert.deepEqual(
    buildOperationalJobRemediationActions({
      remediation: {
        kind: "check_twilio",
        title: "Check Twilio or workspace SMS",
        detail: "Fix the setup before retrying.",
      },
      settingsHref: "/app/settings#settings-messaging",
    }),
    [{ id: "open-settings", label: "Open Settings", href: "/app/settings#settings-messaging" }],
  );
});

test("retry remediation prefers inbox and call handoffs without inventing extras", () => {
  assert.deepEqual(
    buildOperationalJobRemediationActions({
      remediation: {
        kind: "retry_later",
        title: "Retry later",
        detail: "Wait and retry.",
      },
      inboxThreadHref: "/app/inbox?leadId=lead_123",
      callHref: "tel:+15551234567",
    }),
    [
      { id: "open-inbox", label: "Open Inbox Thread", href: "/app/inbox?leadId=lead_123" },
      { id: "call-customer", label: "Call Customer", href: "tel:+15551234567", native: true },
    ],
  );
});

test("issue key prefers remediation kind, then blocked state, then delivery issue", () => {
  assert.equal(
    getOperationalJobRemediationIssueKey({
      lastCustomerUpdate: {
        remediation: { kind: "check_phone", title: "Check phone", detail: "Fix the number." },
        operatorFailureReason: "Customer phone number needs attention.",
        deliveryState: "failed",
      },
      customerUpdate: {
        pending: true,
        canSend: false,
        blockedReason: "Customer phone is missing.",
      },
    }),
    "remediation:check_phone",
  );

  assert.equal(
    getOperationalJobRemediationIssueKey({
      lastCustomerUpdate: null,
      customerUpdate: {
        pending: true,
        canSend: false,
        blockedReason: "Outside SMS send hours.",
      },
    }),
    "blocked:Outside SMS send hours.",
  );

  assert.equal(
    getOperationalJobRemediationIssueKey({
      lastCustomerUpdate: {
        remediation: null,
        operatorFailureReason: "Customer update failed to send.",
        deliveryState: "failed",
      },
      customerUpdate: {
        pending: false,
        canSend: false,
        blockedReason: null,
      },
    }),
    "delivery:Customer update failed to send.",
  );
});

test("auto-refresh only runs while there is a real remediation issue to re-check", () => {
  assert.equal(
    shouldAutoRefreshOperationalJobRemediation({
      lastCustomerUpdate: {
        remediation: { kind: "retry_later", title: "Retry later", detail: "Wait and retry." },
        operatorFailureReason: "Outside SMS send hours.",
        deliveryState: "suppressed",
      },
      customerUpdate: {
        pending: true,
        canSend: false,
        blockedReason: "Outside SMS send hours.",
      },
    }),
    true,
  );

  assert.equal(
    shouldAutoRefreshOperationalJobRemediation({
      lastCustomerUpdate: {
        remediation: null,
        operatorFailureReason: null,
        deliveryState: "delivered",
      },
      customerUpdate: {
        pending: true,
        canSend: true,
        blockedReason: null,
      },
    }),
    false,
  );
});

test("recovery CTA only appears after a real issue clears and the pending update is sendable", () => {
  assert.equal(
    shouldShowOperationalJobRecoveryCta({
      previousIssueKey: "blocked:Customer phone is missing.",
      current: {
        lastCustomerUpdate: {
          remediation: null,
          operatorFailureReason: null,
          deliveryState: "sent",
        },
        customerUpdate: {
          pending: true,
          canSend: true,
          blockedReason: null,
        },
      },
    }),
    true,
  );

  assert.equal(
    shouldShowOperationalJobRecoveryCta({
      previousIssueKey: "blocked:Customer phone is missing.",
      current: {
        lastCustomerUpdate: {
          remediation: null,
          operatorFailureReason: null,
          deliveryState: "sent",
        },
        customerUpdate: {
          pending: false,
          canSend: true,
          blockedReason: null,
        },
      },
    }),
    false,
  );

  assert.equal(
    shouldShowOperationalJobRecoveryCta({
      previousIssueKey: null,
      current: {
        lastCustomerUpdate: {
          remediation: null,
          operatorFailureReason: null,
          deliveryState: "sent",
        },
        customerUpdate: {
          pending: true,
          canSend: true,
          blockedReason: null,
        },
      },
    }),
    false,
  );
});

test("recovery completion copy stays aligned with real delivery truth", () => {
  assert.deepEqual(
    describeOperationalJobRecoveryCompletion({
      deliveryState: null,
      reflectedInServerState: false,
    }),
    {
      title: "Customer update resumed",
      detail: "Customer update sent. Waiting on delivery confirmation.",
    },
  );

  assert.deepEqual(
    describeOperationalJobRecoveryCompletion({
      deliveryState: "delivered",
      reflectedInServerState: true,
    }),
    {
      title: "Customer update resumed",
      detail: "Customer update sent and delivery was confirmed.",
    },
  );

  assert.deepEqual(
    describeOperationalJobRecoveryCompletion({
      deliveryState: "failed",
      reflectedInServerState: true,
    }),
    {
      title: "Customer update resumed",
      detail: "Customer update sent, but delivery still needs attention.",
    },
  );
});

test("recovery escalation only appears for resumed sends that later land in a bad delivery state", () => {
  assert.deepEqual(
    describeOperationalJobRecoveryEscalation({
      recoverySend: true,
      deliveryState: "failed",
      providerStatus: "undelivered",
      operatorFailureReason: "Customer phone number needs attention.",
    }),
    {
      title: "Customer update was not delivered after resume",
      detail: "Customer phone number needs attention.",
    },
  );

  assert.deepEqual(
    describeOperationalJobRecoveryEscalation({
      recoverySend: true,
      deliveryState: "suppressed",
      providerStatus: "suppressed",
      operatorFailureReason: "Customer update was suppressed before send.",
    }),
    {
      title: "Customer update was blocked after resume",
      detail: "Customer update was suppressed before send.",
    },
  );

  assert.equal(
    describeOperationalJobRecoveryEscalation({
      recoverySend: false,
      deliveryState: "failed",
      providerStatus: "failed",
      operatorFailureReason: "Customer update failed to send.",
    }),
    null,
  );

  assert.equal(
    describeOperationalJobRecoveryEscalation({
      recoverySend: true,
      deliveryState: "delivered",
      providerStatus: "delivered",
      operatorFailureReason: null,
    }),
    null,
  );
});

test("after-call outcome prompt only appears for a live call-customer follow-through with no recorded outcome yet", () => {
  assert.equal(
    shouldShowOperationalJobAfterCallOutcomePrompt({
      manualFollowThroughState: "started",
      manualFollowThroughActionId: "call-customer",
      manualContactOutcome: null,
    }),
    true,
  );

  assert.equal(
    shouldShowOperationalJobAfterCallOutcomePrompt({
      manualFollowThroughState: "handled",
      manualFollowThroughActionId: "call-customer",
      manualContactOutcome: null,
    }),
    false,
  );

  assert.equal(
    shouldShowOperationalJobAfterCallOutcomePrompt({
      manualFollowThroughState: "started",
      manualFollowThroughActionId: "open-inbox",
      manualContactOutcome: null,
    }),
    false,
  );

  assert.equal(
    shouldShowOperationalJobAfterCallOutcomePrompt({
      manualFollowThroughState: "started",
      manualFollowThroughActionId: "call-customer",
      manualContactOutcome: "no_response",
    }),
    false,
  );
});

test("manual follow-through copy stays distinct from delivery state and action-aware", () => {
  assert.deepEqual(
    describeOperationalJobManualFollowThrough({
      state: "started",
      actionId: "open-inbox",
    }),
    {
      title: "Manual follow-up in progress",
      detail: "Follow-through started from Open Inbox Thread.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualFollowThrough({
      state: "handled",
      actionId: "call-customer",
    }),
    {
      title: "Handled manually",
      detail: "Marked handled manually after Call Customer.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualFollowThrough({
      state: "handled",
      actionId: "mark-handled",
    }),
    {
      title: "Handled manually",
      detail: "This resumed update was handled manually.",
    },
  );
});

test("manual closure stays grounded in current pending-update truth", () => {
  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: null,
      outcomeOccurredAt: null,
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "clear",
      badge: "Operationally clear",
      title: "Customer contacted; no further dispatch update pending",
      detail: "Customer contact was completed after Call Customer. No dispatch update is currently waiting to send.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "open-inbox",
      outcome: null,
      outcomeOccurredAt: null,
      customerUpdateOccurredAt: "2026-04-08T18:05:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "update_pending",
      badge: "Update still pending",
      title: "Customer contacted; schedule-change update still pending",
      detail: "Customer contact was completed after Open Inbox Thread. A schedule-change update is still ready to send from this job.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "mark-handled",
      outcome: null,
      outcomeOccurredAt: null,
      customerUpdateOccurredAt: "2026-04-08T18:05:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: "Outside SMS send hours.",
      customerUpdateAlreadySent: false,
    }),
    {
      state: "needs_action",
      badge: "Still needs action",
      title: "Manual handling recorded, but the job still needs action",
      detail: "Manual handling was recorded. A schedule-change update is still blocked: Outside SMS send hours.",
    },
  );
});

test("manual contact outcomes stay lightweight and operator-readable", () => {
  assert.deepEqual(
    describeOperationalJobManualContactOutcome({
      outcome: "confirmed_schedule",
    }),
    {
      badge: "Confirmed schedule",
      title: "Confirmed schedule",
      detail: "The customer confirmed the current timing during manual follow-up.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualContactOutcome({
      outcome: "reschedule_needed",
    }),
    {
      badge: "Reschedule needed",
      title: "Reschedule needed",
      detail: "The customer said the schedule still needs to change.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualContactOutcome({
      outcome: "no_response",
    }),
    {
      badge: "No response",
      title: "No response",
      detail: "Manual contact was attempted, but the customer did not respond.",
    },
  );
});

test("manual closure uses recorded contact outcomes conservatively", () => {
  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: "confirmed_schedule",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "clear",
      badge: "Operationally clear",
      title: "Schedule confirmed; no further dispatch update pending",
      detail: "Customer contact was completed after Call Customer. The schedule was confirmed and no dispatch update is currently waiting to send.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "open-inbox",
      outcome: "reschedule_needed",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "needs_action",
      badge: "Still needs action",
      title: "Reschedule needed; the job still needs action",
      detail: "Customer contact was completed after Open Inbox Thread. The customer asked to reschedule, so this job is not operationally clear yet.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "mark-handled",
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "needs_action",
      badge: "Still needs manual contact",
      title: "No response recorded; still needs manual contact",
      detail: "Manual handling was recorded. The customer did not respond during manual contact, and no new customer update is currently pending from this job.",
    },
  );
});

test("manual closure replaces passive waiting when newer customer activity exists after the last follow-up", () => {
  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-07T19:00:00.000Z",
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: true,
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T12:30:00.000Z",
      customerResponseSummary: "Inbound SMS received",
    }),
    {
      state: "clear",
      badge: "New customer activity",
      title: "Customer activity recorded after follow-up",
      detail:
        "Customer contact was completed after Call Customer. A newer inbound customer activity was recorded after the last follow-up: Inbound SMS received",
    },
  );
});

test("manual closure stops foregrounding inbound response once newer outbound follow-up exists", () => {
  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-07T19:00:00.000Z",
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: true,
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T12:30:00.000Z",
      customerResponseSummary: "Inbound SMS received",
      operatorFollowUpOccurredAt: "2026-04-08T13:10:00.000Z",
      operatorFollowUpSummary: "Outbound SMS sent",
    }),
    {
      state: "needs_action",
      badge: "Waiting on follow-up",
      title: "Customer follow-up already recorded",
      detail:
        "Customer contact was completed after Call Customer. A newer outbound customer follow-up was recorded after the inbound response: Outbound SMS sent",
    },
  );
});

test("outcome-driven next action sends the update when the schedule was confirmed and a real update is pending", () => {
  assert.deepEqual(
    getOperationalJobOutcomeNextAction({
      outcome: "confirmed_schedule",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-08T18:05:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [],
    }),
    {
      kind: "send_customer_update",
      label: "Send Update Now",
      detail: "The schedule was confirmed manually. Send the customer update from this job now.",
    },
  );
});

test("outcome-driven next action keeps reschedule outcomes on the schedule step until a new update exists", () => {
  assert.deepEqual(
    getOperationalJobOutcomeNextAction({
      outcome: "reschedule_needed",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [],
    }),
    {
      kind: "edit_schedule",
      label: "Edit Schedule Now",
      detail: "The customer needs a new time. Update the schedule before closing this out.",
    },
  );
});

test("outcome-driven next action flips to send after the new reschedule update is actually logged", () => {
  assert.deepEqual(
    getOperationalJobOutcomeNextAction({
      outcome: "reschedule_needed",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-08T18:08:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [],
    }),
    {
      kind: "send_customer_update",
      label: "Send Update Now",
      detail: "The new schedule is saved and the matching customer update is ready to send.",
    },
  );
});

test("outcome-driven next action reuses existing no-response handoffs without inventing new flow state", () => {
  assert.deepEqual(
    getOperationalJobOutcomeNextAction({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [
        { id: "open-inbox", label: "Open Inbox Thread", href: "/app/inbox?leadId=lead_123" },
        { id: "call-customer", label: "Call Customer", href: "tel:+15551234567", native: true },
      ],
    }),
    {
      kind: "handoff",
      id: "open-inbox",
      label: "Open Inbox Thread",
      href: "/app/inbox?leadId=lead_123",
      detail: "The customer did not respond. Open the thread if you want to continue follow-up there.",
    },
  );
});

test("outcome-driven next action stays hidden when there is no honest next move to recommend", () => {
  assert.equal(
    getOperationalJobOutcomeNextAction({
      outcome: "confirmed_schedule",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [],
    }),
    null,
  );

  assert.equal(
    getOperationalJobOutcomeNextAction({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [],
    }),
    null,
  );
});

test("manual closure reflects when a reschedule outcome has already produced the next sendable update", () => {
  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: "reschedule_needed",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-08T18:08:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "update_pending",
      badge: "Update still pending",
      title: "Reschedule saved; customer update still pending",
      detail: "Customer contact was completed after Call Customer. The new schedule is saved, and the customer update is ready to send from this job.",
    },
  );
});

test("no-response branch becomes clearer when new update, blocked update, or sent follow-up exists", () => {
  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-08T18:09:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
    }),
    {
      state: "update_pending",
      badge: "New update pending",
      title: "No response recorded; customer update still pending",
      detail: "Customer contact was completed after Call Customer. The customer did not respond during manual contact, but a schedule-change update is now ready to send from this job.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "open-inbox",
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-08T18:09:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: "Outside SMS send hours.",
      customerUpdateAlreadySent: false,
    }),
    {
      state: "needs_action",
      badge: "Still needs action",
      title: "No response recorded; update still blocked",
      detail: "Customer contact was completed after Open Inbox Thread. The customer did not respond, and the next customer update is still blocked: Outside SMS send hours.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualClosure({
      actionId: "call-customer",
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: true,
    }),
    {
      state: "needs_action",
      badge: "Waiting on follow-up",
      title: "No response recorded; waiting on follow-up",
      detail: "Customer contact was completed after Call Customer. The latest schedule change is already recorded as sent, so this job is now waiting on customer follow-up.",
    },
  );
});

test("no-response next action prefers send when a real update is now ready and stays quiet after a follow-up send", () => {
  assert.deepEqual(
    getOperationalJobOutcomeNextAction({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-08T18:09:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      remediationActions: [
        { id: "open-inbox", label: "Open Inbox Thread", href: "/app/inbox?leadId=lead_123" },
      ],
    }),
    {
      kind: "send_customer_update",
      label: "Send Update Now",
      detail: "The customer did not respond manually, but a new schedule-change update is ready to send from this job.",
    },
  );

  assert.equal(
    getOperationalJobOutcomeNextAction({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-08T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: true,
      remediationActions: [
        { id: "open-inbox", label: "Open Inbox Thread", href: "/app/inbox?leadId=lead_123" },
      ],
    }),
    null,
  );
});

test("manual outcome completion foregrounds the new sent state without inventing delivery truth", () => {
  assert.deepEqual(
    describeOperationalJobManualOutcomeCompletion({
      outcome: "confirmed_schedule",
      deliveryState: null,
      reflectedInServerState: false,
    }),
    {
      title: "Confirmed schedule follow-up sent",
      detail: "Customer update sent. Waiting on delivery confirmation.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualOutcomeCompletion({
      outcome: "reschedule_needed",
      deliveryState: "delivered",
      reflectedInServerState: true,
    }),
    {
      title: "Reschedule follow-up sent",
      detail: "Customer update sent and delivery was confirmed.",
    },
  );

  assert.deepEqual(
    describeOperationalJobManualOutcomeCompletion({
      outcome: "confirmed_schedule",
      deliveryState: "failed",
      reflectedInServerState: true,
    }),
    {
      title: "Confirmed schedule follow-up sent",
      detail: "Customer update sent, but delivery still needs attention.",
    },
  );
});

test("no-response stale cue stays quiet for fresh cases and appears once the case has actually lingered", () => {
  assert.equal(
    getOperationalJobNoResponseStaleCue({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      now: "2026-04-08T12:00:00.000Z",
    }),
    null,
  );

  assert.deepEqual(
    getOperationalJobNoResponseStaleCue({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      now: "2026-04-08T19:30:00.000Z",
    }),
    {
      badge: "No follow-up yet",
      detail: "No new follow-up has been recorded for over a day since the customer did not respond.",
    },
  );
});

test("no-response stale cue differentiates waiting, blocked, and update-ready states honestly", () => {
  assert.deepEqual(
    getOperationalJobNoResponseStaleCue({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: true,
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      now: "2026-04-09T18:30:00.000Z",
    }),
    {
      badge: "Still waiting on customer",
      detail: "The last follow-up was already sent 2 days ago and the job is still waiting on customer response.",
    },
  );

  assert.deepEqual(
    getOperationalJobNoResponseStaleCue({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-07T19:00:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: "Outside SMS send hours.",
      customerUpdateAlreadySent: false,
      now: "2026-04-09T19:30:00.000Z",
    }),
    {
      badge: "Still blocked",
      detail: "The next customer update has still been blocked for 2 days: Outside SMS send hours.",
    },
  );

  assert.deepEqual(
    getOperationalJobNoResponseStaleCue({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: "2026-04-07T19:00:00.000Z",
      customerUpdatePending: true,
      customerUpdateCanSend: true,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: false,
      now: "2026-04-09T19:30:00.000Z",
    }),
    {
      badge: "No follow-up yet",
      detail: "A schedule-change update has been ready to send for 2 days.",
    },
  );

  assert.equal(
    getOperationalJobNoResponseStaleCue({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdateOccurredAt: null,
      customerUpdatePending: false,
      customerUpdateCanSend: false,
      customerUpdateBlockedReason: null,
      customerUpdateAlreadySent: true,
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T08:00:00.000Z",
      now: "2026-04-09T18:30:00.000Z",
    }),
    null,
  );
});

test("stale no-response action re-emphasis only turns on for actionable stale branches", () => {
  assert.equal(
    shouldReEmphasizeNoResponseAction({
      outcome: "no_response",
      staleCue: {
        badge: "No follow-up yet",
        detail: "A schedule-change update has been ready to send for 2 days.",
      },
      nextActionKind: "send_customer_update",
    }),
    true,
  );

  assert.equal(
    shouldReEmphasizeNoResponseAction({
      outcome: "no_response",
      staleCue: {
        badge: "Still blocked",
        detail: "The next customer update has still been blocked for 2 days.",
      },
      nextActionKind: "handoff",
    }),
    true,
  );

  assert.equal(
    shouldReEmphasizeNoResponseAction({
      outcome: "no_response",
      staleCue: {
        badge: "Still waiting on customer",
        detail: "The last follow-up was already sent 2 days ago and the job is still waiting on customer response.",
      },
      nextActionKind: null,
    }),
    false,
  );

  assert.equal(
    shouldReEmphasizeNoResponseAction({
      outcome: "no_response",
      staleCue: null,
      nextActionKind: "handoff",
    }),
    false,
  );
});

test("passive waiting context stays limited to real no-response waiting branches", () => {
  assert.deepEqual(
    getOperationalJobPassiveWaitingContext({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdatePending: false,
      customerUpdateAlreadySentAt: "2026-04-08T18:15:00.000Z",
      lastCustomerUpdateOccurredAt: "2026-04-08T18:15:00.000Z",
      deliveryState: "delivered",
      deliveryStatusOccurredAt: "2026-04-08T18:17:00.000Z",
    }),
    {
      label: "Last touch",
      lastTouchOccurredAt: "2026-04-08T18:15:00.000Z",
      waitingSinceAt: "2026-04-08T18:15:00.000Z",
      manualOutcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      deliveryState: "delivered",
      deliveryStatusOccurredAt: "2026-04-08T18:17:00.000Z",
    },
  );

  assert.equal(
    getOperationalJobPassiveWaitingContext({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdatePending: true,
      customerUpdateAlreadySentAt: "2026-04-08T18:15:00.000Z",
      lastCustomerUpdateOccurredAt: "2026-04-08T18:15:00.000Z",
      deliveryState: "delivered",
      deliveryStatusOccurredAt: "2026-04-08T18:17:00.000Z",
    }),
    null,
  );

  assert.equal(
    getOperationalJobPassiveWaitingContext({
      outcome: "confirmed_schedule",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdatePending: false,
      customerUpdateAlreadySentAt: "2026-04-08T18:15:00.000Z",
      lastCustomerUpdateOccurredAt: "2026-04-08T18:15:00.000Z",
      deliveryState: "delivered",
      deliveryStatusOccurredAt: "2026-04-08T18:17:00.000Z",
    }),
    null,
  );

  assert.equal(
    getOperationalJobPassiveWaitingContext({
      outcome: "no_response",
      outcomeOccurredAt: "2026-04-07T18:00:00.000Z",
      customerUpdatePending: false,
      customerUpdateAlreadySentAt: "2026-04-08T18:15:00.000Z",
      lastCustomerUpdateOccurredAt: "2026-04-08T18:15:00.000Z",
      deliveryState: "delivered",
      deliveryStatusOccurredAt: "2026-04-08T18:17:00.000Z",
      customerResponseOccurredAt: "2026-04-08T19:00:00.000Z",
    }),
    null,
  );
});

test("inbound response context stays compact and only appears for newer real customer activity", () => {
  assert.deepEqual(
    getOperationalJobInboundResponseContext({
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T08:00:00.000Z",
      customerResponseType: "sms",
    }),
    {
      label: "New customer activity",
      title: "New customer text received",
      detail: "Recorded after the last follow-up.",
      occurredAt: "2026-04-08T08:00:00.000Z",
    },
  );

  assert.deepEqual(
    getOperationalJobInboundResponseContext({
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T08:00:00.000Z",
      customerResponseType: "voicemail",
    }),
    {
      label: "New customer activity",
      title: "New voicemail received",
      detail: "Recorded after the last follow-up.",
      occurredAt: "2026-04-08T08:00:00.000Z",
    },
  );

  assert.equal(
    getOperationalJobInboundResponseContext({
      customerUpdateAlreadySentAt: "2026-04-08T09:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T08:00:00.000Z",
      customerResponseType: "call",
    }),
    null,
  );

  assert.equal(
    getOperationalJobInboundResponseContext({
      customerUpdateAlreadySentAt: "2026-04-07T19:00:00.000Z",
      customerResponseOccurredAt: "2026-04-08T08:00:00.000Z",
      customerResponseType: "sms",
      operatorFollowUpOccurredAt: "2026-04-08T08:30:00.000Z",
    }),
    null,
  );
});

test("inbound response handoff prefers the right existing destination for each activity type", () => {
  assert.deepEqual(
    getOperationalJobInboundResponseHandoff({
      customerResponseType: "sms",
      inboxThreadHref: "/app/inbox?leadId=lead_123",
      crmHref: "/app/jobs/lead_123",
      callHref: "tel:+15551234567",
    }),
    {
      id: "open-inbox",
      label: "Open Inbox Thread",
      href: "/app/inbox?leadId=lead_123",
    },
  );

  assert.deepEqual(
    getOperationalJobInboundResponseHandoff({
      customerResponseType: "call",
      inboxThreadHref: "/app/inbox?leadId=lead_123",
      crmHref: "/app/jobs/lead_123",
      callHref: "tel:+15551234567",
    }),
    {
      id: "call-customer",
      label: "Call Customer",
      href: "tel:+15551234567",
      native: true,
    },
  );

  assert.deepEqual(
    getOperationalJobInboundResponseHandoff({
      customerResponseType: "voicemail",
      inboxThreadHref: null,
      crmHref: "/app/jobs/lead_123",
      callHref: null,
    }),
    {
      id: "open-crm",
      label: "Open CRM Folder",
      href: "/app/jobs/lead_123",
    },
  );

  assert.equal(
    getOperationalJobInboundResponseHandoff({
      customerResponseType: "sms",
      inboxThreadHref: null,
      crmHref: "/app/jobs/lead_123",
      callHref: "tel:+15551234567",
    }),
    null,
  );
});
