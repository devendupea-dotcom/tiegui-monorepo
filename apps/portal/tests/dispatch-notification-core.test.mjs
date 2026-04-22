import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDispatchCustomerNotificationReadiness,
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

test("dispatch notification readiness ignores stale job mirror schedule without a linked booking", () => {
  const readiness = buildDispatchCustomerNotificationReadiness({
    settings: {
      smsEnabled: true,
      notifyScheduled: true,
      notifyOnTheWay: true,
      notifyRescheduled: true,
      notifyCompleted: true,
      canSend: true,
    },
    job: {
      id: "job-1",
      orgId: "org-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Pat Doe",
      phone: "+15551234567",
      serviceType: "Glass repair",
      scheduledDate: new Date("2026-04-11T00:00:00.000Z"),
      scheduledStartTime: "09:00",
      scheduledEndTime: "11:00",
      dispatchStatus: "SCHEDULED",
      calendarEvents: [],
      org: {
        name: "TieGui",
        smsFromNumberE164: "+15557654321",
        smsQuietHoursStartMinute: 0,
        smsQuietHoursEndMinute: 0,
        dashboardConfig: {
          calendarTimezone: "America/Los_Angeles",
        },
        messagingSettings: {
          timezone: "America/Los_Angeles",
        },
      },
      lead: {
        id: "lead-1",
        status: "NEW",
        customerId: "customer-1",
        conversationState: {
          id: "conversation-1",
        },
      },
    },
    candidate: {
      event: {
        id: "event-1",
        eventType: "JOB_CREATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: null,
      },
      kind: "status",
      notificationStatus: "scheduled",
      summary: "Dispatch update: Scheduled",
      changedFields: [],
    },
  });

  assert.equal(readiness.allowed, false);
  assert.equal(readiness.previewBody, null);
  assert.equal(readiness.blockedReason, "Scheduled date is missing.");
});

test("dispatch notification readiness uses linked booking events even when job mirrors are empty", () => {
  const readiness = buildDispatchCustomerNotificationReadiness({
    settings: {
      smsEnabled: true,
      notifyScheduled: true,
      notifyOnTheWay: true,
      notifyRescheduled: true,
      notifyCompleted: true,
      canSend: true,
    },
    job: {
      id: "job-1",
      orgId: "org-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Pat Doe",
      phone: "+15551234567",
      serviceType: "Glass repair",
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      dispatchStatus: "SCHEDULED",
      calendarEvents: [
        {
          id: "booking-1",
          type: "JOB",
          status: "SCHEDULED",
          startAt: new Date("2026-04-11T16:00:00.000Z"),
          endAt: new Date("2026-04-11T18:00:00.000Z"),
          createdAt: new Date("2026-04-09T10:00:00.000Z"),
          updatedAt: new Date("2026-04-09T10:00:00.000Z"),
          jobId: "job-1",
        },
      ],
      org: {
        name: "TieGui",
        smsFromNumberE164: "+15557654321",
        smsQuietHoursStartMinute: 0,
        smsQuietHoursEndMinute: 0,
        dashboardConfig: {
          calendarTimezone: "America/Los_Angeles",
        },
        messagingSettings: {
          timezone: "America/Los_Angeles",
        },
      },
      lead: {
        id: "lead-1",
        status: "NEW",
        customerId: "customer-1",
        conversationState: {
          id: "conversation-1",
        },
      },
    },
    candidate: {
      event: {
        id: "event-1",
        eventType: "JOB_CREATED",
        fromValue: null,
        toValue: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        metadata: null,
      },
      kind: "status",
      notificationStatus: "scheduled",
      summary: "Dispatch update: Scheduled",
      changedFields: [],
    },
  });

  assert.equal(readiness.allowed, true);
  assert.equal(readiness.blockedReason, null);
  assert.match(readiness.previewBody || "", /Apr 11/);
  assert.match(readiness.previewBody || "", /09:00/);
});

