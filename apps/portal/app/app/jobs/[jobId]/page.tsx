import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp } from "@/lib/hq";
import {
  formatCurrency,
  formatInvoiceNumber,
  recomputeInvoiceTotals,
  reserveNextInvoiceNumber,
} from "@/lib/invoices";
import { sendMetaCapiPurchaseForInvoice } from "@/lib/meta-capi";
import LeadMessageThread from "@/app/_components/lead-message-thread";
import { canAccessOrg, isInternalRole, requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";
import JobFieldActions from "../job-field-actions";
import JobStatusControls from "../job-status-controls";

type TimelineItem = {
  id: string;
  kind: "CALL" | "EVENT" | "NOTE";
  timestamp: Date;
  title: string;
  details?: string;
};

type TabKey = "overview" | "messages" | "notes" | "photos" | "measurements" | "invoice";

function getTab(value: string | string[] | undefined): TabKey {
  const current = typeof value === "string" ? value : "overview";
  if (
    current === "messages" ||
    current === "notes" ||
    current === "photos" ||
    current === "measurements" ||
    current === "invoice"
  ) {
    return current;
  }
  return "overview";
}


function appendQuery(path: string, key: string, value: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function getSafeReturnPath(rawValue: string, fallback: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("/app/jobs/")) {
    return trimmed;
  }
  return fallback;
}

function formatCurrencyFromCents(value: number | null | undefined): string {
  if (!value) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

async function requireLeadActionAccess(formData: FormData) {
  const leadId = String(formData.get("leadId") || "").trim();
  const orgId = String(formData.get("orgId") || "").trim();

  if (!leadId || !orgId) {
    redirect("/app/jobs");
  }

  const user = await requireSessionUser(`/app/jobs/${leadId}`);
  if (!canAccessOrg(user, orgId)) {
    redirect("/app");
  }

  const currentUser =
    user.id && !isInternalRole(user.role)
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  if (!isInternalRole(user.role) && currentUser?.calendarAccessRole === "READ_ONLY") {
    redirect("/app/jobs");
  }

  if (!isInternalRole(user.role) && currentUser?.calendarAccessRole === "WORKER") {
    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: leadId,
        orgId,
        OR: [
          { assignedToUserId: currentUser.id },
          { createdByUserId: currentUser.id },
          { events: { some: { assignedToUserId: currentUser.id } } },
          { events: { some: { workerAssignments: { some: { workerUserId: currentUser.id } } } } },
        ],
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      redirect("/app/jobs");
    }
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, orgId },
    select: {
      id: true,
      orgId: true,
      customerId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      city: true,
      businessType: true,
      estimatedRevenueCents: true,
    },
  });

  if (!lead) {
    redirect("/app/jobs");
  }

  const fallbackReturn = withOrgQuery(`/app/jobs/${lead.id}?tab=overview`, lead.orgId, isInternalRole(user.role));
  const returnPath = getSafeReturnPath(String(formData.get("returnPath") || ""), fallbackReturn);

  return { lead, user, returnPath, internalUser: isInternalRole(user.role) };
}

async function addJobNoteAction(formData: FormData) {
  "use server";

  const scoped = await requireLeadActionAccess(formData);
  const body = String(formData.get("body") || "").trim();

  if (!body || body.length > 4000) {
    redirect(appendQuery(scoped.returnPath, "error", "note"));
  }

  await prisma.leadNote.create({
    data: {
      orgId: scoped.lead.orgId,
      leadId: scoped.lead.id,
      createdByUserId: scoped.user.id ?? null,
      body,
    },
  });

  revalidatePath(`/app/jobs/${scoped.lead.id}`);
  revalidatePath("/app/jobs");

  redirect(appendQuery(scoped.returnPath, "saved", "note"));
}

async function addJobMeasurementAction(formData: FormData) {
  "use server";

  const scoped = await requireLeadActionAccess(formData);
  const label = String(formData.get("label") || "").trim();
  const value = String(formData.get("value") || "").trim();
  const unit = String(formData.get("unit") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!label || !value || label.length > 120 || value.length > 120 || unit.length > 40 || notes.length > 1000) {
    redirect(appendQuery(scoped.returnPath, "error", "measurement"));
  }

  await prisma.leadMeasurement.create({
    data: {
      orgId: scoped.lead.orgId,
      leadId: scoped.lead.id,
      createdByUserId: scoped.user.id ?? null,
      label,
      value,
      unit: unit || null,
      notes: notes || null,
    },
  });

  revalidatePath(`/app/jobs/${scoped.lead.id}`);

  redirect(appendQuery(scoped.returnPath, "saved", "measurement"));
}

