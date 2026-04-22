import "server-only";

import { Prisma, type JobEventType } from "@prisma/client";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  ensureTimeZone,
  moveUtcDatePreservingLocalTime,
  toUtcFromLocalDateTime,
  zonedDateString,
  zonedTimeString,
} from "@/lib/calendar/dates";
import {
  activeBookingEventStatuses,
  bookingEventTypes,
  deriveJobBookingProjection,
  isActiveBookingEventStatus,
} from "@/lib/booking-read-model";
import { maybeSendDispatchCustomerNotifications, type DispatchPersistedJobEvent } from "@/lib/dispatch-notifications";
import {
  buildOperationalJobEstimateLinkData,
  buildEstimateAttachmentData,
  getOperationalJobPrimaryEstimateId,
} from "@/lib/estimate-job-linking";
import {
  buildDayRange,
  buildMergedDispatchPayload,
  createDispatchEventMetadataBase,
  createJobUpdatedMetadata,
  normalizeCrewName,
  normalizeDispatchJobPayload,
  normalizeOptionalBoolean,
  resolveTodayDateKey,
  serializeDispatchEstimate,
  serializeDispatchJobWithSchedule,
  type DispatchJobPayload,
  type DispatchScheduleProjection,
} from "@/lib/dispatch-store-core";
import { AppApiError } from "@/lib/app-api-error";
import { syncLeadBookingState } from "@/lib/lead-booking";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import {
  compareDispatchJobs,
  DEFAULT_DISPATCH_CREW_NAMES,
  dispatchStatusFromDb,
  dispatchStatusToDb,
  formatDispatchDateKey,
  formatDispatchStatusLabel,
  type DispatchCommunicationItem,
  type DispatchCrewManagementItem,
  type DispatchCrewSummary,
  type DispatchDaySnapshot,
  type DispatchJobDetail,
  type DispatchJobSummary,
} from "@/lib/dispatch";

type DispatchDbClient = Prisma.TransactionClient | typeof prisma;

type DispatchReorderPayload = {
  crewId: string | null;
  jobIds: string[];
}[];

type JobEventInput = {
  eventType: JobEventType;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

const dispatchJobBaseSelect = {
  id: true,
  customerId: true,
  leadId: true,
  customerName: true,
  phone: true,
  serviceType: true,
  address: true,
  scheduledDate: true,
  scheduledStartTime: true,
  scheduledEndTime: true,
  dispatchStatus: true,
  assignedCrewId: true,
  crewOrder: true,
  priority: true,
  notes: true,
  linkedEstimateId: true,
  sourceEstimateId: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
    },
  },
  lead: {
    select: {
      id: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
    },
  },
  assignedCrew: {
    select: {
      id: true,
      name: true,
    },
  },
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
} satisfies Prisma.JobSelect;

const dispatchJobDetailSelect = {
  ...dispatchJobBaseSelect,
  linkedEstimate: {
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      leadId: true,
    },
  },
  sourceEstimate: {
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      leadId: true,
    },
  },
} satisfies Prisma.JobSelect;

