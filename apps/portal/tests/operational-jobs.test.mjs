import assert from "node:assert/strict";
import test from "node:test";
import {
  mapBookingEventToOperationalJobState,
  selectExplicitOperationalBookingJobCandidate,
  selectReusableOperationalJobCandidate,
} from "../lib/operational-jobs.ts";

function candidate(overrides = {}) {
  return {
    id: "job-1",
    orgId: "org-1",
    leadId: "lead-1",
    customerId: null,
    sourceEstimateId: null,
    linkedEstimateId: null,
    customerName: "Taylor",
    phone: null,
    address: "",
    serviceType: "Fence",
    projectType: "Fence",
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    dispatchStatus: "SCHEDULED",
    notes: null,
    status: "SCHEDULED",
    updatedAt: new Date("2026-04-07T12:00:00.000Z"),
    ...overrides,
  };
}

test("mapBookingEventToOperationalJobState keeps estimate bookings in estimating until sold", () => {
  const mapped = mapBookingEventToOperationalJobState({
    type: "ESTIMATE",
    status: "CONFIRMED",
  });

  assert.deepEqual(mapped, {
    jobStatus: "ESTIMATING",
    dispatchStatus: "SCHEDULED",
  });
});

test("mapBookingEventToOperationalJobState keeps booking mirrors in scheduled mode", () => {
  const mapped = mapBookingEventToOperationalJobState({
    type: "JOB",
    status: "CANCELLED",
  });

  assert.deepEqual(mapped, {
    jobStatus: "SCHEDULED",
    dispatchStatus: "SCHEDULED",
  });
});

test("selectReusableOperationalJobCandidate prefers exact estimate linkage", () => {
  const selected = selectReusableOperationalJobCandidate({
    preferredEstimateId: "est-2",
    candidates: [
      candidate({ id: "job-a", sourceEstimateId: "est-1" }),
      candidate({ id: "job-b", linkedEstimateId: "est-2" }),
    ],
  });

  assert.equal(selected?.id, "job-b");
});

test("selectReusableOperationalJobCandidate falls back to the unlinked active lead job", () => {
  const selected = selectReusableOperationalJobCandidate({
    candidates: [
      candidate({ id: "job-a", sourceEstimateId: "est-1", updatedAt: new Date("2026-04-07T12:00:00.000Z") }),
      candidate({ id: "job-b", updatedAt: new Date("2026-04-07T11:00:00.000Z") }),
    ],
  });

  assert.equal(selected?.id, "job-b");
});

test("selectReusableOperationalJobCandidate returns null when multiple linked jobs are ambiguous", () => {
  const selected = selectReusableOperationalJobCandidate({
    candidates: [
      candidate({ id: "job-a", sourceEstimateId: "est-1" }),
      candidate({ id: "job-b", sourceEstimateId: "est-2" }),
    ],
  });

  assert.equal(selected, null);
});

test("selectExplicitOperationalBookingJobCandidate keeps a direct event->job link when it matches the lead", () => {
  const selected = selectExplicitOperationalBookingJobCandidate({
    eventLeadId: "lead-1",
    eventJob: candidate({ id: "job-explicit", leadId: "lead-1" }),
  });

  assert.equal(selected?.id, "job-explicit");
});

test("selectExplicitOperationalBookingJobCandidate ignores stale event->job links from another lead", () => {
  const selected = selectExplicitOperationalBookingJobCandidate({
    eventLeadId: "lead-2",
    eventJob: candidate({ id: "job-stale", leadId: "lead-1" }),
  });

  assert.equal(selected, null);
});
