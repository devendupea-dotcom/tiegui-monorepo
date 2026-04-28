import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { deriveLeadBookingProjection } from "@/lib/booking-read-model";
import { getRequestTranslator } from "@/lib/i18n";
import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import { blockLeadAsSpam } from "@/lib/lead-spam";
import {
  getLeadSpamReviewByLead,
  type LeadSpamReviewSnapshot,
} from "@/lib/lead-spam-review";
import {
  normalizeLeadCity,
  resolveLeadLocationLabel,
} from "@/lib/lead-location";
import {
  operationalJobCandidateSelect,
  selectReusableOperationalJobCandidate,
} from "@/lib/operational-jobs";
import { prisma } from "@/lib/prisma";
import {
  formatDateTime,
  isOverdueFollowUp,
  leadPriorityOptions,
  leadStatusOptions,
} from "@/lib/hq";
import {
  getContractorWorkflowTone,
  resolveContractorWorkflow,
  resolveContractorWorkflowActionTarget,
} from "@/lib/contractor-workflow";
import { shouldRouteLeadToSpamReview } from "@/lib/lead-spam-lane";
import { StatusPill } from "../dashboard-ui";
import {
  getParam,
  requireAppOrgActor,
  isOpenJobStatus,
  resolveAppScope,
  withOrgQuery,
} from "../_lib/portal-scope";
import {
  isWorkerScopedPageViewer,
  requireAppPageViewer,
} from "../_lib/portal-viewer";

export const dynamic = "force-dynamic";

function isLeadStatus(
  value: string,
): value is (typeof leadStatusOptions)[number] {
  return leadStatusOptions.some((option) => option === value);
}

function isLeadPriority(
  value: string,
): value is (typeof leadPriorityOptions)[number] {
  return leadPriorityOptions.some((option) => option === value);
}

type JobsLane = "pipeline" | "spam" | "all";

function isJobsLane(value: string): value is JobsLane {
  return value === "pipeline" || value === "spam" || value === "all";
}

function appendQuery(path: string, key: string, value: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function getSafeJobsReturnPath(rawValue: string, fallback: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("/app/jobs")) {
    return trimmed;
  }
  return fallback;
}

async function requireLeadListActionAccess(formData: FormData) {
  const leadId = String(formData.get("leadId") || "").trim();
  const orgId = String(formData.get("orgId") || "").trim();

  if (!leadId || !orgId) {
    redirect("/app/jobs");
  }

  const actor = await requireAppOrgActor("/app/jobs", orgId);
  const fallbackReturn = withOrgQuery("/app/jobs?lane=spam&openOnly=0", orgId, actor.internalUser);
  const returnPath = getSafeJobsReturnPath(
    String(formData.get("returnPath") || ""),
    fallbackReturn,
  );

  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    redirect(returnPath);
  }

  if (!actor.internalUser && actor.calendarAccessRole === "WORKER") {
    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: leadId,
        orgId,
        OR: [
          { assignedToUserId: actor.id },
          { createdByUserId: actor.id },
          { events: { some: { assignedToUserId: actor.id } } },
          {
            events: {
              some: {
                workerAssignments: { some: { workerUserId: actor.id } },
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      redirect(returnPath);
    }
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, orgId },
    select: {
      id: true,
      orgId: true,
      phoneE164: true,
    },
  });

  if (!lead) {
    redirect(returnPath);
  }

  return { actor, lead, returnPath, internalUser: actor.internalUser };
}

async function blockSpamLeadFromListAction(formData: FormData) {
  "use server";

  const scoped = await requireLeadListActionAccess(formData);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await blockLeadAsSpam(tx, {
      orgId: scoped.lead.orgId,
      leadId: scoped.lead.id,
      phoneE164: scoped.lead.phoneE164,
      userId: scoped.actor.id ?? null,
      at: now,
      blockedCallerReason: "Blocked from Leads spam review as spam or junk lead.",
      noteBody:
        "[Spam] Caller blocked from Leads spam review. Future auto-text and forwarding should stay suppressed.",
    });
  });

  revalidatePath(`/app/jobs/${scoped.lead.id}`);
  revalidatePath("/app/jobs");
  revalidatePath("/app/inbox");

  redirect(appendQuery(scoped.returnPath, "saved", "spam-blocked"));
}

