import { loadPrismaEnv } from "./load-prisma-env.mjs";

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const envFile = getArgValue("--env-file");
loadPrismaEnv(envFile || undefined);

const { PrismaClient } = await import("@prisma/client");
const { activeBookingEventStatuses, bookingEventTypes } = await import(
  new URL("../lib/booking-read-model.ts", import.meta.url).href
);
const {
  buildLegacyStatusUpdateNoteBody,
  classifyLegacyJobBookingMirrorDrift,
  deriveLegacyDraftEstimateShareRepair,
  findMatchingLegacyStatusUpdateNote,
  isLegacySyntheticStatusUpdateEvent,
  isLegacySyntheticStatusUpdateEventRepairableStatus,
} = await import(new URL("../lib/state-ownership-integrity.ts", import.meta.url).href);
const { syncLeadBookingState } = await import(new URL("../lib/lead-booking.ts", import.meta.url).href);

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const SAMPLE_LIMIT = Math.max(1, Math.min(100, Number.parseInt(getArgValue("--sample-limit") || "25", 10) || 25));
const ORG_ID = getArgValue("--org-id");

type SyntheticEventIssue = {
  kind: "synthetic_status_update_event_active" | "synthetic_status_update_event_inactive";
  eventId: string;
  orgId: string;
  leadId: string;
  jobId: string | null;
  status: string;
  title: string;
  createdAt: Date;
};

type JobMirrorIssue = {
  kind:
    | "orphaned_schedule_mirror_job"
    | "job_schedule_mirror_needs_booking_link_backfill"
    | "job_execution_state_without_booking"
    | "job_execution_state_needs_booking_link_backfill";
  jobId: string;
  orgId: string;
  leadId: string | null;
  dispatchStatus: string;
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  crewOrder: number | null;
  linkedBookingEventCount: number;
  activeLeadBookingEventCount: number;
  canRepair: boolean;
};

type EstimateShareIssue = {
  kind: "draft_estimate_customer_visible_status_drift";
  estimateId: string;
  orgId: string;
  targetStatus: string;
  reason: string;
  sentAt: Date | null;
  sharedAt: Date | null;
  viewedAt: Date | null;
  approvedAt: Date | null;
  declinedAt: Date | null;
};

type CommunicationIssue = {
  kind: "communication_event_partial_linkage_repairable" | "communication_event_partial_linkage_unrepaired";
  eventId: string;
  orgId: string;
  leadId: string;
  type: string;
  contactId: string | null;
  conversationId: string | null;
  reason: string;
};

function formatSyntheticEventSample(sample: SyntheticEventIssue) {
  return [
    `eventId=${sample.eventId}`,
    `leadId=${sample.leadId}`,
    `jobId=${sample.jobId || "none"}`,
    `status=${sample.status}`,
    `title=${JSON.stringify(sample.title)}`,
    `createdAt=${sample.createdAt.toISOString()}`,
  ].join(" | ");
}

function formatJobMirrorSample(sample: JobMirrorIssue) {
  return [
    `jobId=${sample.jobId}`,
    `leadId=${sample.leadId || "none"}`,
    `dispatchStatus=${sample.dispatchStatus}`,
    `scheduledDate=${sample.scheduledDate?.toISOString() || "none"}`,
    `scheduledStartTime=${sample.scheduledStartTime || "none"}`,
    `scheduledEndTime=${sample.scheduledEndTime || "none"}`,
    `crewOrder=${sample.crewOrder == null ? "none" : String(sample.crewOrder)}`,
    `linkedBookingEvents=${sample.linkedBookingEventCount}`,
    `activeLeadBookingEvents=${sample.activeLeadBookingEventCount}`,
  ].join(" | ");
}

function formatEstimateSample(sample: EstimateShareIssue) {
  return [
    `estimateId=${sample.estimateId}`,
    `targetStatus=${sample.targetStatus}`,
    `reason=${sample.reason}`,
    `sharedAt=${sample.sharedAt?.toISOString() || "none"}`,
    `sentAt=${sample.sentAt?.toISOString() || "none"}`,
    `viewedAt=${sample.viewedAt?.toISOString() || "none"}`,
    `approvedAt=${sample.approvedAt?.toISOString() || "none"}`,
    `declinedAt=${sample.declinedAt?.toISOString() || "none"}`,
  ].join(" | ");
}

function formatCommunicationSample(sample: CommunicationIssue) {
  return [
    `eventId=${sample.eventId}`,
    `leadId=${sample.leadId}`,
    `type=${sample.type}`,
    `contactId=${sample.contactId || "none"}`,
    `conversationId=${sample.conversationId || "none"}`,
    `reason=${sample.reason}`,
  ].join(" | ");
}

