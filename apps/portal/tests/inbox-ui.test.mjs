import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInboxHistoryUrl,
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

test("inbox history URL switches between list and thread without losing mobile/internal scope", () => {
  const threadUrl = buildInboxHistoryUrl({
    pathname: "/app/inbox",
    search: "?mobile=1&orgId=stale&leadId=old&context=edit",
    orgId: "org_1",
    internalUser: true,
    leadId: "lead_1",
  });

  assert.equal(threadUrl, "/app/inbox?mobile=1&orgId=org_1&leadId=lead_1");

  const listUrl = buildInboxHistoryUrl({
    pathname: "/app/inbox",
    search: "?mobile=1&orgId=org_1&leadId=lead_1&context=edit",
    orgId: "org_1",
    internalUser: true,
    leadId: null,
  });

  assert.equal(listUrl, "/app/inbox?mobile=1&orgId=org_1");
});
