import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const operationalIntegrityJobSelect = {
  id: true,
  orgId: true,
  leadId: true,
  sourceEstimateId: true,
  linkedEstimateId: true,
  sourceEstimate: {
    select: {
      id: true,
      leadId: true,
    },
  },
  linkedEstimate: {
    select: {
      id: true,
      leadId: true,
    },
  },
  calendarEvents: {
    select: {
      id: true,
      leadId: true,
      type: true,
      status: true,
    },
  },
  estimates: {
    select: {
      id: true,
      leadId: true,
    },
  },
} satisfies Prisma.JobSelect;

export type OperationalIntegrityJobRecord = Prisma.JobGetPayload<{
  select: typeof operationalIntegrityJobSelect;
}>;

export type OperationalIntegrityIssueKind =
  | "job_missing_lead_repairable"
  | "job_missing_lead_ambiguous"
  | "job_lead_mismatch"
  | "job_estimate_lead_conflict"
  | "estimate_job_lead_mismatch"
  | "event_missing_lead_from_job"
  | "event_lead_job_mismatch";

type JobLeadCandidateSource = "source_estimate" | "linked_estimate" | "calendar_event" | "attached_estimate";

export type JobLeadCandidate = {
  leadId: string;
  source: JobLeadCandidateSource;
  refId: string;
};

export type ConservativeJobLeadRepair = {
  leadId: string | null;
  reason: "consistent" | "ambiguous" | "none";
  inferredLeadIds: string[];
  candidateSources: string[];
};

export type OperationalIntegrityIssue = {
  kind: OperationalIntegrityIssueKind;
  orgId: string;
  jobId: string;
  currentLeadId: string | null;
  inferredLeadIds: string[];
  candidateSources: string[];
  sourceEstimateId: string | null;
  linkedEstimateId: string | null;
  estimateId?: string | null;
  eventId?: string | null;
};

export type OperationalIntegrityDiagnostics = {
  scannedJobs: number;
  repairableJobs: number;
  countsByKind: Array<{
    kind: OperationalIntegrityIssueKind;
    count: number;
  }>;
  samples: OperationalIntegrityIssue[];
};

