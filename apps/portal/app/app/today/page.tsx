import Link from "next/link";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { endOfToday, formatDateTime, startOfToday } from "@/lib/hq";
import {
  getContractorWorkflowTone,
  type ContractorWorkflowStage,
  resolveContractorWorkflow,
  resolveContractorWorkflowActionTarget,
} from "@/lib/contractor-workflow";
import { buildMapsHrefFromLocation, normalizeLeadCity, resolveLeadLocationLabel } from "@/lib/lead-location";
import { KpiCard, PanelCard, StatusPill } from "../dashboard-ui";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";

export const dynamic = "force-dynamic";

function buildWorkerLeadScope(userId: string): Prisma.LeadWhereInput {
  return {
    OR: [
      { assignedToUserId: userId },
      { createdByUserId: userId },
      { events: { some: { assignedToUserId: userId } } },
      { events: { some: { workerAssignments: { some: { workerUserId: userId } } } } },
    ],
  };
}

function buildWorkerEventScope(userId: string): Prisma.EventWhereInput {
  return {
    OR: [
      { assignedToUserId: userId },
      { workerAssignments: { some: { workerUserId: userId } } },
    ],
  };
}

function formatTimeOnly(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDateLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatTodayLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(value);
}

function getLeadLabel(input: {
  contactName?: string | null;
  businessName?: string | null;
  phoneE164?: string | null;
}) {
  return input.contactName || input.businessName || input.phoneE164 || "Unnamed lead";
}

function getEventLabel(input: {
  title?: string | null;
  customerName?: string | null;
  contactName?: string | null;
  businessName?: string | null;
  phoneE164?: string | null;
}) {
  return input.customerName || input.contactName || input.businessName || input.phoneE164 || input.title || "Scheduled item";
}

type TodayQueueItem = {
  id: string;
  leadLabel: string;
  leadHref: string;
  locationLabel: string | null;
  phoneE164: string | null;
  priority: "HIGH" | "MEDIUM" | "LOW";
  updatedAt: Date;
  nextFollowUpAt: Date | null;
  lastMessageAt: Date | null;
  workflow: ReturnType<typeof resolveContractorWorkflow>;
  workflowAction: ReturnType<typeof resolveContractorWorkflowActionTarget>;
};

const WORKFLOW_STAGE_ORDER: Record<ContractorWorkflowStage, number> = {
  reply_needed: 0,
  follow_up_overdue: 1,
  estimate_needed: 2,
  estimate_draft: 3,
  estimate_revision: 4,
  ready_to_schedule: 5,
  waiting_on_approval: 6,
  awaiting_payment: 7,
  lead_active: 8,
  job_scheduled: 9,
  paid: 10,
};

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function renderQueueAction(item: TodayQueueItem) {
  if (item.workflowAction.external) {
    return (
      <a className="table-link" href={item.workflowAction.href}>
        {item.workflow.nextAction.label}
      </a>
    );
  }

  return (
    <Link className="table-link" href={item.workflowAction.href} prefetch={false}>
      {item.workflow.nextAction.label}
    </Link>
  );
}

function getQueueTimeLabel(item: TodayQueueItem) {
  if (item.workflow.stage === "reply_needed" && item.lastMessageAt) {
    return formatDateLabel(item.lastMessageAt);
  }

  if (item.workflow.stage === "follow_up_overdue" && item.nextFollowUpAt) {
    return formatDateTime(item.nextFollowUpAt);
  }

  return formatDateLabel(item.updatedAt);
}

function sortQueueItems(left: TodayQueueItem, right: TodayQueueItem) {
  const stageDiff = WORKFLOW_STAGE_ORDER[left.workflow.stage] - WORKFLOW_STAGE_ORDER[right.workflow.stage];
  if (stageDiff !== 0) {
    return stageDiff;
  }

  if (left.workflow.stage === "follow_up_overdue" || right.workflow.stage === "follow_up_overdue") {
    const leftTime = left.nextFollowUpAt?.getTime() || left.updatedAt.getTime();
    const rightTime = right.nextFollowUpAt?.getTime() || right.updatedAt.getTime();
    return leftTime - rightTime;
  }

  return right.updatedAt.getTime() - left.updatedAt.getTime();
}

