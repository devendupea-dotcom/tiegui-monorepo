import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnerBookingNotificationSms,
  formatOwnerReminderLeadTime,
  selectOrgDispatchNotificationCandidate,
} from "../lib/org-owner-notification-core.ts";

test("owner reminder lead time stays readable for hour and minute windows", () => {
  assert.equal(formatOwnerReminderLeadTime(45), "45 minutes");
  assert.equal(formatOwnerReminderLeadTime(120), "about 2 hours");
  assert.equal(formatOwnerReminderLeadTime(90), "about 1 hour 30 minutes");
});

test("owner booking notification SMS includes schedule context for new jobs", () => {
  const message = buildOwnerBookingNotificationSms({
    orgName: "TieGui Roofing",
    bookingType: "job",
    kind: "scheduled",
    customerName: "Pat Doe",
    serviceLabel: "Roof repair",
    addressLine: "123 Main St",
    startAt: new Date("2026-04-25T16:00:00.000Z"),
    endAt: new Date("2026-04-25T18:00:00.000Z"),
    timeZone: "America/Los_Angeles",
  });

  assert.match(message, /New job scheduled for Pat Doe/);
  assert.match(message, /Roof repair\./);
  assert.match(message, /123 Main St\./);
});

test("owner booking reminder SMS calls out estimate reminders", () => {
  const message = buildOwnerBookingNotificationSms({
    orgName: "TieGui Roofing",
    bookingType: "estimate",
    kind: "reminder",
    customerName: "Pat Doe",
    addressLine: "123 Main St",
    startAt: new Date("2026-04-25T16:00:00.000Z"),
    timeZone: "America/Los_Angeles",
    reminderMinutesBefore: 120,
  });

  assert.match(
    message,
    /Reminder - estimate for Pat Doe starts in about 2 hours/,
  );
  assert.match(message, /123 Main St\./);
});

test("dispatch owner notification candidate prefers scheduled and rescheduled scheduling moments", () => {
  const scheduled = selectOrgDispatchNotificationCandidate({
    status: "scheduled",
    events: [
      {
        id: "event-created",
        eventType: "JOB_CREATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: null,
      },
    ],
  });

  assert.deepEqual(scheduled, {
    kind: "scheduled",
    sourceEventId: "event-created",
  });

  const rescheduled = selectOrgDispatchNotificationCandidate({
    status: "scheduled",
    events: [
      {
        id: "event-updated",
        eventType: "JOB_UPDATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: {
          changes: [
            { field: "scheduledDate", from: "2026-04-10", to: "2026-04-11" },
          ],
        },
      },
    ],
  });

  assert.deepEqual(rescheduled, {
    kind: "rescheduled",
    sourceEventId: "event-updated",
  });

  const ignored = selectOrgDispatchNotificationCandidate({
    status: "on_the_way",
    events: [
      {
        id: "event-status",
        eventType: "STATUS_CHANGED",
        fromValue: "scheduled",
        toValue: "on_the_way",
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: null,
      },
    ],
  });

  assert.equal(ignored, null);
});