test("dispatch notification readiness blocks schedule-driven texts when only historical booking data remains", () => {
  const readiness = buildDispatchCustomerNotificationReadiness({
    settings: {
      smsEnabled: true,
      notifyScheduled: true,
      notifyOnTheWay: true,
      notifyRescheduled: true,
      notifyCompleted: true,
      canSend: true,
    },
    job: {
      id: "job-1",
      orgId: "org-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Pat Doe",
      phone: "+15551234567",
      serviceType: "Glass repair",
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      dispatchStatus: "COMPLETED",
      calendarEvents: [
        {
          id: "booking-1",
          type: "JOB",
          status: "COMPLETED",
          startAt: new Date("2026-04-11T16:00:00.000Z"),
          endAt: new Date("2026-04-11T18:00:00.000Z"),
          createdAt: new Date("2026-04-09T10:00:00.000Z"),
          updatedAt: new Date("2026-04-11T19:00:00.000Z"),
          jobId: "job-1",
        },
      ],
      org: {
        name: "TieGui",
        smsFromNumberE164: "+15557654321",
        smsQuietHoursStartMinute: 0,
        smsQuietHoursEndMinute: 0,
        dashboardConfig: {
          calendarTimezone: "America/Los_Angeles",
        },
        messagingSettings: {
          timezone: "America/Los_Angeles",
        },
      },
      lead: {
        id: "lead-1",
        status: "NEW",
        customerId: "customer-1",
        conversationState: {
          id: "conversation-1",
        },
      },
    },
    candidate: {
      event: {
        id: "event-1",
        eventType: "STATUS_CHANGED",
        fromValue: "scheduled",
        toValue: "scheduled",
        createdAt: new Date("2026-04-11T19:05:00.000Z"),
        metadata: null,
      },
      kind: "status",
      notificationStatus: "scheduled",
      summary: "Dispatch update: Scheduled",
      changedFields: [],
    },
  });

  assert.equal(readiness.allowed, false);
  assert.equal(readiness.previewBody, null);
  assert.equal(readiness.blockedReason, "Scheduled date is missing.");
});

test("dispatch notification readiness still allows completion texts from historical linked booking data", () => {
  const readiness = buildDispatchCustomerNotificationReadiness({
    settings: {
      smsEnabled: true,
      notifyScheduled: true,
      notifyOnTheWay: true,
      notifyRescheduled: true,
      notifyCompleted: true,
      canSend: true,
    },
    job: {
      id: "job-1",
      orgId: "org-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Pat Doe",
      phone: "+15551234567",
      serviceType: "Glass repair",
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      dispatchStatus: "COMPLETED",
      calendarEvents: [
        {
          id: "booking-1",
          type: "JOB",
          status: "COMPLETED",
          startAt: new Date("2026-04-11T16:00:00.000Z"),
          endAt: new Date("2026-04-11T18:00:00.000Z"),
          createdAt: new Date("2026-04-09T10:00:00.000Z"),
          updatedAt: new Date("2026-04-11T19:00:00.000Z"),
          jobId: "job-1",
        },
      ],
      org: {
        name: "TieGui",
        smsFromNumberE164: "+15557654321",
        smsQuietHoursStartMinute: 0,
        smsQuietHoursEndMinute: 0,
        dashboardConfig: {
          calendarTimezone: "America/Los_Angeles",
        },
        messagingSettings: {
          timezone: "America/Los_Angeles",
        },
      },
      lead: {
        id: "lead-1",
        status: "NEW",
        customerId: "customer-1",
        conversationState: {
          id: "conversation-1",
        },
      },
    },
    candidate: {
      event: {
        id: "event-2",
        eventType: "STATUS_CHANGED",
        fromValue: "on_the_way",
        toValue: "completed",
        createdAt: new Date("2026-04-11T19:05:00.000Z"),
        metadata: null,
      },
      kind: "status",
      notificationStatus: "completed",
      summary: "Dispatch update: Completed",
      changedFields: [],
    },
  });

  assert.equal(readiness.allowed, true);
  assert.equal(readiness.blockedReason, null);
  assert.match(readiness.previewBody || "", /marked complete/i);
});