export default async function JobsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const status = getParam(searchParams?.status);
  const priority = getParam(searchParams?.priority);
  const requestedLane = getParam(searchParams?.lane);
  const lane: JobsLane = isJobsLane(requestedLane) ? requestedLane : "pipeline";
  const openOnly =
    getParam(searchParams?.openOnly) || (lane === "spam" ? "0" : "1");
  const saved = getParam(searchParams?.saved);

  const scope = await resolveAppScope({
    nextPath: "/app/jobs",
    requestedOrgId,
  });
  if (!scope.onboardingComplete) {
    return (
      <section className="card">
        <h2>{t("jobs.title")}</h2>
        <div className="portal-empty-state">
          <strong>{t("jobs.onboardingEmptyTitle")}</strong>
          <p className="muted">{t("jobs.onboardingEmptyBody")}</p>
          <div className="portal-empty-actions">
            <Link
              className="btn primary"
              href={withOrgQuery(
                "/app?quickAdd=1",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {t("buttons.addLead")}
            </Link>
            <Link
              className="btn secondary"
              href={withOrgQuery(
                "/app/onboarding?step=1",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {t("buttons.finishOnboarding")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const viewer = await requireAppPageViewer({
    nextPath: "/app/jobs",
    orgId: scope.orgId,
  });
  const workerScoped = isWorkerScopedPageViewer(viewer);
  const workerId = workerScoped ? viewer.id : null;

  const where: Prisma.LeadWhereInput = {
    orgId: scope.orgId,
    ...(workerScoped
      ? {
          OR: [
            { assignedToUserId: workerId! },
            { createdByUserId: workerId! },
            { events: { some: { assignedToUserId: workerId! } } },
            {
              events: {
                some: {
                  workerAssignments: { some: { workerUserId: workerId! } },
                },
              },
            },
          ],
        }
      : {}),
  };

  if (isLeadStatus(status) && status !== "BOOKED") {
    where.status = status;
  }

  if (isLeadPriority(priority)) {
    where.priority = priority;
  }

  const jobs = await prisma.lead.findMany({
    where,
    select: {
      id: true,
      status: true,
      priority: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      city: true,
      intakeLocationText: true,
      businessType: true,
      nextFollowUpAt: true,
      updatedAt: true,
      customer: {
        select: {
          addressLine: true,
        },
      },
      events: {
        where: {
          type: {
            in: ["JOB", "ESTIMATE"],
          },
        },
        select: {
          id: true,
          jobId: true,
          type: true,
          status: true,
          startAt: true,
          endAt: true,
          createdAt: true,
          updatedAt: true,
          addressLine: true,
        },
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
        take: 12,
      },
      invoices: {
        select: {
          id: true,
          status: true,
          balanceDue: true,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 3,
      },
      estimates: {
        select: {
          id: true,
          status: true,
        },
        where: {
          archivedAt: null,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 4,
      },
      messages: {
        select: {
          direction: true,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
      },
      jobs: {
        select: operationalJobCandidateSelect,
        orderBy: [{ updatedAt: "desc" }],
        take: 12,
      },
      _count: {
        select: {
          leadNotes: true,
          leadPhotos: true,
          measurements: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  const spamReviewByLead =
    jobs.length > 0
      ? await getLeadSpamReviewByLead({
          orgId: scope.orgId,
          leads: jobs.map((job) => ({
            leadId: job.id,
            phoneE164: job.phoneE164,
          })),
        })
      : new Map<string, LeadSpamReviewSnapshot>();

  const routeToSpamReview = (job: {
    potentialSpam: boolean;
    failedOutboundCount: number;
  }) =>
    shouldRouteLeadToSpamReview({
      potentialSpam: job.potentialSpam,
      failedOutboundCount: job.failedOutboundCount,
    });

  const buildJobsHref = (overrides: Partial<Record<"status" | "priority" | "openOnly" | "lane", string>>) => {
    const params = new URLSearchParams();
    const nextFilters = {
      status,
      priority,
      openOnly,
      lane,
      ...overrides,
    };

    for (const [key, value] of Object.entries(nextFilters)) {
      if (value) {
        params.set(key, value);
      }
    }

    const query = params.toString();
    return withOrgQuery(
      `/app/jobs${query ? `?${query}` : ""}`,
      scope.orgId,
      scope.internalUser,
    );
  };
  const hydratedJobs = jobs.map((job) => {
    const bookingProjection = deriveLeadBookingProjection({
      leadStatus: job.status,
      events: job.events,
      jobs: job.jobs,
    });
    const locationLabel =
      resolveLeadLocationLabel({
        eventAddressLine:
          bookingProjection.activeBookingEvent?.addressLine || null,
        customerAddressLine: job.customer?.addressLine,
        intakeLocationText: job.intakeLocationText,
        city: job.city,
      }) ||
      normalizeLeadCity(job.city) ||
      "-";
    const workTypeLabel = sanitizeLeadBusinessTypeLabel(job.businessType);
    const operationalJob =
      (bookingProjection.linkedOperationalJobId
        ? job.jobs.find(
            (candidate) =>
              candidate.id === bookingProjection.linkedOperationalJobId,
          ) || null
        : null) ||
      selectReusableOperationalJobCandidate({
        candidates: job.jobs,
        preferredJobId: bookingProjection.linkedOperationalJobId,
      });
    const latestEstimate =
      job.estimates.find((estimate) => estimate.status !== "CONVERTED") ||
      job.estimates[0] ||
      null;
    const latestInvoice = job.invoices[0] || null;
    const spamReview = spamReviewByLead.get(job.id);
    const overviewHref = withOrgQuery(
      `/app/jobs/${job.id}`,
      scope.orgId,
      scope.internalUser,
    );
    const operationalJobHref = operationalJob?.id
      ? withOrgQuery(
          `/app/jobs/records/${operationalJob.id}`,
          scope.orgId,
          scope.internalUser,
        )
      : null;
    const workflow = resolveContractorWorkflow({
      hasMessagingWorkspace: job.messages.length > 0,
      latestMessageDirection: job.messages[0]?.direction || null,
      nextFollowUpAt: bookingProjection.hasActiveBooking
        ? null
        : job.nextFollowUpAt,
      latestEstimateStatus: latestEstimate?.status || null,
      hasScheduledJob: bookingProjection.hasActiveBooking,
      hasOperationalJob: Boolean(operationalJob?.id),
      hasLatestInvoice: Boolean(latestInvoice),
      hasOpenInvoice: job.invoices.some((invoice) => invoice.balanceDue.gt(0)),
      latestInvoicePaid: Boolean(
        latestInvoice && latestInvoice.balanceDue.lte(0),
      ),
    });
    const workflowAction = resolveContractorWorkflowActionTarget({
      action: workflow.nextAction,
      messagesHref: withOrgQuery(
        `/app/jobs/${job.id}?tab=messages`,
        scope.orgId,
        scope.internalUser,
      ),
      phoneHref: job.phoneE164 ? `tel:${job.phoneE164}` : null,
      createEstimateHref: withOrgQuery(
        `/app/estimates?create=1&leadId=${encodeURIComponent(job.id)}`,
        scope.orgId,
        scope.internalUser,
      ),
      latestEstimateHref: latestEstimate
        ? withOrgQuery(
            `/app/estimates/${latestEstimate.id}`,
            scope.orgId,
            scope.internalUser,
          )
        : null,
      scheduleCalendarHref: withOrgQuery(
        `/app/calendar?quickAction=schedule&leadId=${encodeURIComponent(job.id)}`,
        scope.orgId,
        scope.internalUser,
      ),
      operationalJobHref,
      invoiceHref: withOrgQuery(
        `/app/jobs/${job.id}?tab=invoice`,
        scope.orgId,
        scope.internalUser,
      ),
      overviewHref,
    });

    return {
      ...job,
      status: bookingProjection.derivedLeadStatus,
      nextFollowUpAt: bookingProjection.hasActiveBooking
        ? null
        : job.nextFollowUpAt,
      locationLabel,
      workTypeLabel,
      operationalJobId: operationalJob?.id || null,
      workflow,
      workflowAction,
      overviewHref,
      operationalJobHref,
      potentialSpam: Boolean(spamReview?.potentialSpam),
      potentialSpamSignals: spamReview?.potentialSpamSignals || [],
      failedOutboundCount: spamReview?.failedOutboundCount || 0,
    };
  });

  const pipelineCount = hydratedJobs.filter(
    (job) => !routeToSpamReview(job),
  ).length;
  const spamReviewCount = hydratedJobs.filter((job) =>
    routeToSpamReview(job),
  ).length;
  const allCount = hydratedJobs.length;

  const visibleJobs = hydratedJobs.filter((job) => {
    const spamReview = routeToSpamReview(job);
    if (isLeadStatus(status) && job.status !== status) {
      return false;
    }
    if (openOnly === "1" && !isOpenJobStatus(job.status)) {
      return false;
    }
    if (lane === "pipeline" && spamReview) {
      return false;
    }
    if (lane === "spam" && !spamReview) {
      return false;
    }
    return true;
  });

  const hasAnyLeads = hydratedJobs.length > 0;

  const statusLabel = (value: string) =>
    t(`status.${value.toLowerCase()}` as never);
  const priorityLabel = (value: string) =>
    t(`priority.${value.toLowerCase()}` as never);

  return (
    <>
      <section className="card">
        <h2>{t("jobs.title")}</h2>
        <p className="muted">{t("jobs.subtitle")}</p>
        {saved === "spam-deleted" ? (
          <p className="form-status">
            {t("jobs.spamDeleted")}
          </p>
        ) : saved === "spam-blocked" ? (
          <p className="form-status">{t("jobs.spamBlocked")}</p>
        ) : null}
        <div className="portal-empty-actions" style={{ marginTop: 12 }}>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/jobs/records",
              scope.orgId,
              scope.internalUser,
            )}
          >
            {t("jobs.openStructuredRecords")}
          </Link>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/jobs/records/costing",
              scope.orgId,
              scope.internalUser,
            )}
          >
            {t("jobs.openJobCosting")}
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {t("jobs.pipelineNote")}
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          {t("jobs.operationsNote")}
        </p>
        <div className="portal-empty-actions" style={{ marginTop: 12 }}>
          <Link
            className={`btn ${lane === "pipeline" ? "primary" : "secondary"}`}
            href={buildJobsHref({
              lane: "pipeline",
              openOnly: "1",
            })}
          >
            {t("jobs.lanes.pipeline")} ({pipelineCount})
          </Link>
          <Link
            className={`btn ${lane === "spam" ? "primary" : "secondary"}`}
            href={buildJobsHref({
              lane: "spam",
              openOnly: "0",
            })}
          >
            {t("jobs.lanes.spam")} ({spamReviewCount})
          </Link>
          <Link
            className={`btn ${lane === "all" ? "primary" : "secondary"}`}
            href={buildJobsHref({
              lane: "all",
            })}
          >
            {t("jobs.lanes.all")} ({allCount})
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {lane === "spam"
            ? t("jobs.laneHelp.spam")
            : lane === "all"
              ? t("jobs.laneHelp.all")
              : t("jobs.laneHelp.pipeline")}
        </p>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          {scope.internalUser ? (
            <input type="hidden" name="orgId" value={scope.orgId} />
          ) : null}
          <input type="hidden" name="lane" value={lane} />
          <label>
            {t("jobs.statusLabel")}
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {leadStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("jobs.priorityLabel")}
            <select name="priority" defaultValue={priority}>
              <option value="">All</option>
              {leadPriorityOptions.map((option) => (
                <option key={option} value={option}>
                  {priorityLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("jobs.openOnlyLabel")}
            <select name="openOnly" defaultValue={openOnly}>
              <option value="1">{t("jobs.yes")}</option>
              <option value="0">{t("jobs.no")}</option>
            </select>
          </label>

          <button className="btn primary" type="submit">
            {t("jobs.apply")}
          </button>
          <Link
            className="btn secondary"
            href={buildJobsHref({
              status: "",
              priority: "",
              lane: "pipeline",
              openOnly: "1",
            })}
          >
            {t("jobs.reset")}
          </Link>
        </form>
      </section>

      <section className="card">
        {visibleJobs.length === 0 ? (
          <div className="portal-empty-state">
            <strong>
              {hasAnyLeads
                ? lane === "spam"
                  ? t("jobs.emptySpamTitle")
                  : t("jobs.emptyFilteredTitle")
                : t("jobs.onboardingEmptyTitle")}
            </strong>
            <p className="muted">
              {hasAnyLeads
                ? lane === "spam"
                  ? t("jobs.emptySpamBody")
                  : t("jobs.emptyFilteredBody")
                : t("jobs.onboardingEmptyBody")}
            </p>
            <div className="portal-empty-actions">
              <Link
                className="btn primary"
                href={withOrgQuery(
                  "/app?quickAdd=1",
                  scope.orgId,
                  scope.internalUser,
                )}
              >
                {t("buttons.addLead")}
              </Link>
              <Link
                className="btn secondary"
                href={withOrgQuery(
                  "/app/inbox",
                  scope.orgId,
                  scope.internalUser,
                )}
              >
                {t("jobs.openInbox")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {visibleJobs.map((job) => {
                return (
                  <li key={job.id} className="mobile-list-card">
                    <div className="stack-cell">
                      <Link className="table-link" href={job.overviewHref}>
                        {job.contactName || job.businessName || job.phoneE164}
                      </Link>
                      <span className="muted">{job.phoneE164}</span>
                    </div>
                    <div className="quick-meta">
                      <span
                        className={`badge status-${job.status.toLowerCase()}`}
                      >
                        {statusLabel(job.status)}
                      </span>
                      <span
                        className={`badge priority-${job.priority.toLowerCase()}`}
                      >
                        {priorityLabel(job.priority)}
                      </span>
                      <StatusPill
                        tone={getContractorWorkflowTone(
                          job.workflow.attentionLevel,
                        )}
                      >
                        {job.workflow.stageLabel}
                      </StatusPill>
                      {job.invoices[0] ? (
                        <span
                          className={`badge status-${job.invoices[0].status.toLowerCase()}`}
                        >
                          {statusLabel(job.invoices[0].status)}
                        </span>
                      ) : (
                        <span className="badge">{t("jobs.noInvoice")}</span>
                      )}
                      {routeToSpamReview(job) ? (
                        <span className="badge status-overdue">
                          {t("jobs.spamReviewBadge")}
                        </span>
                      ) : null}
                      {job.failedOutboundCount > 0 ? (
                        <span className="badge">
                          {t("jobs.failedSmsCount", {
                            count: job.failedOutboundCount,
                          })}
                        </span>
                      ) : null}
                    </div>
                    <div className="stack-cell">
                      <span className="muted">
                        {t("jobs.notesCount", { count: job._count.leadNotes })}{" "}
                        •{" "}
                        {t("jobs.photosCount", {
                          count: job._count.leadPhotos,
                        })}{" "}
                        •{" "}
                        {t("jobs.measurementsCount", {
                          count: job._count.measurements,
                        })}
                      </span>
                      <span className="muted">
                        {job.locationLabel} • {job.workTypeLabel || "-"}
                      </span>
                      <span className="muted">
                        Next: {job.workflow.nextAction.label}
                      </span>
                      <span className="muted">
                        {t("jobs.updatedLabel", {
                          value: formatDateTime(job.updatedAt),
                        })}
                      </span>
                      {job.nextFollowUpAt ? (
                        <>
                          <span className="muted">
                            {t("jobs.followUpLabel", {
                              value: formatDateTime(job.nextFollowUpAt),
                            })}
                          </span>
                          {isOverdueFollowUp(job.nextFollowUpAt) ? (
                            <span className="overdue-chip">
                              {t("jobs.overdue")}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="mobile-list-card-actions">
                      {job.workflowAction.external ? (
                        <a
                          className="btn primary"
                          href={job.workflowAction.href}
                        >
                          {job.workflow.nextAction.label}
                        </a>
                      ) : (
                        <Link
                          className="btn primary"
                          href={job.workflowAction.href}
                        >
                          {job.workflow.nextAction.label}
                        </Link>
                      )}
                      <Link className="btn secondary" href={job.overviewHref}>
                        {t("buttons.openCrmFolder")}
                      </Link>
                      {job.operationalJobHref ? (
                        <Link
                          className="btn secondary"
                          href={job.operationalJobHref}
                        >
                          {t("buttons.openOperationalJob")}
                        </Link>
                      ) : null}
                      {routeToSpamReview(job) ? (
                        <>
                          <Link
                            className="btn secondary"
                            href={withOrgQuery(
                              `/app/inbox?leadId=${encodeURIComponent(job.id)}`,
                              scope.orgId,
                              scope.internalUser,
                            )}
                          >
                            {t("jobs.openConversation")}
                          </Link>
                          <form action={blockSpamLeadFromListAction}>
                            <input type="hidden" name="leadId" value={job.id} />
                            <input
                              type="hidden"
                              name="orgId"
                              value={scope.orgId}
                            />
                            <input
                              type="hidden"
                              name="returnPath"
                              value={buildJobsHref({})}
                            />
                            <button
                              className="btn secondary"
                              type="submit"
                              style={{
                                borderColor: "#b91c1c",
                                color: "#b91c1c",
                              }}
                            >
                              {t("jobs.blockSpam")}
                            </button>
                          </form>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="table-wrap desktop-table-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("jobs.table.job")}</th>
                    <th>{t("jobs.table.status")}</th>
                    <th>{t("jobs.table.priority")}</th>
                    <th>{t("jobs.table.invoice")}</th>
                    <th>{t("jobs.table.folderData")}</th>
                    <th>{t("jobs.table.city")}</th>
                    <th>{t("jobs.table.type")}</th>
                    <th>{t("jobs.table.nextStep")}</th>
                    <th>{t("jobs.table.updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => {
                    return (
                      <tr key={job.id}>
                        <td>
                          <Link className="table-link" href={job.overviewHref}>
                            {job.contactName ||
                              job.businessName ||
                              job.phoneE164}
                          </Link>
                          <div className="muted" style={{ marginTop: 4 }}>
                            {t("jobs.workspaceCrm")}
                          </div>
                          {routeToSpamReview(job) ? (
                            <div
                              className="portal-empty-actions"
                              style={{ marginTop: 8 }}
                            >
                              <Link
                                className="btn secondary"
                                href={withOrgQuery(
                                  `/app/inbox?leadId=${encodeURIComponent(job.id)}`,
                                  scope.orgId,
                                  scope.internalUser,
                                )}
                              >
                                {t("jobs.openConversation")}
                              </Link>
                              <form action={blockSpamLeadFromListAction}>
                                <input
                                  type="hidden"
                                  name="leadId"
                                  value={job.id}
                                />
                                <input
                                  type="hidden"
                                  name="orgId"
                                  value={scope.orgId}
                                />
                                <input
                                  type="hidden"
                                  name="returnPath"
                                  value={buildJobsHref({})}
                                />
                                <button
                                  className="btn secondary"
                                  type="submit"
                                  style={{
                                    borderColor: "#b91c1c",
                                    color: "#b91c1c",
                                  }}
                                >
                                  {t("jobs.blockSpam")}
                                </button>
                              </form>
                            </div>
                          ) : null}
                          {job.operationalJobHref ? (
                            <div style={{ marginTop: 6 }}>
                              <Link
                                className="table-link"
                                href={job.operationalJobHref}
                              >
                                {t("jobs.workspaceOperational")}
                              </Link>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`badge status-${job.status.toLowerCase()}`}
                          >
                            {statusLabel(job.status)}
                          </span>
                          {routeToSpamReview(job) ? (
                            <span
                              className="badge status-overdue"
                              style={{ marginLeft: 6 }}
                            >
                              {t("jobs.spamReviewBadge")}
                            </span>
                          ) : null}
                          {job.failedOutboundCount > 0 ? (
                            <div className="muted" style={{ marginTop: 6 }}>
                              {t("jobs.failedSmsCount", {
                                count: job.failedOutboundCount,
                              })}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`badge priority-${job.priority.toLowerCase()}`}
                          >
                            {priorityLabel(job.priority)}
                          </span>
                        </td>
                        <td>
                          {job.invoices[0] ? (
                            <span
                              className={`badge status-${job.invoices[0].status.toLowerCase()}`}
                            >
                              {statusLabel(job.invoices[0].status)}
                            </span>
                          ) : (
                            <span className="badge">{t("jobs.noInvoice")}</span>
                          )}
                        </td>
                        <td>
                          <div className="stack-cell">
                            <span className="muted">
                              {t("jobs.notesCount", {
                                count: job._count.leadNotes,
                              })}
                            </span>
                            <span className="muted">
                              {t("jobs.photosCount", {
                                count: job._count.leadPhotos,
                              })}
                            </span>
                            <span className="muted">
                              {t("jobs.measurementsCount", {
                                count: job._count.measurements,
                              })}
                            </span>
                          </div>
                        </td>
                        <td>{job.locationLabel}</td>
                        <td>{job.workTypeLabel || "-"}</td>
                        <td>
                          <div className="stack-cell">
                            <StatusPill
                              tone={getContractorWorkflowTone(
                                job.workflow.attentionLevel,
                              )}
                            >
                              {job.workflow.stageLabel}
                            </StatusPill>
                            {job.workflowAction.external ? (
                              <a
                                className="table-link"
                                href={job.workflowAction.href}
                              >
                                {job.workflow.nextAction.label}
                              </a>
                            ) : (
                              <Link
                                className="table-link"
                                href={job.workflowAction.href}
                              >
                                {job.workflow.nextAction.label}
                              </Link>
                            )}
                            {job.nextFollowUpAt ? (
                              <span className="muted">
                                {t("jobs.followUpLabel", {
                                  value: formatDateTime(job.nextFollowUpAt),
                                })}
                              </span>
                            ) : null}
                            {job.nextFollowUpAt &&
                            isOverdueFollowUp(job.nextFollowUpAt) ? (
                              <span className="overdue-chip">
                                {t("jobs.overdue")}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>{formatDateTime(job.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
