import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeOperationalJobIntegrity,
  resolveConservativeJobLeadRepair,
} from "../lib/operational-integrity.ts";

function jobRecord(overrides = {}) {
  return {
    id: "job-1",
    orgId: "org-1",
    leadId: null,
    sourceEstimateId: null,
    linkedEstimateId: null,
    sourceEstimate: null,
    linkedEstimate: null,
    calendarEvents: [],
    estimates: [],
    ...overrides,
  };
}

test("resolveConservativeJobLeadRepair returns one safe lead when all candidates agree", () => {
  const repair = resolveConservativeJobLeadRepair(
    jobRecord({
      sourceEstimateId: "est-1",
      sourceEstimate: { id: "est-1", leadId: "lead-1" },
      calendarEvents: [{ id: "event-1", leadId: "lead-1", type: "JOB", status: "SCHEDULED" }],
      estimates: [{ id: "est-2", leadId: "lead-1" }],
    }),
  );

  assert.deepEqual(repair, {
    leadId: "lead-1",
    reason: "consistent",
    inferredLeadIds: ["lead-1"],
    candidateSources: ["source_estimate:est-1", "calendar_event:event-1", "attached_estimate:est-2"],
  });
});

test("resolveConservativeJobLeadRepair stays ambiguous when candidate leads disagree", () => {
  const repair = resolveConservativeJobLeadRepair(
    jobRecord({
      sourceEstimate: { id: "est-1", leadId: "lead-1" },
      linkedEstimate: { id: "est-2", leadId: "lead-2" },
    }),
  );

  assert.equal(repair.leadId, null);
  assert.equal(repair.reason, "ambiguous");
  assert.deepEqual(repair.inferredLeadIds, ["lead-1", "lead-2"]);
});

test("analyzeOperationalJobIntegrity flags repairable missing lead and downstream mismatches separately", () => {
  const analysis = analyzeOperationalJobIntegrity(
    jobRecord({
      leadId: "lead-1",
      sourceEstimateId: "est-1",
      sourceEstimate: { id: "est-1", leadId: "lead-1" },
      calendarEvents: [
        { id: "event-1", leadId: null, type: "JOB", status: "SCHEDULED" },
        { id: "event-2", leadId: "lead-2", type: "JOB", status: "SCHEDULED" },
      ],
      estimates: [{ id: "est-3", leadId: "lead-2" }],
    }),
  );

  assert.deepEqual(
    analysis.issues.map((issue) => issue.kind).sort(),
    ["estimate_job_lead_mismatch", "event_lead_job_mismatch", "event_missing_lead_from_job", "job_lead_mismatch"],
  );
});

test("analyzeOperationalJobIntegrity flags repairable missing lead when one consistent candidate exists", () => {
  const analysis = analyzeOperationalJobIntegrity(
    jobRecord({
      sourceEstimate: { id: "est-1", leadId: "lead-1" },
    }),
  );

  assert.deepEqual(analysis.issues.map((issue) => issue.kind), ["job_missing_lead_repairable"]);
  assert.equal(analysis.repair.leadId, "lead-1");
});