function printCount(kind: string, count: number) {
  console.log(`[diagnose-state-ownership-drift] issue ${kind} count=${count}`);
}

function printSamples(prefix: string, samples: string[]) {
  for (const sample of samples.slice(0, SAMPLE_LIMIT)) {
    console.log(`[diagnose-state-ownership-drift] sample ${prefix} ${sample}`);
  }
}

async function collectSyntheticStatusEventIssues() {
  const candidates = await prisma.event.findMany({
    where: {
      ...(ORG_ID ? { orgId: ORG_ID } : {}),
      type: "JOB",
      provider: "LOCAL",
      googleEventId: null,
      googleCalendarId: null,
      title: {
        endsWith: " status update",
      },
      endAt: {
        not: null,
      },
      leadId: {
        not: null,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: LIMIT,
    select: {
      id: true,
      orgId: true,
      leadId: true,
      jobId: true,
      type: true,
      provider: true,
      status: true,
      title: true,
      googleEventId: true,
      googleCalendarId: true,
      startAt: true,
      endAt: true,
      assignedToUserId: true,
      createdByUserId: true,
      customerName: true,
      addressLine: true,
      createdAt: true,
      lead: {
        select: {
          contactName: true,
          businessName: true,
        },
      },
    },
  });

  if (candidates.length === 0) {
    return {
      issues: [] as SyntheticEventIssue[],
      repairedCount: 0,
    };
  }

  const leadIds = [...new Set(candidates.map((candidate) => candidate.leadId).filter((leadId): leadId is string => Boolean(leadId)))];
  const lowerBound = new Date(Math.min(...candidates.map((candidate) => candidate.createdAt.getTime())) - 2 * 60 * 1000);
  const upperBound = new Date(Math.max(...candidates.map((candidate) => candidate.createdAt.getTime())) + 2 * 60 * 1000);

  const notes = await prisma.leadNote.findMany({
    where: {
      ...(ORG_ID ? { orgId: ORG_ID } : {}),
      leadId: {
        in: leadIds,
      },
      createdAt: {
        gte: lowerBound,
        lte: upperBound,
      },
      body: {
        startsWith: "Job status updated to ",
      },
    },
    select: {
      leadId: true,
      createdByUserId: true,
      body: true,
      createdAt: true,
    },
  });

  const issues = candidates
    .filter((candidate) =>
      isLegacySyntheticStatusUpdateEvent({
        event: candidate,
        matchingLeadNote: findMatchingLegacyStatusUpdateNote({
          event: candidate,
          notes,
        }),
      }))
    .map((candidate) => {
      const kind: SyntheticEventIssue["kind"] = isLegacySyntheticStatusUpdateEventRepairableStatus(candidate.status)
        ? "synthetic_status_update_event_active"
        : "synthetic_status_update_event_inactive";

      return {
        kind,
        eventId: candidate.id,
        orgId: candidate.orgId,
        leadId: candidate.leadId!,
        jobId: candidate.jobId,
        status: candidate.status,
        title: candidate.title,
        createdAt: candidate.createdAt,
      } satisfies SyntheticEventIssue;
    });

  let repairedCount = 0;
  if (APPLY) {
    for (const issue of issues) {
      if (issue.kind !== "synthetic_status_update_event_active") {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const event = await tx.event.update({
          where: { id: issue.eventId },
          data: {
            status: "CANCELLED",
            jobId: null,
          },
          select: {
            id: true,
            orgId: true,
            leadId: true,
            type: true,
            status: true,
            startAt: true,
            endAt: true,
            title: true,
            customerName: true,
            addressLine: true,
            createdByUserId: true,
          },
        });

        await syncLeadBookingState(tx, {
          orgId: event.orgId,
          leadId: event.leadId,
          eventId: event.id,
          type: event.type,
          status: event.status,
          startAt: event.startAt,
          endAt: event.endAt,
          title: event.title,
          customerName: event.customerName,
          addressLine: event.addressLine,
          createdByUserId: event.createdByUserId,
        });
      });
      repairedCount += 1;
    }
  }

  return {
    issues,
    repairedCount,
  };
}

async function collectJobMirrorIssues() {
  const jobs = await prisma.job.findMany({
    where: {
      ...(ORG_ID ? { orgId: ORG_ID } : {}),
      OR: [
        { scheduledDate: { not: null } },
        { scheduledStartTime: { not: null } },
        { scheduledEndTime: { not: null } },
        { crewOrder: { not: null } },
        { dispatchStatus: { in: ["ON_THE_WAY", "ON_SITE"] } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: LIMIT,
    select: {
      id: true,
      orgId: true,
      leadId: true,
      dispatchStatus: true,
      scheduledDate: true,
      scheduledStartTime: true,
      scheduledEndTime: true,
      crewOrder: true,
      calendarEvents: {
        where: {
          type: {
            in: bookingEventTypes,
          },
        },
        select: {
          id: true,
        },
        take: 10,
      },
      lead: {
        select: {
          events: {
            where: {
              type: {
                in: bookingEventTypes,
              },
              status: {
                in: activeBookingEventStatuses,
              },
            },
            select: {
              id: true,
            },
            take: 10,
          },
        },
      },
    },
  });

  const issues = jobs.flatMap((job) => {
    const drift = classifyLegacyJobBookingMirrorDrift({
      dispatchStatus: job.dispatchStatus,
      scheduledDate: job.scheduledDate,
      scheduledStartTime: job.scheduledStartTime,
      scheduledEndTime: job.scheduledEndTime,
      crewOrder: job.crewOrder,
      linkedBookingEventCount: job.calendarEvents.length,
      activeLeadBookingEventCount: job.lead?.events.length || 0,
    });

    if (!drift) {
      return [];
    }

    return [
      {
        kind: drift.kind,
        jobId: job.id,
        orgId: job.orgId,
        leadId: job.leadId,
        dispatchStatus: job.dispatchStatus,
        scheduledDate: job.scheduledDate,
        scheduledStartTime: job.scheduledStartTime,
        scheduledEndTime: job.scheduledEndTime,
        crewOrder: job.crewOrder,
        linkedBookingEventCount: job.calendarEvents.length,
        activeLeadBookingEventCount: job.lead?.events.length || 0,
        canRepair: drift.canRepair,
      } satisfies JobMirrorIssue,
    ];
  });

  let repairedCount = 0;
  if (APPLY) {
    for (const issue of issues) {
      if (!issue.canRepair) {
        continue;
      }

      await prisma.job.update({
        where: { id: issue.jobId },
        data: {
          scheduledDate: null,
          scheduledStartTime: null,
          scheduledEndTime: null,
          crewOrder: null,
        },
      });
      repairedCount += 1;
    }
  }

  return {
    issues,
    repairedCount,
  };
}

async function collectDraftEstimateIssues() {
  const estimates = await prisma.estimate.findMany({
    where: {
      ...(ORG_ID ? { orgId: ORG_ID } : {}),
      status: "DRAFT",
      OR: [
        { sharedAt: { not: null } },
        { sentAt: { not: null } },
        { viewedAt: { not: null } },
        { customerViewedAt: { not: null } },
        { approvedAt: { not: null } },
        { declinedAt: { not: null } },
        { customerDecisionAt: { not: null } },
        { shareLinks: { some: {} } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: LIMIT,
    select: {
      id: true,
      orgId: true,
      status: true,
      sharedAt: true,
      shareExpiresAt: true,
      sentAt: true,
      viewedAt: true,
      customerViewedAt: true,
      approvedAt: true,
      declinedAt: true,
      customerDecisionAt: true,
      shareLinks: {
        orderBy: [{ createdAt: "desc" }],
        take: 10,
        select: {
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          firstViewedAt: true,
          lastViewedAt: true,
          approvedAt: true,
          declinedAt: true,
        },
      },
    },
  });

  const repairs = estimates
    .map((estimate) => ({
      estimate,
      repair: deriveLegacyDraftEstimateShareRepair(estimate),
    }))
    .filter((entry): entry is typeof entry & { repair: NonNullable<typeof entry.repair> } => Boolean(entry.repair));

  const issues = repairs.map(
    ({ estimate, repair }) =>
      ({
        kind: "draft_estimate_customer_visible_status_drift",
        estimateId: estimate.id,
        orgId: estimate.orgId,
        targetStatus: repair.targetStatus,
        reason: repair.reason,
        sentAt: estimate.sentAt,
        sharedAt: estimate.sharedAt,
        viewedAt: estimate.viewedAt || estimate.customerViewedAt,
        approvedAt: estimate.approvedAt,
        declinedAt: estimate.declinedAt,
      }) satisfies EstimateShareIssue,
  );

  let repairedCount = 0;
  if (APPLY) {
    for (const { estimate, repair } of repairs) {
      await prisma.estimate.update({
        where: { id: estimate.id },
        data: repair.data,
      });
      repairedCount += 1;
    }
  }

  return {
    issues,
    repairedCount,
  };
}

async function collectCommunicationIssues() {
  const events = await prisma.communicationEvent.findMany({
    where: {
      ...(ORG_ID ? { orgId: ORG_ID } : {}),
      leadId: {
        not: null,
      },
      OR: [{ contactId: null }, { conversationId: null }],
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: LIMIT,
    select: {
      id: true,
      orgId: true,
      leadId: true,
      type: true,
      contactId: true,
      conversationId: true,
    },
  });

  const issues: CommunicationIssue[] = [];
  let repairedCount = 0;

  for (const event of events) {
    const lead = await prisma.lead.findUnique({
      where: { id: event.leadId! },
      select: {
        id: true,
        orgId: true,
        customerId: true,
        conversationState: {
          select: {
            id: true,
          },
        },
      },
    });

    const canRepair = Boolean(lead && (event.contactId || lead.customerId));
    const reason = !lead
      ? "lead_missing"
      : !event.contactId && !lead.customerId
        ? "lead_missing_contact"
        : !event.contactId && !event.conversationId
          ? "missing_contact_and_conversation"
          : !event.contactId
            ? "missing_contact"
            : "missing_conversation";

    issues.push({
      kind: canRepair ? "communication_event_partial_linkage_repairable" : "communication_event_partial_linkage_unrepaired",
      eventId: event.id,
      orgId: event.orgId,
      leadId: event.leadId!,
      type: event.type,
      contactId: event.contactId,
      conversationId: event.conversationId,
      reason,
    });

    if (!APPLY || !canRepair) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const currentLead = await tx.lead.findUnique({
        where: { id: event.leadId! },
        select: {
          id: true,
          orgId: true,
          customerId: true,
          conversationState: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!currentLead || (!event.contactId && !currentLead.customerId)) {
        return;
      }

      const conversationId =
        event.conversationId ||
        currentLead.conversationState?.id ||
        (
          await tx.leadConversationState.upsert({
            where: {
              leadId: currentLead.id,
            },
            update: {},
            create: {
              orgId: currentLead.orgId,
              leadId: currentLead.id,
            },
            select: {
              id: true,
            },
          })
        ).id;

      await tx.communicationEvent.update({
        where: { id: event.id },
        data: {
          contactId: event.contactId || currentLead.customerId,
          conversationId,
        },
      });
      repairedCount += 1;
    });
  }

  return {
    issues,
    repairedCount,
  };
}

async function main() {
  const [syntheticEvents, jobMirrors, draftEstimates, communications] = await Promise.all([
    collectSyntheticStatusEventIssues(),
    collectJobMirrorIssues(),
    collectDraftEstimateIssues(),
    collectCommunicationIssues(),
  ]);

  console.log(
    [
      "[diagnose-state-ownership-drift]",
      `mode=${APPLY ? "apply" : "dry-run"}`,
      `org=${ORG_ID || "all"}`,
      `limit=${LIMIT}`,
    ].join(" "),
  );

  const allCounts = new Map<string, number>();
  for (const issue of [
    ...syntheticEvents.issues,
    ...jobMirrors.issues,
    ...draftEstimates.issues,
    ...communications.issues,
  ]) {
    allCounts.set(issue.kind, (allCounts.get(issue.kind) || 0) + 1);
  }

  for (const [kind, count] of [...allCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    printCount(kind, count);
  }

  printSamples(
    "synthetic_status_update_event",
    syntheticEvents.issues.map((issue) => `${issue.kind} ${formatSyntheticEventSample(issue)}`),
  );
  printSamples("job_booking_mirror", jobMirrors.issues.map((issue) => `${issue.kind} ${formatJobMirrorSample(issue)}`));
  printSamples(
    "draft_estimate_share",
    draftEstimates.issues.map((issue) => `${issue.kind} ${formatEstimateSample(issue)}`),
  );
  printSamples(
    "communication_partial_linkage",
    communications.issues.map((issue) => `${issue.kind} ${formatCommunicationSample(issue)}`),
  );

  console.log(
    [
      "[diagnose-state-ownership-drift]",
      `repairMode=${APPLY ? "apply" : "preview"}`,
      `syntheticEventsRepaired=${syntheticEvents.repairedCount}`,
      `jobMirrorsRepaired=${jobMirrors.repairedCount}`,
      `draftEstimatesRepaired=${draftEstimates.repairedCount}`,
      `communicationsRepaired=${communications.repairedCount}`,
    ].join(" "),
  );

  if (jobMirrors.issues.some((issue) => issue.kind === "job_schedule_mirror_needs_booking_link_backfill")) {
    console.log(
      "[diagnose-state-ownership-drift] note schedule mirrors with active lead bookings are not auto-cleared; run backfill:event-job-links after reviewing dry-run samples.",
    );
  }
  if (jobMirrors.issues.some((issue) => issue.kind === "job_execution_state_without_booking")) {
    console.log(
      "[diagnose-state-ownership-drift] note execution-state jobs without bookings are reported only; they need case-by-case review before any status rewrite.",
    );
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
