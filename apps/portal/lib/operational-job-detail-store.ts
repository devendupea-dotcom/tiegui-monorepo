import "server-only";

import { Prisma } from "@prisma/client";
import { deriveJobBookingProjection, type JobBookingProjection, bookingEventTypes } from "@/lib/booking-read-model";
import {
  getDispatchCustomerCommunicationState,
  type DispatchCustomerCommunicationState,
} from "@/lib/dispatch-notifications";
import { getOperationalJobTimeline } from "@/lib/job-tracking-store";
import { prisma } from "@/lib/prisma";

const operationalJobEstimateSelect = {
  id: true,
  leadId: true,
  estimateNumber: true,
  title: true,
  status: true,
  total: true,
  updatedAt: true,
} satisfies Prisma.EstimateSelect;

const operationalJobInvoiceSelect = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  amountPaid: true,
  balanceDue: true,
  issueDate: true,
  dueDate: true,
} satisfies Prisma.InvoiceSelect;

const operationalJobDetailInclude = {
  calendarEvents: {
    where: {
      type: {
        in: bookingEventTypes,
      },
    },
    select: {
      id: true,
      type: true,
      status: true,
      startAt: true,
      endAt: true,
      createdAt: true,
      updatedAt: true,
      jobId: true,
    },
    orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    take: 12,
  },
  customer: {
    select: {
      id: true,
      name: true,
      phoneE164: true,
      email: true,
      addressLine: true,
    },
  },
  lead: {
    select: {
      id: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      city: true,
      businessType: true,
      intakeLocationText: true,
      notes: true,
    },
  },
  assignedCrew: {
    select: {
      id: true,
      name: true,
    },
  },
  sourceEstimate: {
    select: operationalJobEstimateSelect,
  },
  linkedEstimate: {
    select: operationalJobEstimateSelect,
  },
  estimates: {
    select: operationalJobEstimateSelect,
    orderBy: [{ updatedAt: "desc" }],
    take: 8,
  },
  sourceInvoices: {
    select: operationalJobInvoiceSelect,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 8,
  },
  trackingLinks: {
    select: {
      id: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 2,
  },
} satisfies Prisma.JobInclude;

type OperationalJobDetailRecord = Prisma.JobGetPayload<{
  include: typeof operationalJobDetailInclude;
}>;

export type OperationalJobLinkedEstimate = {
  id: string;
  leadId: string | null;
  estimateNumber: string;
  title: string;
  status: string;
  total: Prisma.Decimal;
  updatedAt: Date;
};

export type OperationalJobPageData = {
  job: OperationalJobDetailRecord;
  linkedEstimates: OperationalJobLinkedEstimate[];
  bookingProjection: JobBookingProjection<
    OperationalJobDetailRecord["calendarEvents"][number]
  >;
  timeline: Awaited<ReturnType<typeof getOperationalJobTimeline>>;
  trackingSummary: {
    hasActive: boolean;
    latestCreatedAt: Date | null;
  };
  dispatchCommunicationState: DispatchCustomerCommunicationState;
};

function collectLinkedEstimates(job: OperationalJobDetailRecord): OperationalJobLinkedEstimate[] {
  const ordered = [job.linkedEstimate, job.sourceEstimate, ...job.estimates].filter(
    (estimate): estimate is NonNullable<typeof estimate> => Boolean(estimate),
  );

  const unique = new Map<string, OperationalJobLinkedEstimate>();
  for (const estimate of ordered) {
    if (unique.has(estimate.id)) {
      continue;
    }
    unique.set(estimate.id, {
      id: estimate.id,
      leadId: estimate.leadId,
      estimateNumber: estimate.estimateNumber,
      title: estimate.title,
      status: estimate.status,
      total: estimate.total,
      updatedAt: estimate.updatedAt,
    });
  }

  return [...unique.values()];
}

export async function getOperationalJobPageData(input: {
  orgId: string;
  jobId: string;
}): Promise<OperationalJobPageData | null> {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    include: operationalJobDetailInclude,
  });

  if (!job) {
    return null;
  }

  const linkedEstimates = collectLinkedEstimates(job);
  const fallbackLeadId = linkedEstimates.find((estimate) => estimate.leadId)?.leadId || null;
  const config = await prisma.orgDashboardConfig.findUnique({
    where: {
      orgId: input.orgId,
    },
    select: {
      calendarTimezone: true,
    },
  });
  const bookingProjection = deriveJobBookingProjection({
    events: job.calendarEvents,
    timeZone: config?.calendarTimezone || null,
  });

  const [timeline, dispatchCommunicationState] = await Promise.all([
    getOperationalJobTimeline({
      job: {
        id: job.id,
        orgId: job.orgId,
        customerId: job.customerId,
        leadId: job.leadId || fallbackLeadId,
        scheduledDate: bookingProjection.scheduledDate,
        scheduledStartTime: bookingProjection.scheduledStartTime,
        scheduledEndTime: bookingProjection.scheduledEndTime,
      },
      limit: 16,
    }),
    getDispatchCustomerCommunicationState({
      orgId: input.orgId,
      jobId: job.id,
    }),
  ]);

  return {
    job,
    linkedEstimates,
    bookingProjection,
    timeline,
    trackingSummary: {
      hasActive: job.trackingLinks.some((link) => !link.revokedAt),
      latestCreatedAt: job.trackingLinks[0]?.createdAt || null,
    },
    dispatchCommunicationState,
  };
}
