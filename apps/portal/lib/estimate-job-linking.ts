import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Estimate/job semantics:
// - Estimate.leadId is CRM context
// - Estimate.jobId is operational attachment
// - Job.sourceEstimateId is the originating estimate for job lineage
// - Job.linkedEstimateId is the active operational estimate reference when one estimate is needed

type OperationalJobEstimateRef = {
  sourceEstimateId: string | null;
  linkedEstimateId: string | null;
};

export function getOperationalJobPrimaryEstimateId(input: OperationalJobEstimateRef): string | null {
  return input.linkedEstimateId || input.sourceEstimateId || null;
}

export function jobReferencesEstimate(input: OperationalJobEstimateRef, estimateId: string | null | undefined): boolean {
  if (!estimateId) {
    return false;
  }
  return input.sourceEstimateId === estimateId || input.linkedEstimateId === estimateId;
}

export function buildEstimateConversionJobLinkData(estimateId: string) {
  return {
    sourceEstimateId: estimateId,
    linkedEstimateId: estimateId,
  };
}

export function buildOperationalJobLinkedEstimateData(linkedEstimateId: string | null) {
  return {
    linkedEstimateId,
  };
}

export function buildEstimateAttachmentData(jobId: string | null) {
  return {
    jobId,
  };
}

export const estimateJobLinkIntegrityJobSelect = {
  id: true,
  orgId: true,
  leadId: true,
  sourceEstimateId: true,
  linkedEstimateId: true,
  sourceEstimate: {
    select: {
      id: true,
      leadId: true,
      jobId: true,
    },
  },
  linkedEstimate: {
    select: {
      id: true,
      leadId: true,
      jobId: true,
    },
  },
} satisfies Prisma.JobSelect;

export type EstimateJobLinkIntegrityJobRecord = Prisma.JobGetPayload<{
  select: typeof estimateJobLinkIntegrityJobSelect;
}>;

export type EstimateJobLinkRole = "source" | "linked" | "source_and_linked";

export type EstimateJobLinkIntegrityIssueKind =
  | "job_estimate_missing_attachment"
  | "job_estimate_attached_elsewhere";

export type EstimateJobLinkIntegrityIssue = {
  kind: EstimateJobLinkIntegrityIssueKind;
  orgId: string;
  jobId: string;
  jobLeadId: string | null;
  sourceEstimateId: string | null;
  linkedEstimateId: string | null;
  estimateId: string;
  estimateLeadId: string | null;
  estimateJobId: string | null;
  estimateRole: EstimateJobLinkRole;
};

export type EstimateJobLinkRepairCandidate = {
  estimateId: string;
  estimateRole: EstimateJobLinkRole;
};

export type EstimateJobLinkIntegrityAnalysis = {
  issues: EstimateJobLinkIntegrityIssue[];
  repairCandidates: EstimateJobLinkRepairCandidate[];
};

export type EstimateJobLinkIntegrityDiagnostics = {
  scannedJobs: number;
  repairableJobs: number;
  countsByKind: Array<{
    kind: EstimateJobLinkIntegrityIssueKind;
    count: number;
  }>;
  samples: EstimateJobLinkIntegrityIssue[];
};

export type EstimateJobLinkRepairResult = {
  scannedJobs: number;
  repairableJobs: number;
  repairedLinks: number;
  samples: Array<{
    jobId: string;
    estimateId: string;
    estimateRole: EstimateJobLinkRole;
  }>;
};

type JobEstimateLinkRecord = {
  id: string;
  leadId: string | null;
  jobId: string | null;
  role: EstimateJobLinkRole;
};

function resolveEstimateLinkRole(hasSource: boolean, hasLinked: boolean): EstimateJobLinkRole {
  if (hasSource && hasLinked) {
    return "source_and_linked";
  }
  return hasSource ? "source" : "linked";
}

function collectDirectJobEstimates(job: EstimateJobLinkIntegrityJobRecord): JobEstimateLinkRecord[] {
  const estimatesById = new Map<string, JobEstimateLinkRecord>();

  if (job.sourceEstimate) {
    estimatesById.set(job.sourceEstimate.id, {
      id: job.sourceEstimate.id,
      leadId: job.sourceEstimate.leadId,
      jobId: job.sourceEstimate.jobId,
      role: resolveEstimateLinkRole(true, job.linkedEstimate?.id === job.sourceEstimate.id),
    });
  }

  if (job.linkedEstimate) {
    const existing = estimatesById.get(job.linkedEstimate.id);
    if (existing) {
      existing.role = "source_and_linked";
    } else {
      estimatesById.set(job.linkedEstimate.id, {
        id: job.linkedEstimate.id,
        leadId: job.linkedEstimate.leadId,
        jobId: job.linkedEstimate.jobId,
        role: "linked",
      });
    }
  }

  return [...estimatesById.values()];
}