async function findLinkedBookingEvent(input: {
  tx: Prisma.TransactionClient;
  orgId: string;
  jobId: string;
  leadId?: string | null;
}) {
  const direct = await input.tx.event.findFirst({
    where: {
      orgId: input.orgId,
      jobId: input.jobId,
      type: {
        in: bookingEventTypes,
      },
      status: {
        in: activeBookingEventStatuses,
      },
    },
    orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      orgId: true,
      leadId: true,
      jobId: true,
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
  if (direct) {
    return direct;
  }

  if (!input.leadId) {
    return null;
  }

  return input.tx.event.findFirst({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      jobId: null,
      type: {
        in: bookingEventTypes,
      },
      status: {
        in: activeBookingEventStatuses,
      },
    },
    orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      orgId: true,
      leadId: true,
      jobId: true,
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
}

function requiresLinkedBookingForExecution(status: string) {
  return status === "on_the_way" || status === "on_site" || status === "completed";
}

function mapDispatchStatusToEventStatus(status: string) {
  switch (status) {
    case "completed":
      return "COMPLETED" as const;
    case "canceled":
      return "CANCELLED" as const;
    case "scheduled":
    case "rescheduled":
      return "SCHEDULED" as const;
    default:
      return null;
  }
}

function buildUnscheduledJobMirror(input: {
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  crewOrder: number | null;
}) {
  return {
    scheduledDate: input.scheduledDate,
    scheduledStartTime: input.scheduledStartTime,
    scheduledEndTime: input.scheduledEndTime,
    crewOrder: input.crewOrder,
  };
}

async function resolveDispatchCalendarTimeZone(tx: Prisma.TransactionClient, orgId: string) {
  const config = await tx.orgDashboardConfig.findUnique({
    where: { orgId },
    select: {
      calendarTimezone: true,
    },
  });
  return ensureTimeZone(config?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE);
}

async function writeJobEvents(input: {
  tx: Prisma.TransactionClient;
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  events: JobEventInput[];
}): Promise<DispatchPersistedJobEvent[]> {
  const created: DispatchPersistedJobEvent[] = [];
  for (const event of input.events) {
    const row = await input.tx.jobEvent.create({
      data: {
        orgId: input.orgId,
        jobId: input.jobId,
        actorUserId: input.actorUserId,
        eventType: event.eventType,
        fromValue: event.fromValue ?? null,
        toValue: event.toValue ?? null,
        metadata: event.metadata ?? undefined,
      },
      select: {
        id: true,
        eventType: true,
        fromValue: true,
        toValue: true,
        createdAt: true,
      },
    });
    created.push(row);
  }
  return created;
}

async function ensureDispatchCrewsForOrgWithClient(
  orgId: string,
  tx: DispatchDbClient,
): Promise<
  {
    id: string;
    name: string;
    active: boolean;
  }[]
> {
  const existing = await tx.crew.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      active: true,
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });

  if (existing.length === 0) {
    for (const name of DEFAULT_DISPATCH_CREW_NAMES) {
      try {
        await tx.crew.create({
          data: {
            orgId,
            name,
            active: true,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }
  }

  return tx.crew.findMany({
    where: {
      orgId,
    },
    select: {
      id: true,
      name: true,
      active: true,
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
}

async function getCrewMapForOrg(input: {
  orgId: string;
  tx: DispatchDbClient;
}): Promise<Map<string, { id: string; name: string; active: boolean }>> {
  const crews = await ensureDispatchCrewsForOrgWithClient(input.orgId, input.tx);
  return new Map(crews.map((crew) => [crew.id, crew] as const));
}

async function assertCrewBelongsToOrg(input: {
  orgId: string;
  crewId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.crewId) return null;

  const crew = await input.tx.crew.findFirst({
    where: {
      id: input.crewId,
      orgId: input.orgId,
      active: true,
    },
    select: {
      id: true,
      name: true,
      active: true,
    },
  });

  if (!crew) {
    throw new AppApiError("Assigned crew was not found for this workspace.", 400);
  }

  return crew;
}

async function assertCustomerBelongsToOrg(input: {
  orgId: string;
  customerId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.customerId) return null;

  const customer = await input.tx.customer.findFirst({
    where: {
      id: input.customerId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      name: true,
      phoneE164: true,
      addressLine: true,
    },
  });

  if (!customer) {
    throw new AppApiError("Selected customer was not found for this workspace.", 400);
  }

  return customer;
}

async function assertLeadBelongsToOrg(input: {
  orgId: string;
  leadId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.leadId) return null;

  const lead = await input.tx.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      customerId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      businessType: true,
      intakeWorkTypeText: true,
      intakeLocationText: true,
    },
  });

  if (!lead) {
    throw new AppApiError("Selected lead was not found for this workspace.", 400);
  }

  return lead;
}

async function assertLinkedEstimateBelongsToOrg(input: {
  orgId: string;
  estimateId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.estimateId) return null;

  const estimate = await input.tx.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
      archivedAt: null,
    },
    select: {
      id: true,
      leadId: true,
    },
  });

  if (!estimate) {
    throw new AppApiError("Linked estimate was not found for this workspace.", 400);
  }

  return estimate;
}

async function resolveDispatchCustomerId(input: {
  orgId: string;
  customerId: string | null;
  leadCustomerId?: string | null;
  phone: string | null;
  tx: DispatchDbClient;
}): Promise<string | null> {
  if (input.customerId) {
    return input.customerId;
  }

  if (input.leadCustomerId) {
    return input.leadCustomerId;
  }

  const normalizedPhone = normalizeE164(input.phone);
  if (!normalizedPhone) {
    return null;
  }

  const customer = await input.tx.customer.findFirst({
    where: {
      orgId: input.orgId,
      phoneE164: normalizedPhone,
    },
    select: {
      id: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return customer?.id || null;
}

async function getNextCrewOrder(input: {
  orgId: string;
  scheduledDateKey: string;
  assignedCrewId: string | null;
  tx: DispatchDbClient;
}): Promise<number> {
  const { start, end } = buildDayRange(input.scheduledDateKey);
  const latest = await input.tx.job.findFirst({
    where: {
      orgId: input.orgId,
      scheduledDate: {
        gte: start,
        lt: end,
      },
      assignedCrewId: input.assignedCrewId,
      crewOrder: {
        not: null,
      },
    },
    select: {
      crewOrder: true,
    },
    orderBy: [{ crewOrder: "desc" }, { updatedAt: "desc" }],
  });

  return (latest?.crewOrder ?? -1) + 1;
}

function buildDispatchScheduleProjection(input: {
  job: {
    scheduledDate: Date | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    calendarEvents: Parameters<typeof deriveJobBookingProjection>[0]["events"];
  };
  timeZone: string;
}): DispatchScheduleProjection {
  const projection = deriveJobBookingProjection({
    events: input.job.calendarEvents,
    timeZone: input.timeZone,
  });

  if (projection.hasBookingEvent) {
    return {
      scheduledDate: projection.scheduledDate,
      scheduledStartTime: projection.scheduledStartTime,
      scheduledEndTime: projection.scheduledEndTime,
      hasBookingHistory: true,
      hasActiveBooking: projection.hasActiveBooking,
    };
  }

  return {
    scheduledDate: input.job.scheduledDate,
    scheduledStartTime: input.job.scheduledStartTime,
    scheduledEndTime: input.job.scheduledEndTime,
    hasBookingHistory: false,
    hasActiveBooking: false,
  };
}

export async function ensureDispatchCrewsForOrg(orgId: string) {
  return ensureDispatchCrewsForOrgWithClient(orgId, prisma);
}

export async function getDispatchDaySnapshot(input: {
  orgId: string;
  date: string;
  todayDate?: string | null;
}): Promise<DispatchDaySnapshot> {
  const { start, end } = buildDayRange(input.date);
  const todayDateKey = resolveTodayDateKey(input.todayDate);
  const [crews, config] = await Promise.all([
    ensureDispatchCrewsForOrg(input.orgId),
    prisma.orgDashboardConfig.findUnique({
      where: {
        orgId: input.orgId,
      },
      select: {
        calendarTimezone: true,
      },
    }),
  ]);
  const scheduleTimeZone = ensureTimeZone(config?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE);

  const jobs = await prisma.job.findMany({
    where: {
      orgId: input.orgId,
      OR: [
        {
          calendarEvents: {
            some: {
              type: {
                in: bookingEventTypes,
              },
              startAt: {
                gte: start,
                lt: end,
              },
            },
          },
        },
        {
          scheduledDate: {
            gte: start,
            lt: end,
          },
          calendarEvents: {
            none: {
              type: {
                in: bookingEventTypes,
              },
            },
          },
        },
      ],
    },
    select: {
      ...dispatchJobBaseSelect,
      calendarEvents: {
        where: {
          type: {
            in: bookingEventTypes,
          },
          startAt: {
            gte: start,
            lt: end,
          },
        },
        select: dispatchJobBaseSelect.calendarEvents.select,
        orderBy: dispatchJobBaseSelect.calendarEvents.orderBy,
        take: 12,
      },
    },
  });

  const serializedJobs = jobs
    .map((job) =>
      serializeDispatchJobWithSchedule(job, todayDateKey, buildDispatchScheduleProjection({
        job,
        timeZone: scheduleTimeZone,
      })),
    )
    .sort(compareDispatchJobs);
  const countsByCrew = new Map<string, number>();
  for (const job of serializedJobs) {
    if (!job.assignedCrewId) continue;
    countsByCrew.set(job.assignedCrewId, (countsByCrew.get(job.assignedCrewId) || 0) + 1);
  }

  const visibleCrews = crews.filter((crew) => crew.active || countsByCrew.has(crew.id));

  return {
    date: input.date,
    crews: visibleCrews.map((crew): DispatchCrewSummary => ({
      id: crew.id,
      name: crew.name,
      active: crew.active,
      jobCount: countsByCrew.get(crew.id) || 0,
    })),
    jobs: serializedJobs,
    counts: {
      total: serializedJobs.length,
      unassigned: serializedJobs.filter((job) => !job.assignedCrewId).length,
      completed: serializedJobs.filter((job) => job.status === "completed").length,
      overdue: serializedJobs.filter((job) => job.isOverdue).length,
    },
  };
}

export async function createDispatchJob(input: {
  orgId: string;
  actorUserId: string | null;
  payload: DispatchJobPayload | null;
  todayDate?: string | null;
}): Promise<DispatchJobSummary> {
  const normalized = normalizeDispatchJobPayload(input.payload);
  const todayDateKey = resolveTodayDateKey(input.todayDate);
  const result = await prisma.$transaction(async (tx) => {
    await ensureDispatchCrewsForOrgWithClient(input.orgId, tx);
    const assignedCrew = await assertCrewBelongsToOrg({
      orgId: input.orgId,
      crewId: normalized.assignedCrewId,
      tx,
    });
    const linkedEstimate = await assertLinkedEstimateBelongsToOrg({
      orgId: input.orgId,
      estimateId: normalized.linkedEstimateId,
      tx,
    });
    const resolvedLeadId = normalized.leadId || linkedEstimate?.leadId || null;
    const lead = await assertLeadBelongsToOrg({
      orgId: input.orgId,
      leadId: resolvedLeadId,
      tx,
    });
    const customer = await assertCustomerBelongsToOrg({
      orgId: input.orgId,
      customerId: normalized.customerId,
      tx,
    });

    if (customer?.id && lead?.customerId && customer.id !== lead.customerId) {
      throw new AppApiError("Selected lead belongs to a different customer.", 400);
    }

    const customerId = await resolveDispatchCustomerId({
      orgId: input.orgId,
      customerId: customer?.id || null,
      leadCustomerId: lead?.customerId || null,
      phone: normalized.phone,
      tx,
    });
    const bookingEvent = await findLinkedBookingEvent({
      tx,
      orgId: input.orgId,
      jobId: "__pending_dispatch_job__",
      leadId: lead?.id || null,
    });
    const linkableBookingEvent = bookingEvent && !bookingEvent.jobId ? bookingEvent : null;
    if (
      requiresLinkedBookingForExecution(normalized.status)
      && (!linkableBookingEvent || !isActiveBookingEventStatus(linkableBookingEvent.status))
    ) {
      throw new AppApiError("A linked calendar booking is required before advancing dispatch execution.", 409);
    }
    const bookingScheduleTimeZone = linkableBookingEvent ? await resolveDispatchCalendarTimeZone(tx, input.orgId) : null;
    const mirroredScheduledDateKey =
      linkableBookingEvent && bookingScheduleTimeZone
        ? zonedDateString(linkableBookingEvent.startAt, bookingScheduleTimeZone)
        : null;
    const mirroredScheduledStartTime =
      linkableBookingEvent && bookingScheduleTimeZone
        ? zonedTimeString(linkableBookingEvent.startAt, bookingScheduleTimeZone)
        : null;
    const mirroredScheduledEndTime =
      linkableBookingEvent?.endAt && bookingScheduleTimeZone
        ? zonedTimeString(linkableBookingEvent.endAt, bookingScheduleTimeZone)
        : null;
    const effectiveScheduledDateKey = linkableBookingEvent ? mirroredScheduledDateKey : normalized.scheduledDateKey;
    const effectiveScheduledStartTime = linkableBookingEvent ? mirroredScheduledStartTime : normalized.scheduledStartTime;
    const effectiveScheduledEndTime = linkableBookingEvent ? mirroredScheduledEndTime : normalized.scheduledEndTime;
    const crewOrder = effectiveScheduledDateKey
      ? await getNextCrewOrder({
          orgId: input.orgId,
          scheduledDateKey: effectiveScheduledDateKey,
          assignedCrewId: assignedCrew?.id || null,
          tx,
        })
      : null;

    const job = await tx.job.create({
      data: {
        orgId: input.orgId,
        createdByUserId: input.actorUserId,
        customerId,
        leadId: lead?.id || null,
        ...buildOperationalJobEstimateLinkData({
          linkedEstimateId: linkedEstimate?.id || null,
        }),
        customerName: normalized.customerName,
        phone: normalized.phone,
        address: normalized.address,
        serviceType: normalized.serviceType,
        projectType: normalized.serviceType,
        ...(!linkableBookingEvent
          ? buildUnscheduledJobMirror({
              scheduledDate: normalized.scheduledDate,
              scheduledStartTime: normalized.scheduledStartTime,
              scheduledEndTime: normalized.scheduledEndTime,
              crewOrder,
            })
          : { crewOrder }),
        dispatchStatus: dispatchStatusToDb(normalized.status),
        assignedCrewId: assignedCrew?.id || null,
        notes: normalized.notes,
        priority: normalized.priority,
      },
      select: dispatchJobBaseSelect,
    });

    if (linkedEstimate?.id) {
      await tx.estimate.updateMany({
        where: {
          id: linkedEstimate.id,
          orgId: input.orgId,
          jobId: null,
        },
        data: buildEstimateAttachmentData(job.id),
      });
    }

    if (linkableBookingEvent) {
      await tx.event.update({
        where: {
          id: linkableBookingEvent.id,
        },
        data: {
          jobId: job.id,
        },
      });

      await syncLeadBookingState(tx, {
        orgId: linkableBookingEvent.orgId,
        leadId: linkableBookingEvent.leadId,
        eventId: linkableBookingEvent.id,
        type: linkableBookingEvent.type,
        status: linkableBookingEvent.status,
        startAt: linkableBookingEvent.startAt,
        endAt: linkableBookingEvent.endAt,
        title: linkableBookingEvent.title,
        customerName: linkableBookingEvent.customerName,
        addressLine: linkableBookingEvent.addressLine,
        createdByUserId: linkableBookingEvent.createdByUserId,
      });
    }

    const events: JobEventInput[] = [
      {
        eventType: "JOB_CREATED",
        metadata: createDispatchEventMetadataBase({
          customerId,
          leadId: lead?.id || null,
          linkedEstimateId: linkedEstimate?.id || null,
          scheduledDateKey: effectiveScheduledDateKey,
          scheduledStartTime: effectiveScheduledStartTime,
          scheduledEndTime: effectiveScheduledEndTime,
          status: normalized.status,
          assignedCrewId: assignedCrew?.id || null,
          assignedCrewName: assignedCrew?.name || null,
        }),
      },
    ];

    if (assignedCrew) {
      events.push({
        eventType: "CREW_ASSIGNED",
        toValue: assignedCrew.id,
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: lead?.id || null,
            linkedEstimateId: linkedEstimate?.id || null,
            scheduledDateKey: effectiveScheduledDateKey,
            scheduledStartTime: effectiveScheduledStartTime,
            scheduledEndTime: effectiveScheduledEndTime,
            status: normalized.status,
            assignedCrewId: assignedCrew.id,
            assignedCrewName: assignedCrew.name,
          }),
          crewName: assignedCrew.name,
        },
      });
    }

    const createdEvents = await writeJobEvents({
      tx,
      orgId: input.orgId,
      jobId: job.id,
      actorUserId: input.actorUserId,
      events,
    });

    return {
      job: serializeDispatchJobWithSchedule(
        job,
        todayDateKey,
        {
          scheduledDate: effectiveScheduledDateKey ? new Date(`${effectiveScheduledDateKey}T00:00:00.000Z`) : null,
          scheduledStartTime: effectiveScheduledStartTime,
          scheduledEndTime: effectiveScheduledEndTime,
          hasBookingHistory: Boolean(linkableBookingEvent),
          hasActiveBooking: Boolean(linkableBookingEvent),
        },
      ),
      createdEvents,
    };
  });

  await maybeSendDispatchCustomerNotifications({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    jobId: result.job.id,
    events: result.createdEvents,
  });

  return result.job;
}

export async function updateDispatchJob(input: {
  orgId: string;
  actorUserId: string | null;
  jobId: string;
  payload: DispatchJobPayload | null;
  todayDate?: string | null;
}): Promise<DispatchJobDetail> {
  const [existing, config] = await Promise.all([
    prisma.job.findFirst({
      where: {
        id: input.jobId,
        orgId: input.orgId,
      },
      select: dispatchJobDetailSelect,
    }),
    prisma.orgDashboardConfig.findUnique({
      where: {
        orgId: input.orgId,
      },
      select: {
        calendarTimezone: true,
      },
    }),
  ]);

  if (!existing) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  const scheduleTimeZone = ensureTimeZone(config?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE);
  const existingScheduleProjection = buildDispatchScheduleProjection({
    job: existing,
    timeZone: scheduleTimeZone,
  });
  const normalized = normalizeDispatchJobPayload(buildMergedDispatchPayload({
    ...existing,
    scheduledDate:
      existingScheduleProjection.hasActiveBooking && existingScheduleProjection.scheduledDate
        ? formatDispatchDateKey(existingScheduleProjection.scheduledDate)
        : null,
    scheduledStartTime: existingScheduleProjection.hasActiveBooking ? existingScheduleProjection.scheduledStartTime : null,
    scheduledEndTime: existingScheduleProjection.hasActiveBooking ? existingScheduleProjection.scheduledEndTime : null,
  }, input.payload), {
    allowMissingScheduledDate: true,
  });
  const createdEvents = await prisma.$transaction(async (tx) => {
    const crewMap = await getCrewMapForOrg({
      orgId: input.orgId,
      tx,
    });
    const assignedCrew = await assertCrewBelongsToOrg({
      orgId: input.orgId,
      crewId: normalized.assignedCrewId,
      tx,
    });
    const linkedEstimate = await assertLinkedEstimateBelongsToOrg({
      orgId: input.orgId,
      estimateId: normalized.linkedEstimateId,
      tx,
    });
    if (linkedEstimate?.leadId && normalized.leadId && linkedEstimate.leadId !== normalized.leadId) {
      throw new AppApiError("Selected lead does not match the linked estimate.", 400);
    }

    const resolvedLeadId = normalized.leadId || linkedEstimate?.leadId || null;
    const lead = await assertLeadBelongsToOrg({
      orgId: input.orgId,
      leadId: resolvedLeadId,
      tx,
    });
    const customer = await assertCustomerBelongsToOrg({
      orgId: input.orgId,
      customerId: normalized.customerId,
      tx,
    });

    if (customer?.id && lead?.customerId && customer.id !== lead.customerId) {
      throw new AppApiError("Selected lead belongs to a different customer.", 400);
    }

    const customerId = await resolveDispatchCustomerId({
      orgId: input.orgId,
      customerId: customer?.id || null,
      leadCustomerId: lead?.customerId || null,
      phone: normalized.phone,
      tx,
    });
    const existingDateKey = existing.scheduledDate ? formatDispatchDateKey(existing.scheduledDate) : null;
    const nextDispatchStatus = dispatchStatusToDb(normalized.status);
    const nextAssignedCrewId = assignedCrew?.id || null;
    const nextLeadId = lead?.id || null;
    const nextLinkedEstimateId = linkedEstimate?.id || null;
    const bookingEvent = await findLinkedBookingEvent({
      tx,
      orgId: input.orgId,
      jobId: existing.id,
      leadId: nextLeadId,
    });
    const bookingScheduleTimeZone = bookingEvent ? await resolveDispatchCalendarTimeZone(tx, input.orgId) : null;
    const existingBookingDateKey =
      bookingEvent && bookingScheduleTimeZone
        ? zonedDateString(bookingEvent.startAt, bookingScheduleTimeZone)
        : existingDateKey;
    const existingBookingStartTime =
      bookingEvent && bookingScheduleTimeZone
        ? zonedTimeString(bookingEvent.startAt, bookingScheduleTimeZone)
        : existing.scheduledStartTime;
    const existingBookingEndTime =
      bookingEvent?.endAt && bookingScheduleTimeZone
        ? zonedTimeString(bookingEvent.endAt, bookingScheduleTimeZone)
        : existing.scheduledEndTime;
    const requestedScheduledDateKey = normalized.scheduledDateKey || existingBookingDateKey;
    const requestedScheduledStartTime = normalized.scheduledStartTime;
    const requestedScheduledEndTime = normalized.scheduledEndTime;

    if (requiresLinkedBookingForExecution(normalized.status) && (!bookingEvent || !isActiveBookingEventStatus(bookingEvent.status))) {
      throw new AppApiError("A linked calendar booking is required before advancing dispatch execution.", 409);
    }

    const effectiveScheduledDateKey = bookingEvent ? requestedScheduledDateKey : normalized.scheduledDateKey;
    const effectiveScheduledStartTime = bookingEvent ? requestedScheduledStartTime : normalized.scheduledStartTime;
    const effectiveScheduledEndTime = bookingEvent ? requestedScheduledEndTime : normalized.scheduledEndTime;

    let nextCrewOrder = existing.crewOrder;
    const shouldRecomputeCrewOrder =
      existingBookingDateKey !== effectiveScheduledDateKey ||
      existing.assignedCrewId !== nextAssignedCrewId ||
      existing.crewOrder == null;

    if (effectiveScheduledDateKey) {
      nextCrewOrder = shouldRecomputeCrewOrder
        ? await getNextCrewOrder({
            orgId: input.orgId,
            scheduledDateKey: effectiveScheduledDateKey,
            assignedCrewId: nextAssignedCrewId,
            tx,
          })
        : existing.crewOrder;
    } else {
      nextCrewOrder = null;
    }

    if (bookingEvent) {
      const scheduleChanged =
        existingBookingDateKey !== requestedScheduledDateKey ||
        existingBookingStartTime !== requestedScheduledStartTime ||
        existingBookingEndTime !== requestedScheduledEndTime;
      const nextEventStatus = mapDispatchStatusToEventStatus(normalized.status);

      if ((scheduleChanged || (nextEventStatus && nextEventStatus !== bookingEvent.status)) && requestedScheduledDateKey) {
        const timeZone = bookingScheduleTimeZone || await resolveDispatchCalendarTimeZone(tx, input.orgId);
        const nextStartAt = requestedScheduledStartTime
          ? toUtcFromLocalDateTime({
              date: requestedScheduledDateKey,
              time: requestedScheduledStartTime,
              timeZone,
            })
          : moveUtcDatePreservingLocalTime({
              sourceUtc: bookingEvent.startAt,
              targetDate: requestedScheduledDateKey,
              timeZone,
            });
        const nextEndAt = requestedScheduledEndTime
          ? toUtcFromLocalDateTime({
              date: requestedScheduledDateKey,
              time: requestedScheduledEndTime,
              timeZone,
            })
          : bookingEvent.endAt
            ? moveUtcDatePreservingLocalTime({
                sourceUtc: bookingEvent.endAt,
                targetDate: requestedScheduledDateKey,
                timeZone,
              })
            : null;

        const updatedBookingEvent = await tx.event.update({
          where: {
            id: bookingEvent.id,
          },
          data: {
            ...(bookingEvent.jobId ? {} : { jobId: existing.id }),
            startAt: nextStartAt,
            endAt: nextEndAt,
            ...(nextEventStatus ? { status: nextEventStatus } : {}),
          },
          select: {
            id: true,
            orgId: true,
            leadId: true,
            jobId: true,
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
          orgId: updatedBookingEvent.orgId,
          leadId: updatedBookingEvent.leadId,
          eventId: updatedBookingEvent.id,
          type: updatedBookingEvent.type,
          status: updatedBookingEvent.status,
          startAt: updatedBookingEvent.startAt,
          endAt: updatedBookingEvent.endAt,
          title: updatedBookingEvent.title,
          customerName: updatedBookingEvent.customerName,
          addressLine: updatedBookingEvent.addressLine,
          createdByUserId: updatedBookingEvent.createdByUserId,
        });
      }
    }

    await tx.job.update({
      where: {
        id: existing.id,
      },
      data: {
        customerId,
        leadId: nextLeadId,
        ...buildOperationalJobEstimateLinkData({
          existingSourceEstimateId: existing.sourceEstimateId,
          linkedEstimateId: nextLinkedEstimateId,
        }),
        customerName: normalized.customerName,
        phone: normalized.phone,
        serviceType: normalized.serviceType,
        projectType: normalized.serviceType,
        address: normalized.address,
        dispatchStatus: nextDispatchStatus,
        assignedCrewId: nextAssignedCrewId,
        crewOrder: nextCrewOrder,
        notes: normalized.notes,
        priority: normalized.priority,
        ...(!bookingEvent
          ? buildUnscheduledJobMirror({
              scheduledDate: normalized.scheduledDate,
              scheduledStartTime: normalized.scheduledStartTime,
              scheduledEndTime: normalized.scheduledEndTime,
              crewOrder: nextCrewOrder,
            })
          : {}),
      },
    });

    if (nextLinkedEstimateId) {
      await tx.estimate.updateMany({
        where: {
          id: nextLinkedEstimateId,
          orgId: input.orgId,
          OR: [{ jobId: null }, { jobId: existing.id }],
        },
        data: buildEstimateAttachmentData(existing.id),
      });
    }

    const previousEstimateId = getOperationalJobPrimaryEstimateId(existing);
    if (previousEstimateId && previousEstimateId !== nextLinkedEstimateId) {
      await tx.estimate.updateMany({
        where: {
          id: previousEstimateId,
          orgId: input.orgId,
          jobId: existing.id,
        },
        data: buildEstimateAttachmentData(null),
      });
    }

    const events: JobEventInput[] = [];
    if (existing.assignedCrewId !== nextAssignedCrewId) {
      events.push({
        eventType: existing.assignedCrewId ? "CREW_REASSIGNED" : "CREW_ASSIGNED",
        fromValue: existing.assignedCrewId,
        toValue: nextAssignedCrewId,
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: nextLeadId,
            linkedEstimateId: nextLinkedEstimateId,
            scheduledDateKey: effectiveScheduledDateKey,
            scheduledStartTime: effectiveScheduledStartTime,
            scheduledEndTime: effectiveScheduledEndTime,
            status: normalized.status,
            assignedCrewId: nextAssignedCrewId,
            assignedCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
          }),
          fromCrewName: existing.assignedCrewId ? crewMap.get(existing.assignedCrewId)?.name || null : null,
          toCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
        },
      });
    }

    if (existing.dispatchStatus !== dispatchStatusToDb(normalized.status)) {
      events.push({
        eventType: "STATUS_CHANGED",
        fromValue: dispatchStatusFromDb(existing.dispatchStatus),
        toValue: normalized.status,
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: nextLeadId,
            linkedEstimateId: nextLinkedEstimateId,
            scheduledDateKey: effectiveScheduledDateKey,
            scheduledStartTime: effectiveScheduledStartTime,
            scheduledEndTime: effectiveScheduledEndTime,
            status: normalized.status,
            assignedCrewId: nextAssignedCrewId,
            assignedCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
          }),
          fromStatusLabel: formatDispatchStatusLabel(dispatchStatusFromDb(existing.dispatchStatus)),
          toStatusLabel: formatDispatchStatusLabel(normalized.status),
        },
      });
    }

    const fieldChanges = [
      {
        field: "customerId",
        from: existing.customerId,
        to: customerId,
      },
      {
        field: "leadId",
        from: existing.leadId,
        to: nextLeadId,
      },
      {
        field: "linkedEstimateId",
        from: getOperationalJobPrimaryEstimateId(existing),
        to: nextLinkedEstimateId,
      },
      {
        field: "customerName",
        from: existing.customerName,
        to: normalized.customerName,
      },
      {
        field: "phone",
        from: existing.phone,
        to: normalized.phone,
      },
      {
        field: "serviceType",
        from: existing.serviceType,
        to: normalized.serviceType,
      },
      {
        field: "address",
        from: existing.address,
        to: normalized.address,
      },
      {
        field: "scheduledDate",
        from: existingBookingDateKey,
        to: effectiveScheduledDateKey,
      },
      {
        field: "scheduledStartTime",
        from: existingBookingStartTime,
        to: effectiveScheduledStartTime,
      },
      {
        field: "scheduledEndTime",
        from: existingBookingEndTime,
        to: effectiveScheduledEndTime,
      },
      {
        field: "crewOrder",
        from: existing.crewOrder == null ? null : String(existing.crewOrder),
        to: nextCrewOrder == null ? null : String(nextCrewOrder),
      },
      {
        field: "priority",
        from: existing.priority,
        to: normalized.priority,
      },
      {
        field: "notes",
        from: existing.notes,
        to: normalized.notes,
      },
    ].filter((change) => change.from !== change.to);

    if (fieldChanges.length > 0) {
      events.push({
        eventType: "JOB_UPDATED",
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: nextLeadId,
            linkedEstimateId: nextLinkedEstimateId,
            scheduledDateKey: effectiveScheduledDateKey,
            scheduledStartTime: effectiveScheduledStartTime,
            scheduledEndTime: effectiveScheduledEndTime,
            status: normalized.status,
            assignedCrewId: nextAssignedCrewId,
            assignedCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
          }),
          ...createJobUpdatedMetadata({
            changes: fieldChanges,
          }),
        },
      });
    }

    if (events.length > 0) {
      return writeJobEvents({
        tx,
        orgId: input.orgId,
        jobId: existing.id,
        actorUserId: input.actorUserId,
        events,
      });
    }
    return [];
  });

  await maybeSendDispatchCustomerNotifications({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    jobId: input.jobId,
    events: createdEvents,
  });

  return getDispatchJobDetail({
    orgId: input.orgId,
    jobId: input.jobId,
    todayDate: input.todayDate,
  });
}

