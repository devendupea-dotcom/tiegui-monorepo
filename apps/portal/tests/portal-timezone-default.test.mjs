import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTimeLocalInputValue } from "../lib/calendar/dates.ts";
import { endOfToday, startOfToday, toDateTimeLocalValue } from "../lib/hq.ts";
import { fromDateTimeLocalInputValue, toDateTimeLocalInputValue } from "../lib/inbox-ui.ts";
import { parsePreferredCallbackAt } from "../lib/intake-time.ts";

test("Pacific day boundaries do not follow the server timezone", () => {
  const now = new Date("2026-04-16T01:30:00.000Z");

  assert.equal(startOfToday(now).toISOString(), "2026-04-15T07:00:00.000Z");
  assert.equal(endOfToday(now).toISOString(), "2026-04-16T06:59:59.999Z");
});

test("datetime-local values round-trip in Pacific time", () => {
  const utc = "2026-04-16T16:30:00.000Z";

  assert.equal(toDateTimeLocalValue(new Date(utc)), "2026-04-16T09:30");
  assert.equal(formatDateTimeLocalInputValue(utc), "2026-04-16T09:30");
  assert.equal(toDateTimeLocalInputValue(utc), "2026-04-16T09:30");
  assert.equal(fromDateTimeLocalInputValue("2026-04-16T09:30"), utc);
});

test("intake callback parsing keeps relative day phrases in Pacific time", () => {
  const now = new Date("2026-04-16T01:30:00.000Z");

  assert.equal(
    parsePreferredCallbackAt("today at 9am", now, "America/Los_Angeles")?.toISOString(),
    "2026-04-16T16:00:00.000Z",
  );
  assert.equal(
    parsePreferredCallbackAt("tomorrow at 9am", now, "America/Los_Angeles")?.toISOString(),
    "2026-04-16T16:00:00.000Z",
  );
});
