import assert from "node:assert/strict";
import test from "node:test";
import { rankConversationalSmsSlotCandidates } from "../lib/conversational-sms-scheduling.ts";

test("rankConversationalSmsSlotCandidates prefers slots inside the configured estimate window", () => {
  const ranked = rankConversationalSmsSlotCandidates({
    timeZone: "America/Los_Angeles",
    preferredWindowStart: "16:00",
    preferredWindowEnd: "19:00",
    candidates: [
      {
        workerUserId: "worker-1",
        startAt: new Date("2026-04-22T16:30:00.000Z"),
        endAt: new Date("2026-04-22T17:30:00.000Z"),
      },
      {
        workerUserId: "worker-1",
        startAt: new Date("2026-04-22T23:30:00.000Z"),
        endAt: new Date("2026-04-23T00:30:00.000Z"),
      },
      {
        workerUserId: "worker-1",
        startAt: new Date("2026-04-22T20:00:00.000Z"),
        endAt: new Date("2026-04-22T21:00:00.000Z"),
      },
    ],
    limit: 3,
  });

  assert.equal(ranked[0]?.startAt.toISOString(), "2026-04-22T23:30:00.000Z");
});

test("rankConversationalSmsSlotCandidates falls back to chronological order without a valid window", () => {
  const ranked = rankConversationalSmsSlotCandidates({
    timeZone: "America/Los_Angeles",
    preferredWindowStart: "",
    preferredWindowEnd: "",
    candidates: [
      {
        workerUserId: "worker-1",
        startAt: new Date("2026-04-23T01:00:00.000Z"),
        endAt: new Date("2026-04-23T02:00:00.000Z"),
      },
      {
        workerUserId: "worker-1",
        startAt: new Date("2026-04-22T20:00:00.000Z"),
        endAt: new Date("2026-04-22T21:00:00.000Z"),
      },
    ],
    limit: 2,
  });

  assert.deepEqual(
    ranked.map((slot) => slot.startAt.toISOString()),
    ["2026-04-22T20:00:00.000Z", "2026-04-23T01:00:00.000Z"],
  );
});
