import assert from "node:assert/strict";
import test from "node:test";
import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { toUtcFromLocalDateTime } from "../lib/calendar/dates.ts";
import { buildGoogleEventBody } from "../lib/integrations/google-event-body.ts";

const TZ = "America/Los_Angeles";

function expectLocalRoundTrip(date, time) {
  const utc = toUtcFromLocalDateTime({ date, time, timeZone: TZ });
  const local = formatInTimeZone(utc, TZ, "yyyy-MM-dd HH:mm");
  assert.equal(local, `${date} ${time}`);
  return utc;
}

test("spring-forward DST boundary keeps intended local time", () => {
  expectLocalRoundTrip("2026-03-08", "09:30");
});

test("fall-back DST boundary keeps intended local time", () => {
  expectLocalRoundTrip("2026-11-01", "09:30");
});

test("Google timed event payload includes timezone and preserves intended local display time", () => {
  const startAtUtc = expectLocalRoundTrip("2026-03-08", "14:00");
  const endAtUtc = addMinutes(startAtUtc, 30);
  const payload = buildGoogleEventBody({
    summary: "DST test",
    startAtUtc,
    endAtUtc,
    allDay: false,
    timeZone: TZ,
  });

  assert.equal(payload.start.timeZone, TZ);
  assert.equal(payload.end.timeZone, TZ);
  assert.equal(formatInTimeZone(new Date(payload.start.dateTime), TZ, "yyyy-MM-dd HH:mm"), "2026-03-08 14:00");
  assert.equal(formatInTimeZone(new Date(payload.end.dateTime), TZ, "yyyy-MM-dd HH:mm"), "2026-03-08 14:30");
});

test("Google all-day payload includes timezone and stable dates across DST", () => {
  const startAtUtc = toUtcFromLocalDateTime({ date: "2026-11-01", time: "00:00", timeZone: TZ });
  const endAtUtc = toUtcFromLocalDateTime({ date: "2026-11-02", time: "00:00", timeZone: TZ });
  const payload = buildGoogleEventBody({
    summary: "All-day DST test",
    startAtUtc,
    endAtUtc,
    allDay: true,
    timeZone: TZ,
  });

  assert.equal(payload.start.timeZone, TZ);
  assert.equal(payload.end.timeZone, TZ);
  assert.equal(payload.start.date, "2026-11-01");
  assert.equal(payload.end.date, "2026-11-02");
});
