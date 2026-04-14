import Link from "next/link";
import { addDays, endOfDay, startOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import type { AnalyticsViewer } from "@/lib/portal-analytics";
import { getRequestLocale, getRequestTranslator } from "@/lib/i18n";
import { translateStatusLabel } from "@/lib/i18n-labels";
import { getPortalSummaryMetrics } from "@/lib/portal-analytics";
import { prisma } from "@/lib/prisma";
import type { AppScope } from "./_lib/portal-scope";
import { withOrgQuery } from "./_lib/portal-scope";
import { KpiCard, PanelCard, StatusPill } from "./dashboard-ui";
import WorkflowGuidanceCard from "./workflow-guidance-card";

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

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatTimeLabel(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDateLabel(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default async function WorkerOpsDashboard({ scope, viewer }: WorkerOpsDashboardProps) {
  const t = await getRequestTranslator();
  const locale = getRequestLocale();
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
    nextJob?.customerName
    || nextJob?.lead?.contactName
    || nextJob?.lead?.businessName
    || nextJob?.lead?.phoneE164
    || t("dashboard.common.emptyValue");
  const nextJobHint = nextJob
    ? `${nextJob.addressLine || t("dashboard.common.addressMissing")}`
    : t("dashboard.worker.assignedJobs.nextJobEmptyHint");

  return (
    <div className="dashboard-shell">
      <section className="card dashboard-header">
        <div className="dashboard-header-main">
          <div className="dashboard-header-copy">
            <span className="dashboard-header-eyebrow">{t("dashboard.worker.header.eyebrow")}</span>
            <h1>{t("dashboard.worker.header.title")}</h1>
            <p className="muted">{t("dashboard.worker.header.subtitle", { orgName: scope.orgName })}</p>
          </div>
          <div className="dashboard-actions">
            <Link className="btn primary" href={quickLeadHref}>
              {t("dashboard.common.newLead")}
            </Link>
            <Link className="btn secondary" href={addJobHref}>
              {t("dashboard.common.addJob")}
            </Link>
            <Link className="btn secondary" href={inboxHref}>
              {t("dashboard.common.inbox")}
            </Link>
          </div>
        </div>
        <div className="dashboard-header-band">
          <article className="dashboard-header-stat">
            <span>{t("dashboard.worker.stats.todayLabel")}</span>
            <strong>{formatNumber(todayScheduleCount, locale)}</strong>
            <small>{t("dashboard.worker.stats.todayHint")}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>{t("dashboard.worker.stats.nextStopLabel")}</span>
            <strong>{nextJob ? formatTimeLabel(nextJob.startAt, locale) : t("dashboard.common.emptyValue")}</strong>
            <small>{nextJob ? nextJobLabel : t("dashboard.worker.stats.nextStopEmpty")}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>{t("dashboard.worker.stats.replyQueueLabel")}</span>
            <strong>{formatNumber(repliesNeeded.length, locale)}</strong>
            <small>{repliesNeeded.length > 0 ? t("dashboard.worker.stats.replyQueueHint") : t("dashboard.worker.stats.replyQueueClear")}</small>
          </article>
          <article className="dashboard-header-stat">
            <span>{t("dashboard.worker.stats.openSlotsLabel")}</span>
            <strong>{formatNumber(workerSummary.openSlotsNext7Days, locale)}</strong>
            <small>{t("dashboard.worker.stats.openSlotsHint")}</small>
          </article>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <KpiCard
          label={t("dashboard.worker.kpis.assignedJobsLabel")}
          value={formatNumber(assignedJobsCount, locale)}
          hint={t("dashboard.worker.kpis.assignedJobsHint")}
          href={calendarHref}
        />
        <KpiCard
          label={t("dashboard.worker.kpis.todayScheduleLabel")}
          value={formatNumber(todayScheduleCount, locale)}
          hint={t("dashboard.worker.kpis.todayScheduleHint")}
          href={calendarHref}
        />
        <KpiCard
          label={t("dashboard.worker.kpis.messagesNeedingReplyLabel")}
          value={formatNumber(repliesNeeded.length, locale)}
          hint={repliesNeeded.length > 0 ? t("dashboard.worker.kpis.messagesNeedingReplyHint") : t("dashboard.worker.kpis.messagesNeedingReplyClear")}
          href={inboxHref}
        />
        <KpiCard
          label={t("dashboard.worker.kpis.openSlotsLabel")}
          value={formatNumber(workerSummary.openSlotsNext7Days, locale)}
          hint={t("dashboard.worker.kpis.openSlotsHint")}
          href={calendarHref}
        />
      </section>

      <section className="dashboard-main-grid worker">
        <div className="dashboard-stack">
          <WorkflowGuidanceCard orgId={scope.orgId} internalUser={scope.internalUser} />

          <PanelCard
            eyebrow={t("dashboard.worker.assignedJobs.eyebrow")}
            title={t("dashboard.worker.assignedJobs.title")}
            subtitle={t("dashboard.worker.assignedJobs.subtitle")}
            actionHref={calendarHref}
            actionLabel={t("dashboard.worker.assignedJobs.action")}
          >
            <div className="dashboard-ops-highlight">
              <span className="dashboard-inline-label">{t("dashboard.worker.assignedJobs.nextJobLabel")}</span>
              <strong>{nextJob ? formatTimeLabel(nextJob.startAt, locale) : t("dashboard.worker.assignedJobs.nextJobEmpty")}</strong>
              <p className="muted">
                {nextJob ? `${nextJobLabel} • ${nextJobHint}` : t("dashboard.worker.assignedJobs.nextJobBody")}
              </p>
            </div>
            {upcomingJobs.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>{t("dashboard.worker.assignedJobs.emptyTitle")}</strong>
                <p className="muted">{t("dashboard.worker.assignedJobs.emptyBody")}</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={addJobHref}>
                    {t("dashboard.worker.assignedJobs.emptyAction")}
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {upcomingJobs.map((job) => {
                  const jobLabel =
                    job.customerName
                    || job.lead?.contactName
                    || job.lead?.businessName
                    || job.lead?.phoneE164
                    || t("dashboard.common.scheduledJob");
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
                          <StatusPill tone="neutral">{translateStatusLabel(job.status, t)}</StatusPill>
                          <span>{job.addressLine || t("dashboard.common.addressMissing")}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatTimeLabel(job.startAt, locale)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>
        </div>

        <div className="dashboard-stack">
          <PanelCard
            eyebrow={t("dashboard.worker.replyQueue.eyebrow")}
            title={t("dashboard.worker.replyQueue.title")}
            subtitle={t("dashboard.worker.replyQueue.subtitle")}
            actionHref={inboxHref}
            actionLabel={t("dashboard.worker.replyQueue.action")}
          >
            {repliesNeeded.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>{t("dashboard.worker.replyQueue.emptyTitle")}</strong>
                <p className="muted">{t("dashboard.worker.replyQueue.emptyBody")}</p>
                <div className="portal-empty-actions">
                  <Link className="btn secondary" href={inboxHref}>
                    {t("dashboard.worker.replyQueue.emptyAction")}
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
                          <StatusPill tone="warn">{t("dashboard.worker.replyQueue.needsReply")}</StatusPill>
                          <span>{lead.phoneE164}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">
                        {lead.lastInboundAt ? formatDateLabel(lead.lastInboundAt, locale) : t("dashboard.worker.replyQueue.now")}
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
