import assert from "node:assert/strict";
import test from "node:test";
import {
  compareDispatchJobs,
  describeDispatchNotificationBlockedReason,
  describeDispatchSmsOperatorIssue,
  formatDispatchCustomerSms,
  formatDispatchSmsDeliveryStateLabel,
  formatDispatchLocalDateKey,
  formatDispatchScheduledWindow,
  formatDispatchStatusLabel,
  getDispatchSmsRemediation,
  getDispatchSmsDeliveryState,
  getDispatchScheduleChangeFields,
  getDispatchTodayDateKey,
  isMeaningfulDispatchScheduleChange,
  normalizeDispatchDateKey,
  serializeDispatchNotificationSettings,
  shouldSendDispatchStatusNotification,
} from "../lib/dispatch.ts";

test("dispatch status labels stay normalized for UI", () => {
  assert.equal(formatDispatchStatusLabel("scheduled"), "Scheduled");
  assert.equal(formatDispatchStatusLabel("on_the_way"), "On the way");
  assert.equal(formatDispatchStatusLabel("on_site"), "On site");
  assert.equal(formatDispatchStatusLabel("completed"), "Completed");
  assert.equal(formatDispatchStatusLabel("rescheduled"), "Rescheduled");
  assert.equal(formatDispatchStatusLabel("canceled"), "Canceled");
});

test("dispatch date helpers preserve local calendar dates", () => {
  const latePacificEvening = new Date("2026-04-01T23:30:00-07:00");

  assert.equal(formatDispatchLocalDateKey(latePacificEvening), "2026-04-01");
  assert.equal(getDispatchTodayDateKey(latePacificEvening), "2026-04-01");
  assert.equal(normalizeDispatchDateKey("2026-04-01"), "2026-04-01");
  assert.equal(normalizeDispatchDateKey(" 2026-04-01 "), "2026-04-01");
  assert.equal(normalizeDispatchDateKey("2026-4-1"), null);
});

test("dispatch scheduled window formatter handles optional times", () => {
  assert.equal(formatDispatchScheduledWindow("09:00", "11:00"), "09:00 - 11:00");
  assert.equal(formatDispatchScheduledWindow("09:00", null), "Starts 09:00");
  assert.equal(formatDispatchScheduledWindow(null, "11:00"), "By 11:00");
  assert.equal(formatDispatchScheduledWindow(null, null), "Any time");
});

test("compareDispatchJobs sorts by crew order, then time, then name", () => {
  const jobs = [
    {
      id: "3",
      crewOrder: 1,
      scheduledStartTime: "10:00",
      customerName: "Bravo",
    },
    {
      id: "2",
      crewOrder: 0,
      scheduledStartTime: "12:00",
      customerName: "Zulu",
    },
    {
      id: "1",
      crewOrder: 0,
      scheduledStartTime: "09:00",
      customerName: "Alpha",
    },
    {
      id: "4",
      crewOrder: null,
      scheduledStartTime: null,
      customerName: "Omega",
    },
  ];

  jobs.sort(compareDispatchJobs);
  assert.deepEqual(
    jobs.map((job) => job.id),
    ["1", "2", "3", "4"],
  );
});

test("dispatch notification settings default to disabled while keeping stable per-status toggles", () => {
  const settings = serializeDispatchNotificationSettings(null, false);

  assert.equal(settings.smsEnabled, false);
  assert.equal(settings.notifyScheduled, true);
  assert.equal(settings.notifyOnTheWay, true);
  assert.equal(settings.notifyRescheduled, true);
  assert.equal(settings.notifyCompleted, true);
  assert.equal(settings.canSend, false);
});

test("dispatch notification toggles gate status-based customer updates", () => {
  const settings = {
    smsEnabled: true,
    notifyScheduled: false,
    notifyOnTheWay: true,
    notifyRescheduled: true,
    notifyCompleted: false,
    canSend: true,
  };

  assert.equal(shouldSendDispatchStatusNotification(settings, "scheduled"), false);
  assert.equal(shouldSendDispatchStatusNotification(settings, "on_the_way"), true);
  assert.equal(shouldSendDispatchStatusNotification(settings, "rescheduled"), true);
  assert.equal(shouldSendDispatchStatusNotification(settings, "completed"), false);
});

test("dispatch SMS copy stays concise and contractor-friendly", () => {
  const scheduled = formatDispatchCustomerSms({
    orgName: "TieGui Plumbing",
    serviceType: "Water heater install",
    scheduledDate: "2026-04-01",
    scheduledStartTime: "09:00",
    scheduledEndTime: "11:00",
    status: "scheduled",
    timeZone: "America/Los_Angeles",
  });

  const onTheWay = formatDispatchCustomerSms({
    orgName: "TieGui Plumbing",
    serviceType: "Water heater install",
    scheduledDate: "2026-04-01",
    scheduledStartTime: "09:00",
    scheduledEndTime: null,
    status: "on_the_way",
    timeZone: "America/Los_Angeles",
  });

  assert.match(scheduled, /scheduled/i);
  assert.match(scheduled, /Apr 1/);
  assert.match(scheduled, /09:00/);
  assert.match(onTheWay, /on the way/i);
  assert.match(onTheWay, /around 09:00/i);
});

