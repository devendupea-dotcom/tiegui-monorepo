import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import { dispatchStatusFromDb, formatDispatchDateKey, formatDispatchScheduledWindow, formatDispatchStatusLabel } from "@/lib/dispatch";
import { getDispatchCrewSettings } from "@/lib/dispatch-store";
import { buildInvoiceWorkerLeadAccessWhere, formatCurrency, formatInvoiceNumber } from "@/lib/invoices";
import { formatJobTrackingTimelineDateTime } from "@/lib/job-tracking-store";
import { getOperationalJobPageData } from "@/lib/operational-job-detail-store";
import { buildOperationalJobRemediationActions, getOperationalJobInboundResponseHandoff } from "@/lib/operational-job-remediation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel } from "@/lib/hq";
import { getParam, resolveAppScope, withOrgQuery } from "../../../_lib/portal-scope";
import { requireAppPageViewer } from "../../../_lib/portal-viewer";
import OperationalJobActionPanel from "./job-action-panel";

export const dynamic = "force-dynamic";

type PageProps = {
  params: {
    jobId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

function formatDateOnly(value: Date | null | undefined): string {
  if (!value) return "Unscheduled";
  return formatDateTimeForDisplay(value, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }, { timeZone: "UTC" });
}

function buildLeadLabel(
  lead:
    | {
        contactName: string | null;
        businessName: string | null;
        phoneE164: string;
      }
    | null
    | undefined,
): string | null {
  if (!lead) return null;
  return lead.contactName || lead.businessName || lead.phoneE164;
}

function buildWorkerLeadCandidateWhere(input: {
  customerId: string | null;
  leadIds: string[];
}): Prisma.LeadWhereInput | null {
  const clauses: Prisma.LeadWhereInput[] = [];

  if (input.leadIds.length > 0) {
    clauses.push({
      id: {
        in: input.leadIds,
      },
    });
  }

  if (input.customerId) {
    clauses.push({
      customerId: input.customerId,
    });
  }

  if (clauses.length === 0) {
    return null;
  }

  return clauses.length === 1 ? clauses[0] || null : { OR: clauses };
}

export default async function OperationalJobDetailPage({ params, searchParams }: PageProps) {
  if (!params.jobId) {
    notFound();
  }

  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: `/app/jobs/records/${params.jobId}`,
    requestedOrgId,
  });

  const viewer = await requireAppPageViewer({
    nextPath: `/app/jobs/records/${params.jobId}`,
    orgId: scope.orgId,
  });

  const detail = await getOperationalJobPageData({
    orgId: scope.orgId,
    jobId: params.jobId,
  });

  if (!detail) {
    if (scope.internalUser && !requestedOrgId) {
      const fallback = await prisma.job.findUnique({
        where: { id: params.jobId },
        select: { orgId: true },
      });

      if (fallback) {
        redirect(`/app/jobs/records/${params.jobId}?orgId=${encodeURIComponent(fallback.orgId)}`);
      }
    }

    notFound();
  }

  const workerLeadIds = [...new Set([
    detail.job.leadId,
    detail.job.sourceEstimate?.leadId || null,
    detail.job.linkedEstimate?.leadId || null,
  ].filter((value): value is string => Boolean(value)))];

  if (!viewer.internalUser && viewer.calendarAccessRole === "WORKER") {
    const candidateWhere = buildWorkerLeadCandidateWhere({
      customerId: detail.job.customerId,
      leadIds: workerLeadIds,
    });

    if (!candidateWhere) {
      notFound();
    }

    const workerAllowed = await prisma.lead.findFirst({
      where: {
        orgId: scope.orgId,
        AND: [candidateWhere, buildInvoiceWorkerLeadAccessWhere({ actorId: viewer.id })],
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      notFound();
    }
  }

  const job = detail.job;
  const canManage = viewer.internalUser || viewer.calendarAccessRole !== "READ_ONLY";
  const crewSettings = canManage ? await getDispatchCrewSettings(scope.orgId) : [];
  const crmLeadId = job.leadId || detail.linkedEstimates.find((estimate) => estimate.leadId)?.leadId || null;
  const customerPhone = job.customer?.phoneE164 || job.phone || job.lead?.phoneE164 || null;
  const customerAddress = job.customer?.addressLine || job.address || job.lead?.intakeLocationText || null;
  const leadLabel = buildLeadLabel(job.lead);
  const dispatchDateKey = detail.bookingProjection.scheduledDate ? formatDispatchDateKey(detail.bookingProjection.scheduledDate) : "";
  const dispatchStatus = dispatchStatusFromDb(job.dispatchStatus);
  const scheduleWindowLabel = detail.bookingProjection.hasBookingEvent
    ? formatDispatchScheduledWindow(detail.bookingProjection.scheduledStartTime, detail.bookingProjection.scheduledEndTime)
    : "No linked booking";
  const dispatchPath = withOrgQuery(
    `/app/dispatch${dispatchDateKey ? `?date=${encodeURIComponent(dispatchDateKey)}&jobId=${encodeURIComponent(job.id)}` : `?jobId=${encodeURIComponent(job.id)}`}`,
    scope.orgId,
    scope.internalUser,
  );
  const crmPath = crmLeadId ? withOrgQuery(`/app/jobs/${crmLeadId}`, scope.orgId, scope.internalUser) : null;
  const crmMessagesPath = crmLeadId ? withOrgQuery(`/app/jobs/${crmLeadId}?tab=messages`, scope.orgId, scope.internalUser) : null;
  const inboxThreadPath = crmLeadId ? withOrgQuery(`/app/inbox?leadId=${encodeURIComponent(crmLeadId)}`, scope.orgId, scope.internalUser) : null;
  const editPhonePath = crmLeadId
    ? withOrgQuery(`/app/inbox?leadId=${encodeURIComponent(crmLeadId)}&context=edit`, scope.orgId, scope.internalUser)
    : null;
  const settingsPath = withOrgQuery("/app/settings#settings-messaging", scope.orgId, scope.internalUser);
  const integrationsPath = withOrgQuery("/app/settings/integrations", scope.orgId, scope.internalUser);
  const costingPath = withOrgQuery(`/app/jobs/records/${job.id}/costing`, scope.orgId, scope.internalUser);
  const recordsPath = withOrgQuery("/app/jobs/records", scope.orgId, scope.internalUser);
  const remediationActions = buildOperationalJobRemediationActions({
    remediation: detail.dispatchCommunicationState.lastCustomerUpdate?.remediation || null,
    inboxThreadHref: inboxThreadPath,
    crmHref: crmPath,
    editPhoneHref: editPhonePath,
    callHref: customerPhone ? `tel:${customerPhone}` : null,
    settingsHref: settingsPath,
    integrationsHref: integrationsPath,
  });
  const inboundResponseHandoff = getOperationalJobInboundResponseHandoff({
    customerResponseType: detail.dispatchCommunicationState.lastCustomerUpdate?.customerResponseAfterSend?.type || null,
    inboxThreadHref: inboxThreadPath,
    crmHref: crmPath,
    callHref: customerPhone ? `tel:${customerPhone}` : null,
  });

  return (
    <div className="operational-job-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <Link className="table-link" href={recordsPath}>
              ← Back to Operational Jobs
            </Link>
            <h2>{job.customerName}</h2>
            <p className="muted">
              {job.serviceType || job.projectType} • {formatDateOnly(detail.bookingProjection.scheduledDate)}
            </p>
            <div className="quick-meta">
              <span className={`badge status-${dispatchStatus}`}>{formatDispatchStatusLabel(dispatchStatus)}</span>
              <span className="badge">{formatLabel(job.status)}</span>
              <span className="badge">{job.assignedCrew?.name || "Unassigned crew"}</span>
              {job.priority ? <span className="badge">Priority {formatLabel(job.priority)}</span> : null}
            </div>
          </div>

          <div className="quick-links">
            <Link className="btn primary" href={dispatchPath}>
              Open Dispatch
            </Link>
            {crmPath ? (
              <Link className="btn secondary" href={crmPath}>
                Open Lead
              </Link>
            ) : null}
            {crmMessagesPath ? (
              <Link className="btn secondary" href={crmMessagesPath}>
                Open Messages
              </Link>
            ) : null}
            <Link className="btn secondary" href={costingPath}>
              Open Costing
            </Link>
          </div>
        </div>
      </section>

      <div className="operational-job-grid">
        <section className="card">
          <div className="stack-cell">
            <h3>Customer Context</h3>
            <div className="dispatch-detail-grid">
              <div>
                <span className="muted">Customer</span>
                <strong>{job.customer?.name || job.customerName}</strong>
              </div>
              <div>
                <span className="muted">Phone</span>
                <strong>{customerPhone || "-"}</strong>
              </div>
              <div>
                <span className="muted">Address</span>
                <strong>{customerAddress || "-"}</strong>
              </div>
              <div>
                <span className="muted">Lead Workspace</span>
                <strong>{leadLabel || "Not linked"}</strong>
              </div>
              {job.customer?.email ? (
                <div>
                  <span className="muted">Email</span>
                  <strong>{job.customer.email}</strong>
                </div>
              ) : null}
              {job.lead?.businessType ? (
                <div>
                  <span className="muted">Requested Work</span>
                  <strong>{job.lead.businessType}</strong>
                </div>
              ) : null}
            </div>
            {job.notes ? (
              <div>
                <span className="muted">Operational Notes</span>
                <p>{job.notes}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="stack-cell">
            <h3>Current Status</h3>
            <div className="dispatch-detail-grid">
              <div>
                <span className="muted">Dispatch Status</span>
                <strong>{formatDispatchStatusLabel(dispatchStatus)}</strong>
              </div>
              <div>
                <span className="muted">Job Status</span>
                <strong>{formatLabel(job.status)}</strong>
              </div>
              <div>
                <span className="muted">Crew</span>
                <strong>{job.assignedCrew?.name || "Unassigned"}</strong>
              </div>
              <div>
                <span className="muted">Scheduled Window</span>
                <strong>{scheduleWindowLabel}</strong>
              </div>
              <div>
                <span className="muted">Updated</span>
                <strong>{formatDateTime(job.updatedAt)}</strong>
              </div>
              <div>
                <span className="muted">Created</span>
                <strong>{formatDateTime(job.createdAt)}</strong>
              </div>
            </div>

            <div className="quick-meta">
              <span className="badge">
                {detail.trackingSummary.hasActive ? "Active tracking link exists" : "No active tracking link"}
              </span>
              {detail.trackingSummary.latestCreatedAt ? (
                <span className="badge">Latest link {formatDateTime(detail.trackingSummary.latestCreatedAt)}</span>
              ) : null}
            </div>

            {canManage ? (
              <OperationalJobActionPanel
                jobId={job.id}
                initialDispatchStatus={dispatchStatus}
                initialJobStatus={job.status}
                initialCrewId={job.assignedCrew?.id || null}
                initialScheduledDate={detail.bookingProjection.scheduledDateKey || ""}
                initialScheduledStartTime={detail.bookingProjection.scheduledStartTime}
                initialScheduledEndTime={detail.bookingProjection.scheduledEndTime}
                canEditSchedule={detail.bookingProjection.hasActiveBooking}
                hasActiveBooking={detail.bookingProjection.hasActiveBooking}
                dispatchCommunicationState={detail.dispatchCommunicationState}
                remediationActions={remediationActions}
                inboundResponseHandoff={inboundResponseHandoff}
                crews={crewSettings}
              />
            ) : null}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="stack-cell">
          <h3>Timeline</h3>
          {detail.timeline.length === 0 ? (
            <div className="portal-empty-state operational-job-empty">
              <strong>No operational timeline yet.</strong>
              <p className="muted">Status changes, crew updates, and job-specific customer notifications will appear here.</p>
            </div>
          ) : (
            <ul className="operational-job-timeline">
              {detail.timeline.map((item) => (
                <li key={item.id} className="operational-job-timeline-item">
                  <div className="quick-meta">
                    <span className="badge">{item.kind === "communication" ? "Communication" : "Job Event"}</span>
                    <span className="muted">{formatJobTrackingTimelineDateTime(item.occurredAt)}</span>
                  </div>
                  <strong>{item.title}</strong>
                  {item.detail ? <p>{item.detail}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="operational-job-grid">
        <section className="card">
          <div className="stack-cell">
            <h3>Linked Estimates</h3>
            {detail.linkedEstimates.length === 0 ? (
              <div className="portal-empty-state operational-job-empty">
                <strong>No linked estimates.</strong>
                <p className="muted">Approved or attached estimates will appear here when they are tied to this job.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Estimate</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.linkedEstimates.map((estimate) => (
                      <tr key={estimate.id}>
                        <td>
                          <Link
                            className="table-link"
                            href={withOrgQuery(`/app/estimates/${estimate.id}`, scope.orgId, scope.internalUser)}
                          >
                            {estimate.estimateNumber} • {estimate.title}
                          </Link>
                        </td>
                        <td>
                          <span className={`badge status-${estimate.status.toLowerCase()}`}>{formatLabel(estimate.status)}</span>
                        </td>
                        <td>{formatCurrency(estimate.total)}</td>
                        <td>{formatDateTime(estimate.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="stack-cell">
            <h3>Linked Invoices</h3>
            {job.sourceInvoices.length === 0 ? (
              <div className="portal-empty-state operational-job-empty">
                <strong>No linked invoices.</strong>
                <p className="muted">Operationally linked invoices appear here once they resolve through this job.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.sourceInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>
                          <Link
                            className="table-link"
                            href={withOrgQuery(`/app/invoices/${invoice.id}`, scope.orgId, scope.internalUser)}
                          >
                            {formatInvoiceNumber(invoice.invoiceNumber)}
                          </Link>
                        </td>
                        <td>
                          <span className={`badge status-${invoice.status.toLowerCase()}`}>{formatLabel(invoice.status)}</span>
                        </td>
                        <td>{formatCurrency(invoice.total)}</td>
                        <td>{formatCurrency(invoice.balanceDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
