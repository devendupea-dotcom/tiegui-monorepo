import assert from "node:assert/strict";
import test from "node:test";
import { deriveJobBookingProjection } from "../lib/booking-read-model.ts";

test("job booking projection ignores mirror-style scheduling when no booking event exists", () => {
  const projection = deriveJobBookingProjection({
    events: [],
    timeZone: "America/Los_Angeles",
  });

  assert.equal(projection.hasBookingEvent, false);
  assert.equal(projection.hasActiveBooking, false);
  assert.equal(projection.scheduledDate, null);
  assert.equal(projection.scheduledDateKey, null);
  assert.equal(projection.scheduledStartTime, null);
  assert.equal(projection.scheduledEndTime, null);
});

test("job booking projection derives active schedule timing from booking events in org local time", () => {
  const projection = deriveJobBookingProjection({
    timeZone: "America/Los_Angeles",
    events: [
      {
        id: "event-1",
        type: "JOB",
        status: "SCHEDULED",
        startAt: new Date("2026-04-16T16:00:00.000Z"),
        endAt: new Date("2026-04-16T18:30:00.000Z"),
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        updatedAt: new Date("2026-04-15T10:00:00.000Z"),
        jobId: "job-1",
      },
    ],
  });

  assert.equal(projection.hasBookingEvent, true);
  assert.equal(projection.hasActiveBooking, true);
  assert.equal(projection.scheduledDateKey, "2026-04-16");
  assert.equal(projection.scheduledStartTime, "09:00");
  assert.equal(projection.scheduledEndTime, "11:30");
});

test("job booking projection keeps historical booking timing when only inactive booking events remain", () => {
  const projection = deriveJobBookingProjection({
    timeZone: "America/Los_Angeles",
    events: [
      {
        id: "event-1",
        type: "JOB",
        status: "COMPLETED",
        startAt: new Date("2026-04-16T16:00:00.000Z"),
        endAt: new Date("2026-04-16T18:30:00.000Z"),
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        updatedAt: new Date("2026-04-17T12:00:00.000Z"),
        jobId: "job-1",
      },
    ],
  });

  assert.equal(projection.hasBookingEvent, true);
  assert.equal(projection.hasActiveBooking, false);
  assert.equal(projection.scheduledDateKey, "2026-04-16");
  assert.equal(projection.scheduledStartTime, "09:00");
  assert.equal(projection.scheduledEndTime, "11:30");
});
