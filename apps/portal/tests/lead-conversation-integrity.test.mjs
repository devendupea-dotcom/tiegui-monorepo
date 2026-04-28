import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLeadConversationIntegrity,
  resolveConservativeBookedSnapshotRepair,
} from "../lib/lead-conversation-integrity.ts";

function stateRecord(overrides = {}) {
  return {
    id: "state-1",
    orgId: "org-1",
    leadId: "lead-1",
    stage: "BOOKED",
    lastInboundAt: null,
    lastOutboundAt: null,
    bookedCalendarEventId: null,
    bookedStartAt: null,
    bookedEndAt: null,
    ...overrides,
  };
}

function bookedEvent(overrides = {}) {
  return {
    id: "event-1",
    orgId: "org-1",
    leadId: "lead-1",
    type: "ESTIMATE",
    status: "CONFIRMED",
    startAt: new Date("2026-04-09T17:00:00.000Z"),
    endAt: new Date("2026-04-09T18:00:00.000Z"),
    ...overrides,
  };
}

test("resolveConservativeBookedSnapshotRepair only repairs when the linked event matches the lead and booking type", () => {
  const repair = resolveConservativeBookedSnapshotRepair({
    state: stateRecord({
      bookedCalendarEventId: "event-1",
      bookedStartAt: new Date("2026-04-09T16:00:00.000Z"),
      bookedEndAt: new Date("2026-04-09T17:00:00.000Z"),
    }),
    bookedEvent: bookedEvent(),
  });

  assert.equal(repair.canRepair, true);
  assert.equal(repair.reason, "event_match");
  assert.equal(repair.bookedStartAt?.toISOString(), "2026-04-09T17:00:00.000Z");
  assert.equal(repair.bookedEndAt?.toISOString(), "2026-04-09T18:00:00.000Z");
});

test("analyzeLeadConversationIntegrity flags missing booked snapshot when stage is BOOKED", () => {
  const analysis = analyzeLeadConversationIntegrity({
    state: stateRecord({
      stage: "BOOKED",
      bookedCalendarEventId: null,
    }),
    bookedEvent: null,
    communication: {
      latestInboundAt: null,
      latestOutboundAt: null,
      missingConversationLinkCount: 0,
      latestMissingConversationLinkAt: null,
    },
  });

  assert.deepEqual(analysis.issues.map((issue) => issue.kind), ["booked_stage_missing_event_snapshot"]);
});

test("analyzeLeadConversationIntegrity flags booked snapshot drift and stale communication timestamps separately", () => {
  const analysis = analyzeLeadConversationIntegrity({
    state: stateRecord({
      lastInboundAt: new Date("2026-04-09T10:00:00.000Z"),
      lastOutboundAt: new Date("2026-04-09T11:00:00.000Z"),
      bookedCalendarEventId: "event-1",
      bookedStartAt: new Date("2026-04-09T16:00:00.000Z"),
      bookedEndAt: new Date("2026-04-09T17:00:00.000Z"),
    }),
    bookedEvent: bookedEvent({
      leadId: "lead-2",
      startAt: new Date("2026-04-09T17:00:00.000Z"),
      endAt: new Date("2026-04-09T18:00:00.000Z"),
    }),
    communication: {
      latestInboundAt: new Date("2026-04-09T12:00:00.000Z"),
      latestOutboundAt: new Date("2026-04-09T13:00:00.000Z"),
      missingConversationLinkCount: 2,
      latestMissingConversationLinkAt: new Date("2026-04-09T13:30:00.000Z"),
    },
  });

  assert.deepEqual(
    analysis.issues.map((issue) => issue.kind).sort(),
    [
      "booked_snapshot_event_lead_mismatch",
      "booked_snapshot_time_mismatch",
      "communication_event_missing_conversation_link",
      "conversation_last_inbound_stale",
      "conversation_last_outbound_stale",
    ],
  );
});

test("analyzeLeadConversationIntegrity flags non-booking events linked into booked snapshot", () => {
  const analysis = analyzeLeadConversationIntegrity({
    state: stateRecord({
      bookedCalendarEventId: "event-1",
      bookedStartAt: new Date("2026-04-09T17:00:00.000Z"),
      bookedEndAt: new Date("2026-04-09T18:00:00.000Z"),
    }),
    bookedEvent: bookedEvent({
      type: "FOLLOW_UP",
    }),
    communication: {
      latestInboundAt: null,
      latestOutboundAt: null,
      missingConversationLinkCount: 0,
      latestMissingConversationLinkAt: null,
    },
  });

  assert.deepEqual(analysis.issues.map((issue) => issue.kind), ["booked_snapshot_event_not_booking"]);
  assert.equal(analysis.repair.canRepair, false);
});