export default async function AppTodayMobilePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/today", requestedOrgId });
  const mobileMode = getParam(searchParams?.mobile) === "1";

  if (!mobileMode) {
    redirect(withOrgQuery("/app", scope.orgId, scope.internalUser));
  }

  if (scope.internalUser) {
    redirect(withOrgQuery("/app/calendar", scope.orgId, true));
  }

  const viewer = await requireAppPageViewer({
    nextPath: "/app/today",
    orgId: scope.orgId,
  });

  const workerId =
    !viewer.internalUser &&
    viewer.calendarAccessRole !== "OWNER" &&
    viewer.calendarAccessRole !== "ADMIN"
      ? viewer.id
      : null;
  const now = new Date();
  const todayStart = startOfToday(now);
  const todayEnd = endOfToday(now);

  const leadWhere: Prisma.LeadWhereInput = {
    orgId: scope.orgId,
    ...(workerId ? buildWorkerLeadScope(workerId) : {}),
  };

  const eventWhere: Prisma.EventWhereInput = {
    orgId: scope.orgId,
    ...(workerId ? buildWorkerEventScope(workerId) : {}),
  };

  const [nextEvent, todaySchedule, workQueueCandidates] = await Promise.all([
    prisma.event.findFirst({
      where: {
        ...eventWhere,
        type: { in: ["JOB", "ESTIMATE", "CALL"] },
        status: { not: "CANCELLED" },
        startAt: { gte: now },
      },
      orderBy: [{ startAt: "asc" }],
      select: {
        id: true,
        type: true,
        title: true,
        startAt: true,
        leadId: true,
        customerName: true,
        addressLine: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
            city: true,
            intakeLocationText: true,
          },
        },
      },
    }),
    prisma.event.findMany({
      where: {
        ...eventWhere,
        type: { in: ["JOB", "ESTIMATE", "CALL"] },
        status: { not: "CANCELLED" },
        startAt: { gte: todayStart, lte: todayEnd },
      },
      orderBy: [{ startAt: "asc" }],
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        startAt: true,
        leadId: true,
        customerName: true,
        addressLine: true,
        lead: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            city: true,
            intakeLocationText: true,
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        status: { notIn: ["DNC", "NOT_INTERESTED"] },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 80,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        priority: true,
        status: true,
        nextFollowUpAt: true,
        updatedAt: true,
        messages: {
          select: {
            direction: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 1,
        },
        estimates: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
          },
          where: {
            archivedAt: null,
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 4,
        },
        events: {
          where: {
            type: "JOB",
            status: { not: "CANCELLED" },
          },
          select: {
            id: true,
          },
          orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
          take: 1,
        },
        invoices: {
          select: {
            status: true,
            balanceDue: true,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 3,
        },
        jobs: {
          select: {
            id: true,
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    }),
  ]);

  const calendarHref = withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);
  const inboxHref = withOrgQuery("/app/inbox", scope.orgId, scope.internalUser);
  const leadsHref = withOrgQuery("/app/jobs", scope.orgId, scope.internalUser);
  const addLeadHref = withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser);
  const addJobHref = withOrgQuery("/app/calendar?quickAction=schedule", scope.orgId, scope.internalUser);
  const todayLabel = formatTodayLabel(now);

  const workQueueItems = workQueueCandidates
    .map((lead) => {
      const latestEstimate = lead.estimates.find((estimate) => estimate.status !== "CONVERTED") || lead.estimates[0] || null;
      const latestInvoice = lead.invoices[0] || null;
      const workflow = resolveContractorWorkflow({
        now,
        hasMessagingWorkspace: lead.messages.length > 0,
        latestMessageDirection: lead.messages[0]?.direction || null,
        nextFollowUpAt: lead.nextFollowUpAt,
        latestEstimateStatus: latestEstimate?.status || null,
        hasScheduledJob: lead.events.length > 0,
        hasOperationalJob: lead.jobs.length > 0,
        hasLatestInvoice: Boolean(latestInvoice),
        hasOpenInvoice: lead.invoices.some((invoice) => invoice.balanceDue.gt(0)),
        latestInvoicePaid: Boolean(latestInvoice && latestInvoice.balanceDue.lte(0)),
      });
      const workflowAction = resolveContractorWorkflowActionTarget({
        action: workflow.nextAction,
        messagesHref: withOrgQuery(`/app/jobs/${lead.id}?tab=messages`, scope.orgId, scope.internalUser),
        phoneHref: lead.phoneE164 ? `tel:${lead.phoneE164}` : null,
        createEstimateHref: withOrgQuery(
          `/app/estimates?create=1&leadId=${encodeURIComponent(lead.id)}`,
          scope.orgId,
          scope.internalUser,
        ),
        latestEstimateHref: latestEstimate
          ? withOrgQuery(`/app/estimates/${latestEstimate.id}`, scope.orgId, scope.internalUser)
          : null,
        scheduleCalendarHref: withOrgQuery(
          `/app/calendar?quickAction=schedule&leadId=${encodeURIComponent(lead.id)}`,
          scope.orgId,
          scope.internalUser,
        ),
        operationalJobHref: lead.jobs[0]
          ? withOrgQuery(`/app/jobs/records/${lead.jobs[0].id}`, scope.orgId, scope.internalUser)
          : null,
        invoiceHref: withOrgQuery(`/app/jobs/${lead.id}?tab=invoice`, scope.orgId, scope.internalUser),
        overviewHref: withOrgQuery(`/app/jobs/${lead.id}`, scope.orgId, scope.internalUser),
      });

      return {
        id: lead.id,
        leadLabel: getLeadLabel(lead),
        leadHref: withOrgQuery(`/app/jobs/${lead.id}`, scope.orgId, scope.internalUser),
        locationLabel: normalizeLeadCity(lead.city),
        phoneE164: lead.phoneE164,
        priority: lead.priority,
        updatedAt: lead.updatedAt,
        nextFollowUpAt: lead.nextFollowUpAt,
        lastMessageAt: lead.messages[0]?.createdAt || null,
        workflow,
        workflowAction,
      } satisfies TodayQueueItem;
    })
    .filter((item) => item.workflow.stage !== "paid");

  const replyNeeded = workQueueItems.filter((item) => item.workflow.stage === "reply_needed");
  const followUpDue = workQueueItems.filter(
    (item) => item.workflow.stage === "follow_up_overdue" || item.workflow.stage === "waiting_on_approval",
  );
  const estimateWork = workQueueItems.filter(
    (item) =>
      item.workflow.stage === "estimate_needed" ||
      item.workflow.stage === "estimate_draft" ||
      item.workflow.stage === "estimate_revision",
  );
  const readyToSchedule = workQueueItems.filter((item) => item.workflow.stage === "ready_to_schedule");
  const paymentsDue = workQueueItems.filter((item) => item.workflow.stage === "awaiting_payment");
  const workQueueNow = workQueueItems
    .filter(
      (item) =>
        item.workflow.stage !== "lead_active" &&
        item.workflow.stage !== "job_scheduled",
    )
    .sort(sortQueueItems)
    .slice(0, 10);
  const stillMoving = workQueueItems
    .filter((item) => item.workflow.stage === "lead_active" || item.workflow.stage === "job_scheduled")
    .sort(sortQueueItems)
    .slice(0, 8);
  const queueSummaryParts: string[] = [];
  if (replyNeeded.length > 0) queueSummaryParts.push(formatCountLabel(replyNeeded.length, "reply", "replies"));
  if (followUpDue.length > 0) queueSummaryParts.push(formatCountLabel(followUpDue.length, "follow-up", "follow-ups"));
  if (estimateWork.length > 0) queueSummaryParts.push(formatCountLabel(estimateWork.length, "estimate"));
  if (readyToSchedule.length > 0) queueSummaryParts.push(`${readyToSchedule.length.toLocaleString("en-US")} ready to schedule`);
  if (paymentsDue.length > 0) queueSummaryParts.push(formatCountLabel(paymentsDue.length, "payment due", "payments due"));
  const queueSummary = queueSummaryParts.length > 0 ? queueSummaryParts.join(" · ") : "All clear";

  const nextEventLabel = nextEvent
    ? getEventLabel({
        title: nextEvent.title,
        customerName: nextEvent.customerName,
        contactName: nextEvent.lead?.contactName,
        businessName: nextEvent.lead?.businessName,
        phoneE164: nextEvent.lead?.phoneE164,
      })
    : null;
  const nextEventMapsHref = nextEvent
    ? buildMapsHrefFromLocation(
        resolveLeadLocationLabel({
          eventAddressLine: nextEvent.addressLine,
          intakeLocationText: nextEvent.lead?.intakeLocationText,
          city: nextEvent.lead?.city,
        }),
      )
    : null;
  const nextEventHref = nextEvent?.leadId
    ? withOrgQuery(`/app/jobs/${nextEvent.leadId}`, scope.orgId, scope.internalUser)
    : calendarHref;
  const nextEventPhone = nextEvent?.lead?.phoneE164 || null;

  return (
    <div className="dashboard-shell">
      <section className="card dashboard-header">
        <div className="dashboard-header-main">
          <div className="dashboard-header-copy">
            <h1>{todayLabel}</h1>
            <p className="muted">{queueSummary}</p>
          </div>
          <div className="dashboard-actions">
            <Link className="btn secondary" href={calendarHref} prefetch={false}>
              Calendar
            </Link>
            <Link className="btn secondary" href={inboxHref} prefetch={false}>
              Inbox
            </Link>
            <Link className="btn primary" href={addLeadHref} prefetch={false}>
              + New Lead
            </Link>
          </div>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <KpiCard
          label="Reply needed"
          value={replyNeeded.length.toLocaleString("en-US")}
          hint={replyNeeded.length > 0 ? "Customers waiting on you" : "Inbox is clear"}
          href={inboxHref}
        />
        <KpiCard
          label="Follow-ups due"
          value={followUpDue.length.toLocaleString("en-US")}
          hint={followUpDue.length > 0 ? "Quotes and reminders to touch" : "Nothing due right now"}
          href={leadsHref}
        />
        <KpiCard
          label="Estimate work"
          value={estimateWork.length.toLocaleString("en-US")}
          hint={estimateWork.length > 0 ? "Create, finish, or revise" : "No estimate work waiting"}
          href={leadsHref}
        />
        <KpiCard
          label="Ready to schedule"
          value={readyToSchedule.length.toLocaleString("en-US")}
          hint={readyToSchedule.length > 0 ? "Approved and ready to book" : "No approved work waiting"}
          href={calendarHref}
        />
      </section>

      <section className="dashboard-main-grid worker">
        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Work Queue"
            title="Do next"
            subtitle="Start here. These leads need the next move from you."
            actionHref={leadsHref}
            actionLabel="Open Leads"
          >
            {workQueueNow.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>Nothing is blocked right now.</strong>
                <p className="muted">Move to calendar or open leads to review the rest of the pipeline.</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={calendarHref} prefetch={false}>
                    Open Calendar
                  </Link>
                  <Link className="btn secondary" href={leadsHref} prefetch={false}>
                    Open Leads
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {workQueueNow.map((item) => {
                  return (
                    <li key={item.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={item.leadHref} prefetch={false}>
                          {item.leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone={getContractorWorkflowTone(item.workflow.attentionLevel)}>
                            {item.workflow.stageLabel}
                          </StatusPill>
                          <StatusPill tone={item.priority === "HIGH" ? "warn" : "neutral"}>
                            {item.priority.toLowerCase()}
                          </StatusPill>
                          <span>{item.locationLabel || item.phoneE164}</span>
                        </div>
                        <div style={{ marginTop: 6 }}>{renderQueueAction(item)}</div>
                      </div>
                      <span className="dashboard-list-time">{getQueueTimeLabel(item)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>

          <PanelCard
            eyebrow="Calendar"
            title="Today on calendar"
            subtitle="Your next stop first, then the rest of today."
            actionHref={calendarHref}
            actionLabel="Open Calendar"
          >
            <article className="next-job-card">
              <span className="next-job-kicker">Next up</span>
              <h3>{nextEventLabel || "No upcoming events"}</h3>
              <span className="next-job-time">
                {nextEvent ? formatDateTime(nextEvent.startAt) : "Nothing is on the calendar yet."}
              </span>
              {nextEvent ? (
                <p className="muted">
                  {nextEvent.type.replaceAll("_", " ")}{nextEventMapsHref ? " • address ready" : ""}
                </p>
              ) : (
                <p className="muted">Open calendar and add the next stop when work gets booked.</p>
              )}
              <div className="next-job-actions">
                <Link className="btn primary" href={nextEventHref} prefetch={false}>
                  Open
                </Link>
                <Link className="btn secondary" href={calendarHref} prefetch={false}>
                  Calendar
                </Link>
                {nextEventPhone ? (
                  <a className="btn secondary" href={`tel:${nextEventPhone}`}>
                    Call
                  </a>
                ) : null}
                {nextEventMapsHref ? (
                  <a className="btn secondary" href={nextEventMapsHref} target="_blank" rel="noopener noreferrer">
                    Directions
                  </a>
                ) : null}
              </div>
            </article>

            {todaySchedule.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No events on the calendar today.</strong>
                <p className="muted">Schedule work or open the calendar to see what is coming next.</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={addJobHref} prefetch={false}>
                    Add Job
                  </Link>
                  <Link className="btn secondary" href={calendarHref} prefetch={false}>
                    Open Calendar
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {todaySchedule.map((event) => {
                  const eventLabel = getEventLabel({
                    title: event.title,
                    customerName: event.customerName,
                    contactName: event.lead?.contactName,
                    businessName: event.lead?.businessName,
                    phoneE164: event.lead?.phoneE164,
                  });
                  const mapsHref = buildMapsHrefFromLocation(
                    resolveLeadLocationLabel({
                      eventAddressLine: event.addressLine,
                      intakeLocationText: event.lead?.intakeLocationText,
                      city: event.lead?.city,
                    }),
                  );
                  const targetHref = event.leadId
                    ? withOrgQuery(`/app/jobs/${event.leadId}`, scope.orgId, scope.internalUser)
                    : calendarHref;
                  return (
                    <li key={event.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={targetHref} prefetch={false}>
                          {eventLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone="neutral">{event.type.replaceAll("_", " ").toLowerCase()}</StatusPill>
                          <span>{mapsHref ? "Directions ready" : event.addressLine || "Address not added yet"}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatTimeOnly(event.startAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>
        </div>

        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Pipeline"
            title="Still moving"
            subtitle="Work that is in motion but not blocked right now."
            actionHref={leadsHref}
            actionLabel="Open Leads"
          >
            {stillMoving.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No quiet pipeline work right now.</strong>
                <p className="muted">Anything still moving without a blocker will show up here.</p>
              </div>
            ) : (
              <ul className="dashboard-list">
                {stillMoving.map((item) => {
                  return (
                    <li key={item.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={item.leadHref} prefetch={false}>
                          {item.leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone={getContractorWorkflowTone(item.workflow.attentionLevel)}>
                            {item.workflow.stageLabel}
                          </StatusPill>
                          <StatusPill tone={item.priority === "HIGH" ? "warn" : "neutral"}>
                            {item.priority.toLowerCase()}
                          </StatusPill>
                          <span>{item.locationLabel || item.phoneE164}</span>
                        </div>
                        <div style={{ marginTop: 6 }}>{renderQueueAction(item)}</div>
                      </div>
                      <span className="dashboard-list-time">{getQueueTimeLabel(item)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>
        </div>
      </section>
    </div>
  );
}
