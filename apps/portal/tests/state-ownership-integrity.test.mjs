import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyStatusUpdateEventTitle,
  buildLegacyStatusUpdateNoteBody,
  classifyLegacyJobBookingMirrorDrift,
  deriveLegacyDraftEstimateShareRepair,
  findMatchingLegacyStatusUpdateNote,
  isLegacySyntheticStatusUpdateEvent,
} from "../lib/state-ownership-integrity.ts";

test("legacy synthetic status events require the old route signature and matching note", () => {
  const createdAt = new Date("2026-04-15T17:00:00.000Z");
  const event = {
    id: "event-1",
    leadId: "lead-1",
    type: "JOB",
    provider: "LOCAL",
    status: "ON_SITE",
    title: buildLegacyStatusUpdateEventTitle({ contactName: "Pat Doe" }),
    googleEventId: null,
    googleCalendarId: null,
    startAt: createdAt,
    endAt: new Date("2026-04-15T17:30:00.000Z"),
    assignedToUserId: "user-1",
    createdByUserId: "user-1",
    createdAt,
    lead: {
      contactName: "Pat Doe",
      businessName: null,
    },
  };
  const notes = [
    {
      leadId: "lead-1",
      createdByUserId: "user-1",
      body: buildLegacyStatusUpdateNoteBody("ON_SITE"),
      createdAt: new Date("2026-04-15T17:00:30.000Z"),
    },
  ];

  assert.equal(
    isLegacySyntheticStatusUpdateEvent({
      event,
      matchingLeadNote: findMatchingLegacyStatusUpdateNote({
        event,
        notes,
      }),
    }),
    true,
  );

  assert.equal(
    isLegacySyntheticStatusUpdateEvent({
      event: {
        ...event,
        endAt: new Date("2026-04-15T17:45:00.000Z"),
      },
      matchingLeadNote: true,
    }),
    false,
  );
});

test("job mirror drift distinguishes repairable orphaned schedules from backfill candidates", () => {
  assert.deepEqual(
    classifyLegacyJobBookingMirrorDrift({
      dispatchStatus: "SCHEDULED",
      scheduledDate: new Date("2026-04-15T00:00:00.000Z"),
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      crewOrder: 0,
      linkedBookingEventCount: 0,
      activeLeadBookingEventCount: 0,
    }),
    {
      kind: "orphaned_schedule_mirror_job",
      canRepair: true,
    },
  );

  assert.deepEqual(
    classifyLegacyJobBookingMirrorDrift({
      dispatchStatus: "SCHEDULED",
      scheduledDate: new Date("2026-04-15T00:00:00.000Z"),
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      crewOrder: 0,
      linkedBookingEventCount: 0,
      activeLeadBookingEventCount: 1,
    }),
    {
      kind: "job_schedule_mirror_needs_booking_link_backfill",
      canRepair: false,
    },
  );

  assert.deepEqual(
    classifyLegacyJobBookingMirrorDrift({
      dispatchStatus: "ON_SITE",
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      crewOrder: null,
      linkedBookingEventCount: 0,
      activeLeadBookingEventCount: 0,
    }),
    {
      kind: "job_execution_state_without_booking",
      canRepair: false,
    },
  );
});

test("draft estimate share repair upgrades viewed and final customer-visible states", () => {
  const viewedRepair = deriveLegacyDraftEstimateShareRepair({
    status: "DRAFT",
    sharedAt: null,
    shareExpiresAt: null,
    sentAt: null,
    viewedAt: null,
    customerViewedAt: null,
    approvedAt: null,
    declinedAt: null,
    customerDecisionAt: null,
    shareLinks: [
      {
        createdAt: new Date("2026-04-10T12:00:00.000Z"),
        expiresAt: new Date("2026-05-10T12:00:00.000Z"),
        revokedAt: null,
        firstViewedAt: new Date("2026-04-11T13:00:00.000Z"),
        lastViewedAt: null,
        approvedAt: null,
        declinedAt: null,
      },
    ],
  });

  assert.equal(viewedRepair?.targetStatus, "VIEWED");
  assert.equal(viewedRepair?.data.sentAt?.toISOString(), "2026-04-10T12:00:00.000Z");
  assert.equal(viewedRepair?.data.viewedAt?.toISOString(), "2026-04-11T13:00:00.000Z");

  const approvedRepair = deriveLegacyDraftEstimateShareRepair({
    status: "DRAFT",
    sharedAt: null,
    shareExpiresAt: null,
    sentAt: null,
    viewedAt: null,
    customerViewedAt: null,
    approvedAt: null,
    declinedAt: null,
    customerDecisionAt: null,
    shareLinks: [
      {
        createdAt: new Date("2026-04-10T12:00:00.000Z"),
        expiresAt: null,
        revokedAt: null,
        firstViewedAt: new Date("2026-04-11T13:00:00.000Z"),
        lastViewedAt: null,
        approvedAt: new Date("2026-04-12T15:00:00.000Z"),
        declinedAt: null,
      },
    ],
  });

  assert.equal(approvedRepair?.targetStatus, "APPROVED");
  assert.equal(approvedRepair?.data.customerDecisionAt?.toISOString(), "2026-04-12T15:00:00.000Z");
});
