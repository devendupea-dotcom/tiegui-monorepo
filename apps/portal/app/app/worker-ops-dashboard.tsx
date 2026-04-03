import Link from "next/link";
import { addDays, endOfDay, startOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import type { AnalyticsViewer } from "@/lib/portal-analytics";
import { getPortalSummaryMetrics } from "@/lib/portal-analytics";
import { prisma } from "@/lib/prisma";
import type { AppScope } from "./_lib/portal-scope";
import { withOrgQuery } from "./_lib/portal-scope";
import { KpiCard, PanelCard, StatusPill } from "./dashboard-ui";

type WorkerOpsDashboardProps = {
  scope: AppScope;
  viewer: AnalyticsViewer;
};

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

function formatTimeLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default async function WorkerOpsDashboard({ scope, viewer }: WorkerOpsDashboardProps) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const nextWeek = addDays(todayStart, 7);
  const leadScope = buildWorkerLeadScope(viewer.id);
  const eventScope = buildWorkerEventScope(viewer.id);

  const [workerSummary, assignedJobsCount, todayScheduleCount, nextJob, upcomingJobs, conversationCandidates] = await Promise.all([
    getPortalSummaryMetrics({ viewer, range: "7d" }),
    prisma.event.count({
      where: {
        orgId: scope.orgId,
        type: "JOB",
        status: { not: "CANCELLED" },
        startAt: {
          gte: now,
          lt: nextWeek,
        },
        ...eventScope,
      },
    }),
    prisma.event.count({
      where: {
        orgId: scope.orgId,
        type: "JOB",
        status: { not: "CANCELLED" },
        startAt: {
          gte: todayStart,
          lte: todayEnd,
        },
        ...eventScope,
      },
    }),
    prisma.event.findFirst({
      where: {
        orgId: scope.orgId,
        type: "JOB",
        status: { not: "CANCELLED" },
        startAt: {
          gte: now,
        },
        ...eventScope,
      },
      orderBy: [{ startAt: "asc" }],
      select: {
        id: true,
        startAt: true,
        addressLine: true,
        customerName: true,
        leadId: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
    }),
    prisma.event.findMany({
      where: {
        orgId: scope.orgId,
        type: "JOB",
        status: { not: "CANCELLED" },
        startAt: {
          gte: now,
          lt: nextWeek,
        },
        ...eventScope,
      },
      orderBy: [{ startAt: "asc" }],
      take: 5,
      select: {
        id: true,
        startAt: true,
        status: true,
        addressLine: true,
        customerName: true,
        leadId: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: {
        orgId: scope.orgId,
        lastInboundAt: { not: null },
        ...leadScope,
      },
      orderBy: [{ lastInboundAt: "desc" }],
      take: 40,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        lastInboundAt: true,
        lastOutboundAt: true,
      },
    }),
  ]);

  const repliesNeeded = conversationCandidates.filter(
    (lead) => lead.lastInboundAt && (!lead.lastOutboundAt || lead.lastOutboundAt < lead.lastInboundAt),
  );

  const quickLeadHref = withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser);
  const addJobHref = withOrgQuery("/app/calendar?quickAction=schedule", scope.orgId, scope.internalUser);
  const inboxHref = withOrgQuery("/app/inbox", scope.orgId, scope.internalUser);
  const calendarHref = withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);

  const nextJobLabel =
    nextJob?.customerName || nextJob?.lead?.contactName || nextJob?.lead?.businessName || nextJob?.lead?.phoneE164 || "—";
  const nextJobHint = nextJob
    ? `${nextJob.addressLine || "Address not added yet"}`
    : "No assigned job yet";

  return (
    <div className="dashboard-shell">
      <section className="card dashboard-header">
        <div className="dashboard-header-main">
          <div className="dashboard-header-copy">
            <span className="dashboard-header-eyebrow">Crew view</span>
            <h1>Ops Dashboard</h1>
            <p className="muted">Your jobs, reply queue, and open capacity for {scope.orgName} in one clean workspace.</p>
          </div>
          <div className="dashboard-actions">
            <Link className="btn primary" href={quickLeadHref}>
              + New Lead
            </Link>
            <Link className="btn secondary" href={addJobHref}>
              + Add Job
            </Link>
            <Link className="btn secondary" href={inboxHref}>
              Inbox
            </Link>
          </div>
        </div>
        <div className="dashboard-header-band">
          <article className="dashboard-header-stat">
            <span>Today</span>
            <strong>{todayScheduleCount.toLocaleString("en-US")}</strong>
            <small>Jobs on your calendar today</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Next stop</span>
            <strong>{nextJob ? formatTimeLabel(nextJob.startAt) : "—"}</strong>
            <small>{nextJob ? nextJobLabel : "Nothing assigned yet"}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Reply queue</span>
            <strong>{repliesNeeded.length.toLocaleString("en-US")}</strong>
            <small>{repliesNeeded.length > 0 ? "Customers waiting on you" : "Inbox is clear"}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Open slots</span>
            <strong>{workerSummary.openSlotsNext7Days.toLocaleString("en-US")}</strong>
            <small>Available over the next 7 days</small>
          </article>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <KpiCard
          label="Assigned jobs"
          value={assignedJobsCount.toLocaleString("en-US")}
          hint="Next 7 days"
          href={calendarHref}
        />
        <KpiCard
          label="Today’s schedule"
          value={todayScheduleCount.toLocaleString("en-US")}
          hint="Jobs on the calendar today"
          href={calendarHref}
        />
        <KpiCard
          label="Messages needing reply"
          value={repliesNeeded.length.toLocaleString("en-US")}
          hint={repliesNeeded.length > 0 ? "Customers waiting on you" : "Inbox is clear"}
          href={inboxHref}
        />
        <KpiCard
          label="Open slots"
          value={workerSummary.openSlotsNext7Days.toLocaleString("en-US")}
          hint="Available in the next 7 days"
          href={calendarHref}
        />
      </section>

      <section className="dashboard-main-grid worker">
        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Assigned Jobs"
            title="Your next 7 days"
            subtitle="The jobs you need to keep moving."
            actionHref={calendarHref}
            actionLabel="Open Calendar"
          >
            <div className="dashboard-ops-highlight">
              <span className="dashboard-inline-label">Next job</span>
              <strong>{nextJob ? formatTimeLabel(nextJob.startAt) : "Nothing assigned yet"}</strong>
              <p className="muted">{nextJob ? `${nextJobLabel} • ${nextJobHint}` : "Your next scheduled stop will show here."}</p>
            </div>
            {upcomingJobs.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No jobs scheduled.</strong>
                <p className="muted">Add your first job to get started.</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={addJobHref}>
                    Add your first job
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {upcomingJobs.map((job) => {
                  const jobLabel = job.customerName || job.lead?.contactName || job.lead?.businessName || job.lead?.phoneE164 || "Scheduled job";
                  const targetHref = job.leadId
                    ? withOrgQuery(`/app/jobs/${job.leadId}`, scope.orgId, scope.internalUser)
                    : calendarHref;
                  return (
                    <li key={job.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={targetHref}>
                          {jobLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone="neutral">{job.status.replaceAll("_", " ").toLowerCase()}</StatusPill>
                          <span>{job.addressLine || "Address not added yet"}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatTimeLabel(job.startAt)}</span>
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
            title="Messages waiting on you"
            subtitle="Stay on top of the conversations that still need a response."
            actionHref={inboxHref}
            actionLabel="Go to Inbox"
          >
            {repliesNeeded.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No replies needed.</strong>
                <p className="muted">Customer messages will appear here when they need attention.</p>
                <div className="portal-empty-actions">
                  <Link className="btn secondary" href={inboxHref}>
                    Open Inbox
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {repliesNeeded.slice(0, 5).map((lead) => {
                  const leadLabel = lead.contactName || lead.businessName || lead.phoneE164;
                  return (
                    <li key={lead.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={withOrgQuery(`/app/jobs/${lead.id}?tab=messages`, scope.orgId, scope.internalUser)}>
                          {leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone="warn">Needs reply</StatusPill>
                          <span>{lead.phoneE164}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{lead.lastInboundAt ? formatDateLabel(lead.lastInboundAt) : "Now"}</span>
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