async function addJobPhotoAction(formData: FormData) {
  "use server";

  const scoped = await requireLeadActionAccess(formData);
  const caption = String(formData.get("caption") || "").trim();
  const file = formData.get("photoFile");

  if (!(file instanceof File) || file.size <= 0 || !file.type.startsWith("image/")) {
    redirect(appendQuery(scoped.returnPath, "error", "photo"));
  }

  if (file.size > 4 * 1024 * 1024) {
    redirect(appendQuery(scoped.returnPath, "error", "photo-size"));
  }

  const arrayBuffer = await file.arrayBuffer();
  const imageDataUrl = `data:${file.type};base64,${Buffer.from(arrayBuffer).toString("base64")}`;

  await prisma.leadPhoto.create({
    data: {
      orgId: scoped.lead.orgId,
      leadId: scoped.lead.id,
      createdByUserId: scoped.user.id ?? null,
      fileName: file.name || "photo",
      mimeType: file.type,
      imageDataUrl,
      caption: caption || null,
    },
  });

  revalidatePath(`/app/jobs/${scoped.lead.id}`);

  redirect(appendQuery(scoped.returnPath, "saved", "photo"));
}

async function createInvoiceAction(formData: FormData) {
  "use server";

  const scoped = await requireLeadActionAccess(formData);
  const now = new Date();
  const dueAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const baseAmount = scoped.lead.estimatedRevenueCents
    ? new Prisma.Decimal(scoped.lead.estimatedRevenueCents).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : new Prisma.Decimal(0);
  const leadLabel = scoped.lead.contactName || scoped.lead.businessName || scoped.lead.phoneE164;
  const description = scoped.lead.businessType ? `${scoped.lead.businessType} service` : `Service for ${leadLabel}`;

  const createdInvoice = await prisma.$transaction(async (tx) => {
    let customerId = scoped.lead.customerId;
    if (!customerId) {
      const customer = await tx.customer.create({
        data: {
          orgId: scoped.lead.orgId,
          createdByUserId: scoped.user.id ?? null,
          name: scoped.lead.contactName || scoped.lead.businessName || scoped.lead.phoneE164,
          phoneE164: scoped.lead.phoneE164,
          addressLine: scoped.lead.city || null,
        },
        select: { id: true },
      });

      customerId = customer.id;
      await tx.lead.update({
        where: { id: scoped.lead.id },
        data: { customerId },
      });
    }

    const config = await tx.orgDashboardConfig.upsert({
      where: { orgId: scoped.lead.orgId },
      create: { orgId: scoped.lead.orgId },
      update: {},
      select: { defaultTaxRate: true },
    });

    const invoiceNumber = await reserveNextInvoiceNumber(tx, scoped.lead.orgId);
    const invoice = await tx.invoice.create({
      data: {
        orgId: scoped.lead.orgId,
        jobId: scoped.lead.id,
        customerId,
        invoiceNumber,
        status: "DRAFT",
        issueDate: now,
        dueDate: dueAt,
        taxRate: config.defaultTaxRate,
        notes: `Created from job folder: ${leadLabel}`,
        createdByUserId: scoped.user.id ?? null,
      },
      select: { id: true },
    });

    await tx.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        description,
        quantity: new Prisma.Decimal(1),
        unitPrice: baseAmount,
        lineTotal: baseAmount,
        sortOrder: 0,
      },
    });

    await recomputeInvoiceTotals(tx, invoice.id);
    return invoice;
  });

  revalidatePath(`/app/jobs/${scoped.lead.id}`);
  revalidatePath("/app/jobs");
  revalidatePath("/app/invoices");

  const invoicePath = withOrgQuery(`/app/invoices/${createdInvoice.id}`, scoped.lead.orgId, scoped.internalUser);
  redirect(invoicePath);
}