export function analyzeEstimateJobLinkIntegrity(job: EstimateJobLinkIntegrityJobRecord): EstimateJobLinkIntegrityAnalysis {
  const issues: EstimateJobLinkIntegrityIssue[] = [];
  const repairCandidates: EstimateJobLinkRepairCandidate[] = [];

  for (const estimate of collectDirectJobEstimates(job)) {
    const baseIssue = {
      orgId: job.orgId,
      jobId: job.id,
      jobLeadId: job.leadId,
      sourceEstimateId: job.sourceEstimateId,
      linkedEstimateId: job.linkedEstimateId,
      estimateId: estimate.id,
      estimateLeadId: estimate.leadId,
      estimateJobId: estimate.jobId,
      estimateRole: estimate.role,
    };

    if (!estimate.jobId) {
      issues.push({
        ...baseIssue,
        kind: "job_estimate_missing_attachment",
      });
      repairCandidates.push({
        estimateId: estimate.id,
        estimateRole: estimate.role,
      });
      continue;
    }

    if (estimate.jobId !== job.id) {
      issues.push({
        ...baseIssue,
        kind: "job_estimate_attached_elsewhere",
      });
    }
  }

  return {
    issues,
    repairCandidates,
  };
}

export async function getEstimateJobLinkIntegrityDiagnostics(input?: {
  orgId?: string | null;
  limit?: number;
  sampleLimit?: number;
}): Promise<EstimateJobLinkIntegrityDiagnostics> {
  const limit = Math.max(1, Math.min(5000, input?.limit ?? 500));
  const sampleLimit = Math.max(1, Math.min(100, input?.sampleLimit ?? 25));

  const jobs = await prisma.job.findMany({
    where: {
      ...(input?.orgId ? { orgId: input.orgId } : {}),
      OR: [
        { sourceEstimateId: { not: null } },
        { linkedEstimateId: { not: null } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: estimateJobLinkIntegrityJobSelect,
  });

  const counts = new Map<EstimateJobLinkIntegrityIssueKind, number>();
  const samples: EstimateJobLinkIntegrityIssue[] = [];
  let repairableJobs = 0;

  for (const job of jobs) {
    const analysis = analyzeEstimateJobLinkIntegrity(job);
    if (analysis.repairCandidates.length > 0) {
      repairableJobs += 1;
    }

    for (const issue of analysis.issues) {
      counts.set(issue.kind, (counts.get(issue.kind) || 0) + 1);
      if (samples.length < sampleLimit) {
        samples.push(issue);
      }
    }
  }

  return {
    scannedJobs: jobs.length,
    repairableJobs,
    countsByKind: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
    samples,
  };
}

export async function repairConservativeEstimateJobLinks(input?: {
  orgId?: string | null;
  limit?: number;
  sampleLimit?: number;
  apply?: boolean;
}): Promise<EstimateJobLinkRepairResult> {
  const limit = Math.max(1, Math.min(5000, input?.limit ?? 500));
  const sampleLimit = Math.max(1, Math.min(100, input?.sampleLimit ?? 25));
  const apply = input?.apply === true;

  const jobs = await prisma.job.findMany({
    where: {
      ...(input?.orgId ? { orgId: input.orgId } : {}),
      OR: [
        { sourceEstimateId: { not: null } },
        { linkedEstimateId: { not: null } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: estimateJobLinkIntegrityJobSelect,
  });

  let repairableJobs = 0;
  let repairedLinks = 0;
  const samples: Array<{
    jobId: string;
    estimateId: string;
    estimateRole: EstimateJobLinkRole;
  }> = [];

  for (const job of jobs) {
    const analysis = analyzeEstimateJobLinkIntegrity(job);
    if (analysis.repairCandidates.length === 0) {
      continue;
    }

    repairableJobs += 1;

    for (const candidate of analysis.repairCandidates) {
      if (samples.length < sampleLimit) {
        samples.push({
          jobId: job.id,
          estimateId: candidate.estimateId,
          estimateRole: candidate.estimateRole,
        });
      }

      if (!apply) {
        continue;
      }

      const updated = await prisma.estimate.updateMany({
        where: {
          id: candidate.estimateId,
          orgId: job.orgId,
          jobId: null,
        },
        data: buildEstimateAttachmentData(job.id),
      });
      repairedLinks += updated.count;
    }
  }

  return {
    scannedJobs: jobs.length,
    repairableJobs,
    repairedLinks,
    samples,
  };
}