test("schedule-change detection only treats real timing changes as notification-worthy", () => {
  const scheduleMetadata = {
    changes: [
      { field: "scheduledDate", from: "2026-04-08", to: "2026-04-09" },
      { field: "scheduledStartTime", from: "09:00", to: "11:00" },
      { field: "crewOrder", from: "1", to: "2" },
    ],
  };

  assert.deepEqual(getDispatchScheduleChangeFields(scheduleMetadata), ["scheduledDate", "scheduledStartTime"]);
  assert.equal(isMeaningfulDispatchScheduleChange(scheduleMetadata), true);
  assert.equal(
    isMeaningfulDispatchScheduleChange({
      changes: [{ field: "crewOrder", from: "1", to: "2" }],
    }),
    false,
  );
});

test("dispatch notification blocked reasons stay operator-readable", () => {
  assert.equal(
    describeDispatchNotificationBlockedReason({
      smsEnabled: false,
      canSend: true,
      notificationTypeEnabled: true,
      hasCustomerPhone: true,
      hasScheduledDate: true,
      optedOut: false,
      withinSendWindow: true,
    }),
    "Dispatch SMS is disabled for this workspace.",
  );

  assert.equal(
    describeDispatchNotificationBlockedReason({
      smsEnabled: true,
      canSend: false,
      notificationTypeEnabled: true,
      hasCustomerPhone: true,
      hasScheduledDate: true,
      optedOut: false,
      withinSendWindow: true,
    }),
    "Dispatch SMS is not ready because Twilio is missing or paused.",
  );

  assert.equal(
    describeDispatchNotificationBlockedReason({
      smsEnabled: true,
      canSend: true,
      notificationTypeEnabled: true,
      hasCustomerPhone: false,
      hasScheduledDate: true,
      optedOut: false,
      withinSendWindow: true,
    }),
    "Customer phone is missing.",
  );

  assert.equal(
    describeDispatchNotificationBlockedReason({
      smsEnabled: true,
      canSend: true,
      notificationTypeEnabled: true,
      hasCustomerPhone: true,
      hasScheduledDate: true,
      optedOut: false,
      withinSendWindow: true,
    }),
    null,
  );
});

test("dispatch SMS delivery states normalize provider statuses for the workspace", () => {
  assert.equal(getDispatchSmsDeliveryState("queued"), "queued");
  assert.equal(getDispatchSmsDeliveryState("SENT"), "sent");
  assert.equal(getDispatchSmsDeliveryState("delivered"), "delivered");
  assert.equal(getDispatchSmsDeliveryState("undelivered"), "failed");
  assert.equal(getDispatchSmsDeliveryState("SUPPRESSED"), "suppressed");
  assert.equal(getDispatchSmsDeliveryState("mystery"), null);
  assert.equal(formatDispatchSmsDeliveryStateLabel("failed"), "Failed");
  assert.equal(formatDispatchSmsDeliveryStateLabel("suppressed"), "Suppressed");
});

test("dispatch SMS operator issues stay readable", () => {
  assert.equal(
    describeDispatchSmsOperatorIssue({
      deliveryState: "failed",
      providerStatus: "undelivered",
      blockedReason: null,
      failureReason: "30003: Unreachable destination handset.",
      providerErrorCode: "30003",
      providerErrorMessage: "Unreachable destination handset.",
    }),
    "Customer phone number needs attention.",
  );

  assert.equal(
    describeDispatchSmsOperatorIssue({
      deliveryState: "suppressed",
      providerStatus: "suppressed",
      blockedReason: "Outside SMS send hours.",
      failureReason: null,
      providerErrorCode: null,
      providerErrorMessage: null,
    }),
    "Outside SMS send hours.",
  );

  assert.equal(
    describeDispatchSmsOperatorIssue({
      deliveryState: "failed",
      providerStatus: "failed",
      blockedReason: null,
      failureReason: "Twilio account is paused.",
      providerErrorCode: null,
      providerErrorMessage: "Twilio account is paused.",
    }),
    "Twilio or workspace SMS needs attention.",
  );
});

test("dispatch SMS remediation stays conservative and actionable", () => {
  assert.deepEqual(
    getDispatchSmsRemediation({
      deliveryState: "failed",
      providerStatus: "undelivered",
      blockedReason: null,
      failureReason: "Unreachable destination handset.",
      providerErrorCode: "30003",
      providerErrorMessage: "Unreachable destination handset.",
    }),
    {
      kind: "check_phone",
      title: "Check customer phone number",
      detail: "Verify or correct the number before retrying. If timing is urgent, call the customer.",
    },
  );

  assert.deepEqual(
    getDispatchSmsRemediation({
      deliveryState: null,
      providerStatus: null,
      blockedReason: "Outside SMS send hours.",
      failureReason: null,
      providerErrorCode: null,
      providerErrorMessage: null,
    }),
    {
      kind: "retry_later",
      title: "Retry during send hours",
      detail: "Wait until the workspace send window opens, or call the customer if the timing is urgent.",
    },
  );

  assert.deepEqual(
    getDispatchSmsRemediation({
      deliveryState: "failed",
      providerStatus: "failed",
      blockedReason: null,
      failureReason: "Customer has opted out of SMS.",
      providerErrorCode: null,
      providerErrorMessage: null,
    }),
    {
      kind: "opted_out",
      title: "Customer opted out",
      detail: "Do not retry by SMS. Call the customer instead if this update is important.",
    },
  );
});
