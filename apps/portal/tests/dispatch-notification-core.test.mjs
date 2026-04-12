import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDispatchNotificationIdempotencyKey,
  selectAutomaticDispatchCustomerNotificationCandidate,
  selectLatestDispatchScheduleChangeCandidate,
} from "../lib/dispatch-notification-core.ts";

test("automatic dispatch notification candidate preserves existing first-match behavior", () => {
  const candidate = selectAutomaticDispatchCustomerNotificationCandidate({
    status: "on_the_way",
    events: [
      {
        id: "event-created",
        eventType: "JOB_CREATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: null,
      },
      {
        id: "event-status",
        eventType: "STATUS_CHANGED",
        fromValue: "scheduled",
        toValue: "on_the_way",
        createdAt: new Date("2026-04-09T11:00:00.000Z"),
        metadata: null,
      },
    ],
  });

  assert.equal(candidate?.event.id, "event-created");
  assert.equal(candidate?.kind, "status");
  assert.equal(candidate?.notificationStatus, "on_the_way");
});

test("latest dispatch schedule-change candidate only returns meaningful schedule changes while scheduled", () => {
  const candidate = selectLatestDispatchScheduleChangeCandidate({
    status: "scheduled",
    events: [
      {
        id: "event-1",
        eventType: "JOB_UPDATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: {
          changes: [{ field: "crewOrder", from: "1", to: "2" }],
        },
      },
      {
        id: "event-2",
        eventType: "JOB_UPDATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T09:00:00.000Z"),
        metadata: {
          changes: [{ field: "scheduledDate", from: "2026-04-10", to: "2026-04-11" }],
        },
      },
    ],
  });

  assert.equal(candidate?.event.id, "event-2");
  assert.deepEqual(candidate?.changedFields, ["scheduledDate"]);
  assert.equal(candidate?.kind, "schedule_change");
});

test("dispatch notification idempotency key stays stable across repeated lookups", () => {
  const first = buildDispatchNotificationIdempotencyKey({
    kind: "schedule_change",
    orgId: "org-1",
    eventId: "event-1",
    status: "rescheduled",
  });
  const second = buildDispatchNotificationIdempotencyKey({
    kind: "schedule_change",
    orgId: "org-1",
    eventId: "event-1",
    status: "rescheduled",
  });

  assert.equal(first, second);
  assert.match(first, /dispatch-schedule-sms/);
});
