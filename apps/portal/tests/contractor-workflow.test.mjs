import assert from "node:assert/strict";
import test from "node:test";
import {
  getContractorWorkflowTone,
  resolveContractorWorkflow,
  resolveContractorWorkflowActionTarget,
} from "../lib/contractor-workflow.ts";

const baseInput = {
  hasMessagingWorkspace: true,
  latestMessageDirection: null,
  nextFollowUpAt: null,
  latestEstimateStatus: null,
  hasScheduledJob: false,
  hasOperationalJob: false,
  hasLatestInvoice: false,
  hasOpenInvoice: false,
  latestInvoicePaid: false,
  now: new Date("2026-04-13T12:00:00.000Z"),
};

test("inbound replies stay highest priority in the contractor workflow", () => {
  const workflow = resolveContractorWorkflow({
    ...baseInput,
    latestMessageDirection: "INBOUND",
  });

  assert.equal(workflow.stage, "reply_needed");
  assert.equal(workflow.nextAction.kind, "open_follow_up");
  assert.equal(workflow.attentionLevel, "urgent");
});

test("overdue follow-ups stay ahead of estimate work", () => {
  const workflow = resolveContractorWorkflow({
    ...baseInput,
    nextFollowUpAt: new Date("2026-04-13T11:00:00.000Z"),
  });

  assert.equal(workflow.stage, "follow_up_overdue");
  assert.equal(workflow.nextAction.kind, "open_follow_up");
});

test("leads with no estimate move into estimate creation", () => {
  const workflow = resolveContractorWorkflow(baseInput);

  assert.equal(workflow.stage, "estimate_needed");
  assert.equal(workflow.nextAction.kind, "create_estimate");
});

test("draft and declined estimates use different estimate next steps", () => {
  const draft = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "DRAFT",
  });
  const declined = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "DECLINED",
  });

  assert.equal(draft.stage, "estimate_draft");
  assert.equal(draft.nextAction.kind, "finish_estimate");
  assert.equal(declined.stage, "estimate_revision");
  assert.equal(declined.nextAction.kind, "revise_estimate");
});

test("sent estimates stay in follow-up until they are approved", () => {
  const workflow = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "VIEWED",
  });

  assert.equal(workflow.stage, "waiting_on_approval");
  assert.equal(workflow.nextAction.kind, "open_follow_up");
});

test("approved work moves to scheduling, then operations, then invoices", () => {
  const readyToSchedule = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "APPROVED",
  });
  const scheduled = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "APPROVED",
    hasScheduledJob: true,
    hasOperationalJob: true,
  });
  const awaitingPayment = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "APPROVED",
    hasScheduledJob: true,
    hasOperationalJob: true,
    hasLatestInvoice: true,
    hasOpenInvoice: true,
  });

  assert.equal(readyToSchedule.stage, "ready_to_schedule");
  assert.equal(readyToSchedule.nextAction.kind, "schedule_job");
  assert.equal(scheduled.stage, "job_scheduled");
  assert.equal(scheduled.nextAction.kind, "open_operational_job");
  assert.equal(awaitingPayment.stage, "awaiting_payment");
  assert.equal(awaitingPayment.nextAction.kind, "open_invoices");
});

test("paid work settles into a done state", () => {
  const workflow = resolveContractorWorkflow({
    ...baseInput,
    latestEstimateStatus: "APPROVED",
    hasScheduledJob: true,
    hasLatestInvoice: true,
    latestInvoicePaid: true,
  });

  assert.equal(workflow.stage, "paid");
  assert.equal(workflow.attentionLevel, "done");
  assert.equal(getContractorWorkflowTone(workflow.attentionLevel), "good");
});

test("call-first shops still get a usable next action target", () => {
  const workflow = resolveContractorWorkflow({
    ...baseInput,
    hasMessagingWorkspace: false,
    latestMessageDirection: "INBOUND",
  });
  const actionTarget = resolveContractorWorkflowActionTarget({
    action: workflow.nextAction,
    messagesHref: "/app/jobs/lead-1?tab=messages",
    phoneHref: "tel:+15555555555",
    createEstimateHref: "/app/estimates?create=1&leadId=lead-1",
    latestEstimateHref: null,
    scheduleCalendarHref: "/app/calendar?quickAction=schedule&leadId=lead-1",
    operationalJobHref: null,
    invoiceHref: "/app/jobs/lead-1?tab=invoice",
    overviewHref: "/app/jobs/lead-1?tab=overview",
  });

  assert.equal(workflow.nextAction.kind, "call_customer");
  assert.deepEqual(actionTarget, {
    href: "tel:+15555555555",
    external: true,
  });
});