export type OperationalIntegrityRepairResult = {
  scannedJobs: number;
  repairableJobs: number;
  repairedJobs: number;
  samples: Array<{
    jobId: string;
    leadId: string;
    candidateSources: string[];
  }>;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function uniqueCandidateSources(candidates: JobLeadCandidate[]): string[] {
  return [
    ...new Set(
      candidates
        .map((candidate) => `${candidate.source}:${candidate.refId}`)
        .filter((value) => value.trim().length > 0),
    ),
  ];
}

export function collectOperationalJobLeadCandidates(job: OperationalIntegrityJobRecord): JobLeadCandidate[] {
  const candidates: JobLeadCandidate[] = [];

  if (job.sourceEstimate?.leadId) {
    candidates.push({
      leadId: job.sourceEstimate.leadId,
      source: "source_estimate",
      refId: job.sourceEstimate.id,
    });
  }

  if (job.linkedEstimate?.leadId) {
    candidates.push({
      leadId: job.linkedEstimate.leadId,
      source: "linked_estimate",
      refId: job.linkedEstimate.id,
    });
  }

  for (const event of job.calendarEvents) {
    if (!event.leadId) continue;
    candidates.push({
      leadId: event.leadId,
      source: "calendar_event",
      refId: event.id,
    });
  }

  for (const estimate of job.estimates) {
    if (!estimate.leadId) continue;
    candidates.push({
      leadId: estimate.leadId,
      source: "attached_estimate",
      refId: estimate.id,
    });
  }

  return candidates;
}

export function resolveConservativeJobLeadRepair(job: OperationalIntegrityJobRecord): ConservativeJobLeadRepair {
  const candidates = collectOperationalJobLeadCandidates(job);
  const inferredLeadIds = uniqueStrings(candidates.map((candidate) => candidate.leadId));
  const candidateSources = uniqueCandidateSources(candidates);

  if (inferredLeadIds.length === 1) {
    return {
      leadId: inferredLeadIds[0] || null,
      reason: "consistent",
      inferredLeadIds,
      candidateSources,
    };
  }

  if (inferredLeadIds.length > 1) {
    return {
      leadId: null,
      reason: "ambiguous",
      inferredLeadIds,
      candidateSources,
    };
  }

  return {
    leadId: null,
    reason: "none",
    inferredLeadIds: [],
    candidateSources,
  };
}

export function analyzeOperationalJobIntegrity(job: OperationalIntegrityJobRecord): {
  issues: OperationalIntegrityIssue[];
  repair: ConservativeJobLeadRepair;
} {
  const repair = resolveConservativeJobLeadRepair(job);
  const issues: OperationalIntegrityIssue[] = [];

  const baseIssue = {
    orgId: job.orgId,
    jobId: job.id,
    currentLeadId: job.leadId,
    inferredLeadIds: repair.inferredLeadIds,
    candidateSources: repair.candidateSources,
    sourceEstimateId: job.sourceEstimateId,
    linkedEstimateId: job.linkedEstimateId,
  };

  if (
    job.sourceEstimate?.leadId
    && job.linkedEstimate?.leadId
    && job.sourceEstimate.leadId !== job.linkedEstimate.leadId
  ) {
    issues.push({
      ...baseIssue,
      kind: "job_estimate_lead_conflict",
    });
  }

  if (!job.leadId && repair.leadId) {
    issues.push({
      ...baseIssue,
      kind: "job_missing_lead_repairable",
    });
  } else if (!job.leadId && repair.reason === "ambiguous") {
    issues.push({
      ...baseIssue,
      kind: "job_missing_lead_ambiguous",
    });
  } else if (job.leadId && repair.inferredLeadIds.some((leadId) => leadId !== job.leadId)) {
    issues.push({
      ...baseIssue,
      kind: "job_lead_mismatch",
    });
  }

  if (job.leadId) {
    for (const event of job.calendarEvents) {
      if (!event.leadId) {
        issues.push({
          ...baseIssue,
          kind: "event_missing_lead_from_job",
          eventId: event.id,
        });
        continue;
      }

      if (event.leadId !== job.leadId) {
        issues.push({
          ...baseIssue,
          kind: "event_lead_job_mismatch",
          eventId: event.id,
        });
      }
    }

    for (const estimate of job.estimates) {
      if (!estimate.leadId || estimate.leadId === job.leadId) {
        continue;
      }

      issues.push({
        ...baseIssue,
        kind: "estimate_job_lead_mismatch",
        estimateId: estimate.id,
      });
    }
  }

  return {
    issues,
    repair,
  };
}

async function scanOperationalIntegrityJobs(input: {
  orgId?: string | null;
  limit: number;
  onJob: (job: OperationalIntegrityJobRecord) => Promise<void> | void;
}) {
  let cursor: string | null = null;
  let scannedJobs = 0;
  const batchSize = 100;

  while (scannedJobs < input.limit) {
    const remaining = input.limit - scannedJobs;
    const rows: OperationalIntegrityJobRecord[] = await prisma.job.findMany({
      where: {
        ...(input.orgId ? { orgId: input.orgId } : {}),
      },
      orderBy: [{ id: "asc" }],
      take: Math.min(batchSize, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: operationalIntegrityJobSelect,
    });

    if (rows.length === 0) {
      break;
    }

    cursor = rows[rows.length - 1]?.id || null;

    for (const row of rows) {
      scannedJobs += 1;
      await input.onJob(row);
    }
  }

  return {
    scannedJobs,
  };
}

export async function getOperationalIntegrityDiagnostics(input: {
  orgId?: string | null;
  limit?: number;
  sampleLimit?: number;
}): Promise<OperationalIntegrityDiagnostics> {
  const limit = Math.max(1, Math.min(5000, input.limit || 500));
  const sampleLimit = Math.max(1, Math.min(100, input.sampleLimit || 25));
  const counts = new Map<OperationalIntegrityIssueKind, number>();
  const samples: OperationalIntegrityIssue[] = [];
  let repairableJobs = 0;

  const { scannedJobs } = await scanOperationalIntegrityJobs({
    orgId: input.orgId || null,
    limit,
    onJob(job) {
      const analysis = analyzeOperationalJobIntegrity(job);

      if (!job.leadId && analysis.repair.leadId) {
        repairableJobs += 1;
      }

      for (const issue of analysis.issues) {
        counts.set(issue.kind, (counts.get(issue.kind) || 0) + 1);
        if (samples.length < sampleLimit) {
          samples.push(issue);
        }
      }
    },
  });

  return {
    scannedJobs,
    repairableJobs,
    countsByKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    samples,
  };
}

export async function repairConservativeJobLeadLinks(input: {
  orgId?: string | null;
  limit?: number;
  apply?: boolean;
  sampleLimit?: number;
}): Promise<OperationalIntegrityRepairResult> {
  const limit = Math.max(1, Math.min(5000, input.limit || 500));
  const sampleLimit = Math.max(1, Math.min(100, input.sampleLimit || 25));
  const apply = input.apply === true;
  let repairableJobs = 0;
  let repairedJobs = 0;
  const samples: Array<{ jobId: string; leadId: string; candidateSources: string[] }> = [];

  const { scannedJobs } = await scanOperationalIntegrityJobs({
    orgId: input.orgId || null,
    limit,
    async onJob(job) {
      if (job.leadId) {
        return;
      }

      const repair = resolveConservativeJobLeadRepair(job);
      if (!repair.leadId) {
        return;
      }

      repairableJobs += 1;
      if (samples.length < sampleLimit) {
        samples.push({
          jobId: job.id,
          leadId: repair.leadId,
          candidateSources: repair.candidateSources,
        });
      }

      if (!apply) {
        return;
      }

      const updated = await prisma.job.updateMany({
        where: {
          id: job.id,
          orgId: job.orgId,
          leadId: null,
        },
        data: {
          leadId: repair.leadId,
        },
      });

      if (updated.count === 1) {
        repairedJobs += 1;
      }
    },
  });

  return {
    scannedJobs,
    repairableJobs,
    repairedJobs,
    samples,
  };
}