export async function getDispatchJobDetail(input: {
  orgId: string;
  jobId: string;
  todayDate?: string | null;
}): Promise<DispatchJobDetail> {
  await ensureDispatchCrewsForOrg(input.orgId);
  const todayDateKey = resolveTodayDateKey(input.todayDate);
  const config = await prisma.orgDashboardConfig.findUnique({
    where: {
      orgId: input.orgId,
    },
    select: {
      calendarTimezone: true,
    },
  });
  const scheduleTimeZone = ensureTimeZone(config?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE);

  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: dispatchJobDetailSelect,
  });

  if (!job) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  const linkedEstimate = job.linkedEstimate || job.sourceEstimate;
  const leadIds = new Set<string>();
  if (job.leadId) leadIds.add(job.leadId);
  if (job.linkedEstimate?.leadId) leadIds.add(job.linkedEstimate.leadId);
  if (job.sourceEstimate?.leadId) leadIds.add(job.sourceEstimate.leadId);
  if (job.customerId) {
    const customerLeads = await prisma.lead.findMany({
      where: {
        orgId: input.orgId,
        customerId: job.customerId,
      },
      select: {
        id: true,
      },
      take: 10,
    });
    for (const lead of customerLeads) {
      leadIds.add(lead.id);
    }
  }

  const normalizedPhone = normalizeE164(job.phone);
  if (normalizedPhone) {
    const phoneLeads = await prisma.lead.findMany({
      where: {
        orgId: input.orgId,
        phoneE164: normalizedPhone,
      },
      select: {
        id: true,
      },
      take: 10,
    });
    for (const lead of phoneLeads) {
      leadIds.add(lead.id);
    }
  }

  const communicationEvents =
    job.customerId || leadIds.size > 0
      ? await prisma.communicationEvent.findMany({
          where: {
            orgId: input.orgId,
            OR: [
              ...(job.customerId ? [{ contactId: job.customerId }] : []),
              ...(leadIds.size > 0 ? [{ leadId: { in: [...leadIds] } }] : []),
            ],
          },
          select: {
            id: true,
            summary: true,
            channel: true,
            type: true,
            occurredAt: true,
            lead: {
              select: {
                contactName: true,
                businessName: true,
                phoneE164: true,
              },
            },
          },
          orderBy: [{ occurredAt: "desc" }],
          take: 6,
        })
      : [];

  const recentCommunication: DispatchCommunicationItem[] = communicationEvents.map((event) => ({
    id: event.id,
    summary: event.summary,
    channel: event.channel.toLowerCase(),
    type: event.type.toLowerCase(),
    occurredAt: event.occurredAt.toISOString(),
    leadLabel: event.lead
      ? event.lead.contactName || event.lead.businessName || event.lead.phoneE164
      : null,
  }));

  return {
    ...serializeDispatchJobWithSchedule(job, todayDateKey, buildDispatchScheduleProjection({
      job,
      timeZone: scheduleTimeZone,
    })),
    linkedEstimate: serializeDispatchEstimate(linkedEstimate),
    recentCommunication,
  };
}

