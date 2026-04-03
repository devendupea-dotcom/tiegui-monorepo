import Link from "next/link";
import { Prisma, type LeadStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { endOfToday, formatDateTime, isOverdueFollowUp, startOfToday } from "@/lib/hq";
import { buildMapsHrefFromLocation, normalizeLeadCity, resolveLeadLocationLabel } from "@/lib/lead-location";
import { requireSessionUser } from "@/lib/session";
import { KpiCard, PanelCard, StatusPill } from "../dashboard-ui";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

export const dynamic = "force-dynamic";

const ACTIVE_LEAD_STATUSES: LeadStatus[] = ["NEW", "CALLED_NO_ANSWER", "VOICEMAIL", "INTERESTED", "FOLLOW_UP"];

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

function formatDayTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
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

  const sessionUser = await requireSessionUser("/app/today");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  const workerId =
    !scope.internalUser &&
    currentUser &&
    currentUser.calendarAccessRole !== "OWNER" &&
    currentUser.calendarAccessRole !== "ADMIN"
      ? currentUser.id
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

  const [
    todayScheduleCount,
    nextEvent,
    todaySchedule,
    conversationCandidates,
    dueFollowUps,
    activeLeadCount,
    activeLeads,
  ] = await Promise.all([
    prisma.event.count({
      where: {
        ...eventWhere,
        type: { in: ["JOB", "ESTIMATE", "CALL"] },
        status: { not: "CANCELLED" },
        startAt: { gte: todayStart, lte: todayEnd },
      },
    }),
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
        lastInboundAt: { not: null },
      },
      orderBy: [{ lastInboundAt: "desc" }],
      take: 100,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        priority: true,
        status: true,
        city: true,
        nextFollowUpAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
      },
    }),
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        status: { in: ACTIVE_LEAD_STATUSES },
        nextFollowUpAt: { not: null, lte: todayEnd },
      },
      orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        priority: true,
        status: true,
        nextFollowUpAt: true,
      },
    }),
    prisma.lead.count({
      where: {
        ...leadWhere,
        status: { in: ACTIVE_LEAD_STATUSES },
      },
    }),
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        status: { in: ACTIVE_LEAD_STATUSES },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        priority: true,
        status: true,
        updatedAt: true,
      },
    }),
  ]);

  const repliesNeedingAttention = conversationCandidates.filter(
    (lead) => lead.lastInboundAt && (!lead.lastOutboundAt || lead.lastOutboundAt < lead.lastInboundAt),
  );
  const replyLeadIds = new Set(repliesNeedingAttention.map((lead) => lead.id));
  const followUpsNeedingAttention = dueFollowUps.filter((lead) => !replyLeadIds.has(lead.id));
  const replyQueueCount = repliesNeedingAttention.length;
  const followUpCount = followUpsNeedingAttention.length;
  const repliesNeeded = repliesNeedingAttention.slice(0, 8);
  const followUpsToWork = followUpsNeedingAttention.slice(0, 8);

  const calendarHref = withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);
  const inboxHref = withOrgQuery("/app/inbox", scope.orgId, scope.internalUser);
  const addLeadHref = withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser);
  const addJobHref = withOrgQuery("/app/calendar?quickAction=schedule", scope.orgId, scope.internalUser);

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
            <span className="dashboard-header-eyebrow">Today</span>
            <h1>Field Snapshot</h1>
            <p className="muted">See the calendar, the conversations waiting on a reply, and the work still moving today.</p>
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
        <div className="dashboard-header-band">
          <article className="dashboard-header-stat">
            <span>On calendar</span>
            <strong>{todayScheduleCount.toLocaleString("en-US")}</strong>
            <small>Scheduled for today</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Next stop</span>
            <strong>{nextEvent ? formatDayTime(nextEvent.startAt) : "—"}</strong>
            <small>{nextEventLabel || "Nothing scheduled yet"}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Needs reply</span>
            <strong>{replyQueueCount.toLocaleString("en-US")}</strong>
            <small>{replyQueueCount > 0 ? "Customers waiting on you" : "Inbox is clear"}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Follow-ups today</span>
            <strong>{followUpCount.toLocaleString("en-US")}</strong>
            <small>{followUpCount > 0 ? "Still needs a touch" : "No follow-ups due"}</small>
          </article>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <KpiCard
          label="Today’s calendar"
          value={todayScheduleCount.toLocaleString("en-US")}
          hint="Jobs, estimates, and calls"
          href={calendarHref}
        />
        <KpiCard
          label="Reply queue"
          value={replyQueueCount.toLocaleString("en-US")}
          hint={replyQueueCount > 0 ? "Open conversations waiting" : "Nothing waiting"}
          href={inboxHref}
        />
        <KpiCard
          label="Follow-ups due"
          value={followUpCount.toLocaleString("en-US")}
          hint={followUpCount > 0 ? "Due before end of day" : "Clear for now"}
          href={inboxHref}
        />
        <KpiCard
          label="Active leads"
          value={activeLeadCount.toLocaleString("en-US")}
          hint="Still in play"
          href={inboxHref}
        />
      </section>

      <section className="dashboard-main-grid worker">
        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Calendar"
            title="What’s happening next"
            subtitle="Your next stop first, then the rest of today’s schedule."
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
                <p className="muted">Start from calendar so the crew has a clear day plan.</p>
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

          <PanelCard
            eyebrow="Pipeline"
            title="Active leads still moving"
            subtitle="The leads and open jobs most likely to need work today."
            actionHref={inboxHref}
            actionLabel="Open Leads"
          >
            {activeLeads.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No active leads right now.</strong>
                <p className="muted">When new work comes in, it will show here with the rest of today’s priorities.</p>
              </div>
            ) : (
              <ul className="dashboard-list">
                {activeLeads.map((lead) => {
                  const leadLabel = getLeadLabel(lead);
                  const leadCity = normalizeLeadCity(lead.city);
                  return (
                    <li key={lead.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={withOrgQuery(`/app/jobs/${lead.id}`, scope.orgId, scope.internalUser)} prefetch={false}>
                          {leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone="neutral">{lead.status.replaceAll("_", " ").toLowerCase()}</StatusPill>
                          <StatusPill tone={lead.priority === "HIGH" ? "warn" : "neutral"}>
                            {lead.priority.toLowerCase()}
                          </StatusPill>
                          <span>{leadCity || lead.phoneE164}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatDateLabel(lead.updatedAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>
        </div>

        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Reply Queue"
            title="Messages that need a response"
            subtitle="If the customer texted last, it should show up here."
            actionHref={inboxHref}
            actionLabel="Go to Inbox"
          >
            {repliesNeeded.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No messages waiting on you.</strong>
                <p className="muted">The inbox is clear for now.</p>
                <div className="portal-empty-actions">
                  <Link className="btn secondary" href={inboxHref} prefetch={false}>
                    Open Inbox
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {repliesNeeded.map((lead) => {
                  const leadLabel = getLeadLabel(lead);
                  return (
                    <li key={lead.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link
                          className="dashboard-list-link"
                          href={withOrgQuery(`/app/jobs/${lead.id}?tab=messages`, scope.orgId, scope.internalUser)}
                          prefetch={false}
                        >
                          {leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone="warn">Needs reply</StatusPill>
                          <span>{lead.phoneE164}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">
                        {lead.lastInboundAt ? formatDateLabel(lead.lastInboundAt) : "Now"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>

          <PanelCard
            eyebrow="Follow-ups"
            title="Leads to work before the day ends"
            subtitle="Calls, texts, and reminders that should not slip."
            actionHref={inboxHref}
            actionLabel="Work Queue"
          >
            {followUpsToWork.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No follow-ups due right now.</strong>
                <p className="muted">Anything due later today will show here as it comes up.</p>
              </div>
            ) : (
              <ul className="dashboard-list">
                {followUpsToWork.map((lead) => {
                  const leadLabel = getLeadLabel(lead);
                  const leadCity = normalizeLeadCity(lead.city);
                  return (
                    <li key={lead.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link
                          className="dashboard-list-link"
                          href={withOrgQuery(`/app/jobs/${lead.id}?tab=messages`, scope.orgId, scope.internalUser)}
                          prefetch={false}
                        >
                          {leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone={lead.priority === "HIGH" ? "warn" : "neutral"}>
                            {lead.priority.toLowerCase()}
                          </StatusPill>
                          <span>{leadCity || lead.phoneE164}</span>
                          {lead.nextFollowUpAt && isOverdueFollowUp(lead.nextFollowUpAt) ? (
                            <StatusPill tone="warn">Overdue</StatusPill>
                          ) : null}
                        </div>
                      </div>
                      <span className="dashboard-list-time">
                        {lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : "Today"}
                      </span>
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