async function quickMarkInvoicePaidAction(formData: FormData) {
  "use server";

  const scoped = await requireLeadActionAccess(formData);
  const invoiceId = String(formData.get("invoiceId") || "").trim();
  if (!invoiceId) {
    redirect(appendQuery(scoped.returnPath, "error", "invoice-paid"));
  }

  let settledInvoiceId: string | null = null;
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        orgId: scoped.lead.orgId,
        jobId: scoped.lead.id,
      },
      select: {
        id: true,
        balanceDue: true,
      },
    });

    if (!invoice || invoice.balanceDue.lte(0)) {
      return;
    }

    await tx.invoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amount: invoice.balanceDue,
        date: new Date(),
        method: "OTHER",
        note: "Quick mark paid from project folder.",
      },
    });

    await recomputeInvoiceTotals(tx, invoice.id);
    settledInvoiceId = invoice.id;
  });

  if (settledInvoiceId) {
    await sendMetaCapiPurchaseForInvoice({ invoiceId: settledInvoiceId });
  }

  revalidatePath(`/app/jobs/${scoped.lead.id}`);
  revalidatePath("/app/invoices");
  redirect(appendQuery(scoped.returnPath, "saved", "invoice-paid"));
}

export const dynamic = "force-dynamic";

export default async function ClientJobDetailPage({
  params,
  searchParams,
}: {
  params: { jobId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const currentTab = getTab(searchParams?.tab);
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);

  const scope = await resolveAppScope({
    nextPath: `/app/jobs/${params.jobId}`,
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser(`/app/jobs/${params.jobId}`);
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  if (!scope.internalUser && currentUser?.calendarAccessRole === "WORKER") {
    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: params.jobId,
        orgId: scope.orgId,
        OR: [
          { assignedToUserId: currentUser.id },
          { createdByUserId: currentUser.id },
          { events: { some: { assignedToUserId: currentUser.id } } },
          { events: { some: { workerAssignments: { some: { workerUserId: currentUser.id } } } } },
        ],
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      notFound();
    }
  }

  const lead = await prisma.lead.findFirst({
    where: {
      id: params.jobId,
      orgId: scope.orgId,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
          smsFromNumberE164: true,
          voiceNotesEnabled: true,
          offlineModeEnabled: true,
          smsTemplates: {
            where: { isActive: true },
            select: { id: true, name: true, body: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      calls: {
        select: {
          id: true,
          direction: true,
          status: true,
          fromNumberE164: true,
          toNumberE164: true,
          startedAt: true,
          trackingNumberE164: true,
          landingPageUrl: true,
          utmCampaign: true,
          gclid: true,
          attributionSource: true,
        },
        orderBy: { startedAt: "desc" },
        take: 40,
      },
      messages: {
        select: {
          id: true,
          direction: true,
          fromNumberE164: true,
          toNumberE164: true,
          body: true,
          provider: true,
          providerMessageSid: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: {
          id: true,
          type: true,
          title: true,
          description: true,
          startAt: true,
          endAt: true,
          status: true,
          assignedToUserId: true,
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          workerAssignments: {
            select: {
              workerUserId: true,
              worker: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: { startAt: "asc" },
        take: 30,
      },
      leadNotes: {
        select: {
          id: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 120,
      },
      leadPhotos: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          imageDataUrl: true,
          caption: true,
          createdAt: true,
          createdBy: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 120,
      },
      measurements: {
        select: {
          id: true,
          label: true,
          value: true,
          unit: true,
          notes: true,
          createdAt: true,
          createdBy: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 120,
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          dueDate: true,
          issueDate: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  if (!lead) {
    if (scope.internalUser && !requestedOrgId) {
      const fallbackLead = await prisma.lead.findUnique({
        where: { id: params.jobId },
        select: { orgId: true },
      });

      if (fallbackLead) {
        redirect(`/app/jobs/${params.jobId}?tab=${currentTab}&orgId=${encodeURIComponent(fallbackLead.orgId)}`);
      }
    }

    notFound();
  }

  const timeline: TimelineItem[] = [
    ...lead.calls.map((call) => ({
      id: `call-${call.id}`,
      kind: "CALL" as const,
      timestamp: call.startedAt,
      title: `${formatLabel(call.direction)} call • ${formatLabel(call.status)}`,
      details: `${call.fromNumberE164} → ${call.toNumberE164}`,
    })),
    ...lead.events.map((event) => ({
      id: `event-${event.id}`,
      kind: "EVENT" as const,
      timestamp: event.startAt,
      title: `${formatLabel(event.type)} • ${event.title}`,
      details: event.description || undefined,
    })),
    ...lead.leadNotes.slice(0, 30).map((note) => ({
      id: `note-${note.id}`,
      kind: "NOTE" as const,
      timestamp: note.createdAt,
      title: "Field note added",
      details: note.body,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const schedulableEvents = lead.events.filter((event) => event.type === "JOB" || event.type === "ESTIMATE" || event.type === "CALL");
  const now = new Date();
  const primaryJobEvent =
    schedulableEvents.find((event) => event.status !== "CANCELLED" && event.startAt >= now) ||
    [...schedulableEvents].reverse().find((event) => event.status !== "CANCELLED") ||
    null;
  const primaryDurationMinutes = primaryJobEvent?.endAt
    ? Math.max(15, Math.round((primaryJobEvent.endAt.getTime() - primaryJobEvent.startAt.getTime()) / 60000))
    : null;

  const assignedTechNames =
    primaryJobEvent
      ? Array.from(
          new Set(
            [
              primaryJobEvent.assignedTo?.name || primaryJobEvent.assignedTo?.email || null,
              ...primaryJobEvent.workerAssignments.map(
                (assignment) => assignment.worker.name || assignment.worker.email || null,
              ),
            ].filter((value): value is string => Boolean(value && value.trim())),
          ),
        )
      : [];
  const latestInvoice = lead.invoices[0] || null;
  const primaryStatusLabel = formatLabel(primaryJobEvent?.status || lead.status);
  const hasPaidInvoice = latestInvoice ? latestInvoice.status === "PAID" || latestInvoice.balanceDue.lte(0) : false;
  const jobValueLabel =
    lead.estimatedRevenueCents && lead.estimatedRevenueCents > 0
      ? formatCurrencyFromCents(lead.estimatedRevenueCents)
      : latestInvoice
        ? formatCurrency(latestInvoice.total)
        : "TBD";

  const backHref = withOrgQuery("/app/jobs", scope.orgId, scope.internalUser);
  const overviewHref = withOrgQuery(`/app/jobs/${lead.id}?tab=overview`, scope.orgId, scope.internalUser);
  const messagesHref = withOrgQuery(`/app/jobs/${lead.id}?tab=messages`, scope.orgId, scope.internalUser);
  const notesHref = withOrgQuery(`/app/jobs/${lead.id}?tab=notes`, scope.orgId, scope.internalUser);
  const photosHref = withOrgQuery(`/app/jobs/${lead.id}?tab=photos`, scope.orgId, scope.internalUser);
  const measurementsHref = withOrgQuery(`/app/jobs/${lead.id}?tab=measurements`, scope.orgId, scope.internalUser);
  const invoiceHref = withOrgQuery(`/app/jobs/${lead.id}?tab=invoice`, scope.orgId, scope.internalUser);
  const mapsQuery = [lead.businessName, lead.city].filter(Boolean).join(" ").trim();
  const mapsHref = mapsQuery ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}` : null;

  const returnPathFor = (tab: TabKey) =>
    withOrgQuery(`/app/jobs/${lead.id}?tab=${tab}`, scope.orgId, scope.internalUser);

  return (
    <div className="job-detail-shell">
      <section className="card job-detail-header">
        <Link href={backHref} className="table-link">
          ← Back to Jobs
        </Link>
        <div className="job-title-row" style={{ marginTop: 8 }}>
          <h2>{lead.contactName || lead.businessName || lead.phoneE164}</h2>
          <span className={`badge job-hero-status status-${(primaryJobEvent?.status || lead.status).toLowerCase()}`}>
            {primaryStatusLabel}
          </span>
        </div>
        <div className="job-revenue-row">
          <p className="job-value-pill">
            <span>Job Value</span>
            <strong>{jobValueLabel}</strong>
          </p>
          <span className={`badge job-invoice-badge ${hasPaidInvoice ? "paid" : "unpaid"}`}>
            {hasPaidInvoice ? "Paid" : "Unpaid"}
          </span>
        </div>
        {scope.internalUser ? <p className="muted">Portal preview: {lead.org.name}</p> : null}
        <div className="quick-meta" style={{ marginTop: 10 }}>
          <span className={`badge priority-${lead.priority.toLowerCase()}`}>
            {formatLabel(lead.priority)} Priority
          </span>
          {lead.nextFollowUpAt && isOverdueFollowUp(lead.nextFollowUpAt) ? (
            <span className="overdue-chip">Overdue</span>
          ) : null}
        </div>

        <div className="job-detail-action-row">
          <a className="btn primary job-primary-action" href={`tel:${lead.phoneE164}`}>
            Call
          </a>
          <Link className="btn secondary job-secondary-action" href={messagesHref}>
            Open Messages
          </Link>
          <a className="btn secondary job-secondary-action" href={`sms:${lead.phoneE164}`}>
            Text
          </a>
          {mapsHref ? (
            <a className="btn secondary job-secondary-action" href={mapsHref} target="_blank" rel="noopener noreferrer">
              Maps
            </a>
          ) : null}
        </div>

        <JobFieldActions
          jobId={lead.id}
          voiceNotesEnabled={lead.org.voiceNotesEnabled}
          offlineModeEnabled={lead.org.offlineModeEnabled}
        />

        <article className="job-schedule-card">
          <h3>Schedule</h3>
          {primaryJobEvent ? (
            <div className="stack-cell">
              <p>
                <strong>{formatDateTime(primaryJobEvent.startAt)}</strong>
                {primaryDurationMinutes ? ` • ${primaryDurationMinutes} min` : ""}
              </p>
              <p className="muted">Type: {formatLabel(primaryJobEvent.type)}</p>
              <p className="muted">
                Assigned techs: {assignedTechNames.length > 0 ? assignedTechNames.join(", ") : "Unassigned"}
              </p>
            </div>
          ) : (
            <p className="muted">No job time scheduled yet.</p>
          )}
        </article>

        <JobStatusControls
          jobId={lead.id}
          eventId={primaryJobEvent?.id || null}
          initialStatus={primaryJobEvent?.status || "SCHEDULED"}
          offlineModeEnabled={lead.org.offlineModeEnabled}
        />

        <div className="tab-row job-detail-tabs" style={{ marginTop: 14 }}>
          <Link href={overviewHref} className={`tab-chip ${currentTab === "overview" ? "active" : ""}`}>
            Overview
          </Link>
          <Link href={messagesHref} className={`tab-chip ${currentTab === "messages" ? "active" : ""}`}>
            Messages
          </Link>
          <Link href={notesHref} className={`tab-chip ${currentTab === "notes" ? "active" : ""}`}>
            Notes
          </Link>
          <Link href={photosHref} className={`tab-chip ${currentTab === "photos" ? "active" : ""}`}>
            Photos
          </Link>
          <Link href={measurementsHref} className={`tab-chip ${currentTab === "measurements" ? "active" : ""}`}>
            Measurements
          </Link>
          <Link href={invoiceHref} className={`tab-chip ${currentTab === "invoice" ? "active" : ""}`}>
            Invoice
          </Link>
        </div>
      </section>

      {currentTab === "overview" ? (
        <>
          <section className="card">
            <h2>Project Folder Summary</h2>
            <dl className="detail-list" style={{ marginTop: 10 }}>
              <div>
                <dt>Business</dt>
                <dd>{lead.businessName || "-"}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{lead.contactName || "-"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{lead.phoneE164}</dd>
              </div>
              <div>
                <dt>City</dt>
                <dd>{lead.city || "-"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{lead.businessType || "-"}</dd>
              </div>
              <div>
                <dt>Lead Source</dt>
                <dd>{formatLabel(lead.leadSource)}</dd>
              </div>
              <div>
                <dt>Next Follow-up</dt>
                <dd>{formatDateTime(lead.nextFollowUpAt)}</dd>
              </div>
              <div>
                <dt>Estimated Value</dt>
                <dd>{formatCurrencyFromCents(lead.estimatedRevenueCents)}</dd>
              </div>
            </dl>
          </section>

          <section className="grid two-col">
            <article className="card">
              <h2>Proof View</h2>
              {lead.calls.length === 0 ? (
                <p className="muted" style={{ marginTop: 10 }}>No call proof metadata yet.</p>
              ) : (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Direction</th>
                        <th>Status</th>
                        <th>Tracking</th>
                        <th>UTM</th>
                        <th>GCLID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lead.calls.map((call) => (
                        <tr key={call.id}>
                          <td>{formatDateTime(call.startedAt)}</td>
                          <td>{formatLabel(call.direction)}</td>
                          <td>{formatLabel(call.status)}</td>
                          <td>{call.trackingNumberE164 || "-"}</td>
                          <td>{call.utmCampaign || "-"}</td>
                          <td>{call.gclid || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="card">
              <h2>Activity Timeline</h2>
              {timeline.length === 0 ? (
                <p className="muted" style={{ marginTop: 10 }}>
                  No activity yet.
                </p>
              ) : (
                <ul className="timeline" style={{ marginTop: 12 }}>
                  {timeline.map((item) => (
                    <li key={item.id} className="timeline-item">
                      <div className="timeline-dot" />
                      <div className="timeline-content">
                        <p>
                          <strong>{item.title}</strong>
                        </p>
                        {item.details ? <p className="muted">{item.details}</p> : null}
                        <p className="muted">{formatDateTime(item.timestamp)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>
        </>
      ) : null}

      {currentTab === "messages" ? (
        <section className="card">
          <h2>Messages</h2>
          <p className="muted">Conversation thread for this job only.</p>
          <LeadMessageThread
            leadId={lead.id}
            senderNumber={lead.org.smsFromNumberE164 || process.env.DEFAULT_OUTBOUND_FROM_E164 || null}
            templates={lead.org.smsTemplates}
            initialMessages={lead.messages.map((message) => ({
              ...message,
              createdAt: message.createdAt.toISOString(),
            }))}
          />
        </section>
      ) : null}

      {currentTab === "notes" ? (
        <section className="grid two-col">
          <article className="card">
            <h2>Field Notes</h2>
            <p className="muted">Drop job updates so crews and office stay aligned.</p>

            <form action={addJobNoteAction} className="auth-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="orgId" value={lead.orgId} />
              <input type="hidden" name="returnPath" value={returnPathFor("notes")} />

              <label>
                Note
                <textarea
                  name="body"
                  rows={6}
                  maxLength={4000}
                  placeholder="Example: Customer approved irrigation add-on. Crew arriving at 8:30 AM Thursday."
                />
              </label>

              <button className="btn primary" type="submit">
                Add Note
              </button>

              {saved === "note" ? <p className="form-status">Note saved.</p> : null}
              {error === "note" ? <p className="form-status">Note is required and must be under 4000 chars.</p> : null}
            </form>
          </article>

          <article className="card">
            <h2>Notes History</h2>
            {lead.leadNotes.length === 0 ? (
              <p className="muted" style={{ marginTop: 10 }}>No notes yet.</p>
            ) : (
              <ul className="notes-list" style={{ marginTop: 12 }}>
                {lead.leadNotes.map((note) => (
                  <li key={note.id} className="notes-item">
                    <p>{note.body}</p>
                    <p className="muted">
                      {formatDateTime(note.createdAt)} • {note.createdBy?.name || note.createdBy?.email || "Team"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      ) : null}

      {currentTab === "photos" ? (
        <section className="grid two-col">
          <article className="card">
            <h2>Upload Site Photo</h2>
            <p className="muted">Add progress photos directly inside this project folder.</p>

            <form action={addJobPhotoAction} className="auth-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="orgId" value={lead.orgId} />
              <input type="hidden" name="returnPath" value={returnPathFor("photos")} />

              <label>
                Photo file
                <input name="photoFile" type="file" accept="image/*" required />
              </label>

              <label>
                Caption (optional)
                <input name="caption" maxLength={200} placeholder="Before cleanup - front yard" />
              </label>

              <button className="btn primary" type="submit">
                Upload Photo
              </button>

              {saved === "photo" ? <p className="form-status">Photo uploaded.</p> : null}
              {error === "photo" ? <p className="form-status">Select an image file before uploading.</p> : null}
              {error === "photo-size" ? <p className="form-status">Photo must be smaller than 4MB.</p> : null}
            </form>
          </article>

          <article className="card">
            <h2>Photo Gallery</h2>
            {lead.leadPhotos.length === 0 ? (
              <p className="muted" style={{ marginTop: 10 }}>No photos yet.</p>
            ) : (
              <div className="photo-grid" style={{ marginTop: 12 }}>
                {lead.leadPhotos.map((photo) => (
                  <figure key={photo.id} className="photo-item">
                    <img src={photo.imageDataUrl} alt={photo.caption || photo.fileName} loading="lazy" />
                    <figcaption>
                      <p>{photo.caption || photo.fileName}</p>
                      <p className="muted">
                        {formatDateTime(photo.createdAt)} • {photo.createdBy?.name || photo.createdBy?.email || "Team"}
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </article>
        </section>
      ) : null}

      {currentTab === "measurements" ? (
        <section className="grid two-col">
          <article className="card">
            <h2>Add Measurement</h2>
            <p className="muted">Track dimensions and job measurements used for quoting and invoicing.</p>

            <form action={addJobMeasurementAction} className="auth-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="orgId" value={lead.orgId} />
              <input type="hidden" name="returnPath" value={returnPathFor("measurements")} />

              <label>
                Label
                <input name="label" maxLength={120} placeholder="Deck length" required />
              </label>

              <label>
                Value
                <input name="value" maxLength={120} placeholder="32" required />
              </label>

              <label>
                Unit (optional)
                <input name="unit" maxLength={40} placeholder="ft" />
              </label>

              <label>
                Notes (optional)
                <textarea name="notes" rows={3} maxLength={1000} placeholder="Measured from driveway edge." />
              </label>

              <button className="btn primary" type="submit">
                Save Measurement
              </button>

              {saved === "measurement" ? <p className="form-status">Measurement saved.</p> : null}
              {error === "measurement" ? (
                <p className="form-status">Label and value are required with valid lengths.</p>
              ) : null}
            </form>
          </article>

          <article className="card">
            <h2>Measurement Log</h2>
            {lead.measurements.length === 0 ? (
              <p className="muted" style={{ marginTop: 10 }}>No measurements yet.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Measurement</th>
                      <th>Value</th>
                      <th>Notes</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lead.measurements.map((row) => (
                      <tr key={row.id}>
                        <td>{row.label}</td>
                        <td>{row.value}{row.unit ? ` ${row.unit}` : ""}</td>
                        <td>{row.notes || "-"}</td>
                        <td>
                          <div className="stack-cell">
                            <span>{formatDateTime(row.createdAt)}</span>
                            <span className="muted">{row.createdBy?.name || row.createdBy?.email || "Team"}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      ) : null}

      {currentTab === "invoice" ? (
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h2>Invoices</h2>
              <p className="muted">Create professional invoices from this project folder and track manual payments.</p>
            </div>
            <form action={createInvoiceAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="orgId" value={lead.orgId} />
              <input type="hidden" name="returnPath" value={returnPathFor("invoice")} />
              <button className="btn primary" type="submit">
                Create Invoice
              </button>
            </form>
          </div>

          {lead.invoices.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No invoices yet. Click Create Invoice to generate one from this job.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Due</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lead.invoices.map((invoice) => {
                    const detailPath = withOrgQuery(`/app/invoices/${invoice.id}`, scope.orgId, scope.internalUser);
                    const downloadablePdfPath = `/api/invoices/${invoice.id}/pdf`;

                    return (
                      <tr key={invoice.id}>
                        <td>
                          <Link className="table-link" href={detailPath}>
                            {formatInvoiceNumber(invoice.invoiceNumber)}
                          </Link>
                        </td>
                        <td>
                          <span className={`badge status-${invoice.status.toLowerCase()}`}>{formatLabel(invoice.status)}</span>
                        </td>
                        <td>{formatCurrency(invoice.total)}</td>
                        <td>{formatCurrency(invoice.amountPaid)}</td>
                        <td>{formatCurrency(invoice.balanceDue)}</td>
                        <td>{formatDateTime(invoice.dueDate)}</td>
                        <td>
                          <div className="quick-links">
                            <Link className="btn secondary" href={detailPath}>
                              Open
                            </Link>
                            <a className="btn secondary" href={downloadablePdfPath}>
                              PDF
                            </a>
                            <form action={quickMarkInvoicePaidAction}>
                              <input type="hidden" name="leadId" value={lead.id} />
                              <input type="hidden" name="orgId" value={lead.orgId} />
                              <input type="hidden" name="returnPath" value={returnPathFor("invoice")} />
                              <input type="hidden" name="invoiceId" value={invoice.id} />
                              <button className="btn secondary" type="submit" disabled={invoice.balanceDue.lte(0)}>
                                Mark Paid
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {saved === "invoice-paid" ? <p className="form-status">Invoice marked paid.</p> : null}
          {error === "invoice-paid" ? <p className="form-status">Could not mark invoice as paid.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
