import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeEstimateJobLinkIntegrity,
  buildEstimateConversionJobLinkData,
  getOperationalJobPrimaryEstimateId,
  jobReferencesEstimate,
} from "../lib/estimate-job-linking.ts";

function jobRecord(overrides = {}) {
  return {
    id: "job-1",
    orgId: "org-1",
    leadId: "lead-1",
    sourceEstimateId: null,
    linkedEstimateId: null,
    sourceEstimate: null,
    linkedEstimate: null,
    ...overrides,
  };
}

test("getOperationalJobPrimaryEstimateId prefers linked estimate over source estimate", () => {
  assert.equal(
    getOperationalJobPrimaryEstimateId({
      sourceEstimateId: "estimate-source",
      linkedEstimateId: "estimate-linked",
    }),
    "estimate-linked",
  );
});

test("jobReferencesEstimate matches either source or linked estimate references", () => {
  assert.equal(
    jobReferencesEstimate(
      {
        sourceEstimateId: "estimate-source",
        linkedEstimateId: "estimate-linked",
      },
      "estimate-source",
    ),
    true,
  );
  assert.equal(
    jobReferencesEstimate(
      {
        sourceEstimateId: "estimate-source",
        linkedEstimateId: "estimate-linked",
      },
      "estimate-linked",
    ),
    true,
  );
  assert.equal(
    jobReferencesEstimate(
      {
        sourceEstimateId: "estimate-source",
        linkedEstimateId: "estimate-linked",
      },
      "estimate-other",
    ),
    false,
  );
});

test("buildEstimateConversionJobLinkData sets both source and linked estimate ids", () => {
  assert.deepEqual(buildEstimateConversionJobLinkData("estimate-1"), {
    sourceEstimateId: "estimate-1",
    linkedEstimateId: "estimate-1",
  });
});

test("analyzeEstimateJobLinkIntegrity reports one repairable issue when source and linked share the same unattached estimate", () => {
  const analysis = analyzeEstimateJobLinkIntegrity(
    jobRecord({
      sourceEstimateId: "estimate-1",
      linkedEstimateId: "estimate-1",
      sourceEstimate: {
        id: "estimate-1",
        leadId: "lead-1",
        jobId: null,
      },
      linkedEstimate: {
        id: "estimate-1",
        leadId: "lead-1",
        jobId: null,
      },
    }),
  );

  assert.deepEqual(analysis.issues, [
    {
      kind: "job_estimate_missing_attachment",
      orgId: "org-1",
      jobId: "job-1",
      jobLeadId: "lead-1",
      sourceEstimateId: "estimate-1",
      linkedEstimateId: "estimate-1",
      estimateId: "estimate-1",
      estimateLeadId: "lead-1",
      estimateJobId: null,
      estimateRole: "source_and_linked",
    },
  ]);
  assert.deepEqual(analysis.repairCandidates, [
    {
      estimateId: "estimate-1",
      estimateRole: "source_and_linked",
    },
  ]);
});

test("analyzeEstimateJobLinkIntegrity flags linked estimates attached to another job without suggesting repair", () => {
  const analysis = analyzeEstimateJobLinkIntegrity(
    jobRecord({
      linkedEstimateId: "estimate-2",
      linkedEstimate: {
        id: "estimate-2",
        leadId: "lead-1",
        jobId: "job-other",
      },
    }),
  );

  assert.deepEqual(analysis.issues, [
    {
      kind: "job_estimate_attached_elsewhere",
      orgId: "org-1",
      jobId: "job-1",
      jobLeadId: "lead-1",
      sourceEstimateId: null,
      linkedEstimateId: "estimate-2",
      estimateId: "estimate-2",
      estimateLeadId: "lead-1",
      estimateJobId: "job-other",
      estimateRole: "linked",
    },
  ]);
  assert.deepEqual(analysis.repairCandidates, []);
});
