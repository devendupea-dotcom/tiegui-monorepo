import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRevenueInputCents,
  fromDateTimeLocalInputValue,
  mergeInboxTimelineEvents,
  parseRevenueInputToCents,
  toDateTimeLocalInputValue,
} from "../lib/inbox-ui.ts";

test("mergeInboxTimelineEvents keeps optimistic events alongside fetched events in chronological order", () => {
  const merged = mergeInboxTimelineEvents(
    [
      { id: "server-2", createdAt: "2026-03-30T10:05:00.000Z" },
      { id: "server-1", createdAt: "2026-03-30T10:00:00.000Z" },
    ],
    [
      { id: "temp-1", createdAt: "2026-03-30T10:03:00.000Z" },
    ],
  );

  assert.deepEqual(
    merged.map((event) => event.id),
    ["server-1", "temp-1", "server-2"],
  );
});

test("mergeInboxTimelineEvents de-dupes by id", () => {
  const merged = mergeInboxTimelineEvents(
    [{ id: "same", createdAt: "2026-03-30T10:00:00.000Z" }],
    [{ id: "same", createdAt: "2026-03-30T10:00:00.000Z" }],
  );

  assert.equal(merged.length, 1);
});

test("revenue helpers format and parse dollars", () => {
  assert.equal(formatRevenueInputCents(420000), "4200");
  assert.equal(parseRevenueInputToCents("$4,200.50"), 420050);
  assert.equal(parseRevenueInputToCents(""), null);
  assert.equal(Number.isNaN(parseRevenueInputToCents("-4")), true);
});

test("datetime-local helpers round trip through ISO", () => {
  const localValue = toDateTimeLocalInputValue("2026-03-30T19:45:00.000Z");
  const isoValue = fromDateTimeLocalInputValue(localValue);

  assert.ok(localValue.includes("T"));
  assert.ok(isoValue);
  assert.equal(Number.isNaN(new Date(isoValue).getTime()), false);
});