export async function reorderDispatchJobs(input: {
  orgId: string;
  actorUserId: string | null;
  date: string;
  columns: DispatchReorderPayload;
  todayDate?: string | null;
}) {
  const { start, end } = buildDayRange(input.date);
  const uniqueIds = new Set<string>();

  for (const column of input.columns) {
    for (const jobId of column.jobIds) {
      if (!jobId || uniqueIds.has(jobId)) {
        throw new AppApiError("Board reorder payload is invalid.", 400);
      }
      uniqueIds.add(jobId);
    }
  }

  await prisma.$transaction(async (tx) => {
    const crewMap = await getCrewMapForOrg({
      orgId: input.orgId,
      tx,
    });
    const scheduleTimeZone = await resolveDispatchCalendarTimeZone(tx, input.orgId);

    for (const column of input.columns) {
      if (!column.crewId) continue;
      const crew = crewMap.get(column.crewId);
      if (!crew) {
        throw new AppApiError("Board reorder payload included an unknown crew.", 400);
      }
      if (!crew.active) {
        throw new AppApiError("Inactive crews cannot receive new dispatch assignments.", 400);
      }
    }

    const jobs = await tx.job.findMany({
      where: {
        orgId: input.orgId,
        id: {
          in: [...uniqueIds],
        },
        OR: [
          {
            calendarEvents: {
              some: {
                type: {
                  in: bookingEventTypes,
                },
                startAt: {
                  gte: start,
                  lt: end,
                },
              },
            },
          },
          {
            scheduledDate: {
              gte: start,
              lt: end,
            },
            calendarEvents: {
              none: {
                type: {
                  in: bookingEventTypes,
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        customerId: true,
        leadId: true,
        linkedEstimateId: true,
        scheduledDate: true,
        scheduledStartTime: true,
        scheduledEndTime: true,
        dispatchStatus: true,
        assignedCrewId: true,
        crewOrder: true,
        calendarEvents: {
          where: {
            type: {
              in: bookingEventTypes,
            },
            startAt: {
              gte: start,
              lt: end,
            },
          },
          select: dispatchJobBaseSelect.calendarEvents.select,
          orderBy: dispatchJobBaseSelect.calendarEvents.orderBy,
          take: 12,
        },
      },
    });

    if (jobs.length !== uniqueIds.size) {
      throw new AppApiError("One or more dispatch jobs were not found for the selected day.", 404);
    }

    const jobsById = new Map(jobs.map((job) => [job.id, job] as const));

    for (const column of input.columns) {
      for (const [index, jobId] of column.jobIds.entries()) {
        const existing = jobsById.get(jobId);
        if (!existing) continue;

        const nextCrewId = column.crewId;
        const nextOrder = index;
        if (existing.assignedCrewId === nextCrewId && existing.crewOrder === nextOrder) {
          continue;
        }

        await tx.job.update({
          where: {
            id: existing.id,
          },
          data: {
            assignedCrewId: nextCrewId,
            crewOrder: nextOrder,
          },
        });

        const events: JobEventInput[] = [];
        const scheduleProjection = buildDispatchScheduleProjection({
          job: existing,
          timeZone: scheduleTimeZone,
        });
        const scheduledDateKey = scheduleProjection.scheduledDate ? formatDispatchDateKey(scheduleProjection.scheduledDate) : input.date;
        const status = dispatchStatusFromDb(existing.dispatchStatus);
        if (existing.assignedCrewId !== nextCrewId) {
          events.push({
            eventType: existing.assignedCrewId ? "CREW_REASSIGNED" : "CREW_ASSIGNED",
            fromValue: existing.assignedCrewId,
            toValue: nextCrewId,
            metadata: {
              ...createDispatchEventMetadataBase({
                customerId: existing.customerId,
                leadId: existing.leadId,
                linkedEstimateId: existing.linkedEstimateId,
                scheduledDateKey,
                scheduledStartTime: scheduleProjection.scheduledStartTime,
                scheduledEndTime: scheduleProjection.scheduledEndTime,
                status,
                assignedCrewId: nextCrewId,
                assignedCrewName: nextCrewId ? crewMap.get(nextCrewId)?.name || null : null,
              }),
              fromCrewName: existing.assignedCrewId ? crewMap.get(existing.assignedCrewId)?.name || null : null,
              toCrewName: nextCrewId ? crewMap.get(nextCrewId)?.name || null : null,
            },
          });
        }

        if (existing.crewOrder !== nextOrder) {
          events.push({
            eventType: "JOB_UPDATED",
            fromValue: existing.crewOrder == null ? null : String(existing.crewOrder),
            toValue: String(nextOrder),
            metadata: {
              ...createDispatchEventMetadataBase({
                customerId: existing.customerId,
                leadId: existing.leadId,
                linkedEstimateId: existing.linkedEstimateId,
                scheduledDateKey,
                scheduledStartTime: scheduleProjection.scheduledStartTime,
                scheduledEndTime: scheduleProjection.scheduledEndTime,
                status,
                assignedCrewId: nextCrewId,
                assignedCrewName: nextCrewId ? crewMap.get(nextCrewId)?.name || null : null,
              }),
              changes: [
                {
                  field: "crewOrder",
                  from: existing.crewOrder == null ? null : String(existing.crewOrder),
                  to: String(nextOrder),
                },
              ],
            },
          });
        }

        if (events.length > 0) {
          await writeJobEvents({
            tx,
            orgId: input.orgId,
            jobId: existing.id,
            actorUserId: input.actorUserId,
            events,
          });
        }
      }
    }
  });

  return getDispatchDaySnapshot({
    orgId: input.orgId,
    date: input.date,
    todayDate: input.todayDate,
  });
}

export async function getDispatchCrewSettings(orgId: string): Promise<DispatchCrewManagementItem[]> {
  const crews = await ensureDispatchCrewsForOrg(orgId);
  const openStatuses = ["SCHEDULED", "ON_THE_WAY", "ON_SITE"] as const;
  const counts = await prisma.job.groupBy({
    by: ["assignedCrewId"],
    where: {
      orgId,
      assignedCrewId: {
        in: crews.map((crew) => crew.id),
      },
      dispatchStatus: {
        in: [...openStatuses],
      },
      calendarEvents: {
        some: {
          type: {
            in: bookingEventTypes,
          },
          status: {
            in: activeBookingEventStatuses,
          },
        },
      },
    },
    _count: {
      _all: true,
    },
  });
  const openJobCountByCrew = new Map(
    counts
      .filter((row): row is typeof row & { assignedCrewId: string } => Boolean(row.assignedCrewId))
      .map((row) => [row.assignedCrewId, row._count._all] as const),
  );

  return crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    active: crew.active,
    openJobCount: openJobCountByCrew.get(crew.id) || 0,
  }));
}

export async function updateDispatchCrew(input: {
  orgId: string;
  crewId: string;
  payload: {
    name?: unknown;
    active?: unknown;
  } | null;
}): Promise<DispatchCrewManagementItem[]> {
  await ensureDispatchCrewsForOrg(input.orgId);

  const existing = await prisma.crew.findFirst({
    where: {
      id: input.crewId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      name: true,
      active: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Crew was not found for this workspace.", 404);
  }

  const name =
    input.payload && Object.prototype.hasOwnProperty.call(input.payload, "name")
      ? normalizeCrewName(input.payload.name)
      : existing.name;
  const active =
    input.payload && Object.prototype.hasOwnProperty.call(input.payload, "active")
      ? normalizeOptionalBoolean(input.payload.active, existing.active)
      : existing.active;

  if (!active) {
    const openAssignments = await prisma.job.count({
      where: {
        orgId: input.orgId,
        assignedCrewId: existing.id,
        dispatchStatus: {
          in: ["SCHEDULED", "ON_THE_WAY", "ON_SITE"],
        },
        calendarEvents: {
          some: {
            type: {
              in: bookingEventTypes,
            },
            status: {
              in: activeBookingEventStatuses,
            },
          },
        },
      },
    });

    if (openAssignments > 0) {
      throw new AppApiError("Move open jobs off this crew before setting it inactive.", 409);
    }
  }

  try {
    await prisma.crew.update({
      where: {
        id: existing.id,
      },
      data: {
        name,
        active,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppApiError("Crew name must be unique inside this workspace.", 409);
    }
    throw error;
  }

  return getDispatchCrewSettings(input.orgId);
}
