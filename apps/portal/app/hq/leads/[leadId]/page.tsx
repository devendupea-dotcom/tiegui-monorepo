import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  formatDateTime,
  formatLabel,
  isOverdueFollowUp,
  leadPriorityOptions,
  leadStatusOptions,
  toDateTimeLocalValue,
} from "@/lib/hq";
import { requireInternalUser } from "@/lib/session";
import LeadMessageThread from "@/app/_components/lead-message-thread";

type TimelineItem = {
  id: string;
  kind: "CALL" | "EVENT";
  timestamp: Date;
  title: string;
  details?: string;
};

function isLeadStatus(value: string): value is (typeof leadStatusOptions)[number] {
  return leadStatusOptions.some((option) => option === value);
}

function isLeadPriority(value: string): value is (typeof leadPriorityOptions)[number] {
  return leadPriorityOptions.some((option) => option === value);
}

function getTab(value: string | string[] | undefined): "overview" | "messages" {
  return value === "messages" ? "messages" : "overview";
}

async function updateLeadAction(formData: FormData) {
  "use server";

  const leadId = String(formData.get("leadId") || "").trim();
  if (!leadId) {
    redirect("/hq/inbox");
  }

  await requireInternalUser(`/hq/leads/${leadId}`);

  const statusValue = String(formData.get("status") || "").trim();
  const priorityValue = String(formData.get("priority") || "").trim();
  const assignedToUserIdValue = String(formData.get("assignedToUserId") || "").trim();
  const nextFollowUpAtValue = String(formData.get("nextFollowUpAt") || "").trim();
  const notesValue = String(formData.get("notes") || "");

  const data: {
    status?: (typeof leadStatusOptions)[number];
    priority?: (typeof leadPriorityOptions)[number];
    assignedToUserId?: string | null;
    nextFollowUpAt?: Date | null;
    notes?: string | null;
  } = {};

  if (isLeadStatus(statusValue)) {
    data.status = statusValue;
  }

  if (isLeadPriority(priorityValue)) {
    data.priority = priorityValue;
  }

  if (!assignedToUserIdValue || assignedToUserIdValue === "unassigned") {
    data.assignedToUserId = null;
  } else {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToUserIdValue },
      select: { id: true, role: true },
    });

    if (!assignee || assignee.role !== "INTERNAL") {
      redirect(`/hq/leads/${leadId}?error=invalid-assignee`);
    }

    data.assignedToUserId = assignee.id;
  }

  if (!nextFollowUpAtValue) {
    data.nextFollowUpAt = null;
  } else {
    const parsed = new Date(nextFollowUpAtValue);
    if (Number.isNaN(parsed.getTime())) {
      redirect(`/hq/leads/${leadId}?error=invalid-followup`);
    }
    data.nextFollowUpAt = parsed;
  }

  data.notes = notesValue.trim() ? notesValue.trim() : null;

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data,
    select: { orgId: true },
  });

  revalidatePath(`/hq/leads/${leadId}`);
  revalidatePath("/hq/inbox");
  revalidatePath("/hq/calendar");
  revalidatePath("/hq/businesses");
  revalidatePath(`/hq/businesses/${updated.orgId}`);

  redirect(`/hq/leads/${leadId}?saved=1`);
}

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: { leadId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireInternalUser(`/hq/leads/${params.leadId}`);

  const currentTab = getTab(searchParams?.tab);

  const [lead, internalUsers] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: params.leadId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            smsFromNumberE164: true,
            smsTemplates: {
              where: { isActive: true },
              select: { id: true, name: true, body: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        assignedTo: { select: { id: true, name: true, email: true } },
        calls: {
          select: {
            id: true,
            direction: true,
            status: true,
            fromNumberE164: true,
            toNumberE164: true,
            startedAt: true,
          },
          orderBy: { startedAt: "desc" },
          take: 50,
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
          },
          orderBy: { startAt: "desc" },
          take: 50,
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "INTERNAL" },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!lead) {
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
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const saved = searchParams?.saved === "1";
  const error = typeof searchParams?.error === "string" ? searchParams.error : "";

  return (
    <>
      <section className="card">
        <Link href="/hq/inbox" className="table-link">
          ← Back to Inbox
        </Link>
        <h2 style={{ marginTop: 8 }}>{lead.contactName || lead.businessName || lead.phoneE164}</h2>
        <p className="muted">Business: {lead.org.name}</p>
        <div className="quick-meta" style={{ marginTop: 12 }}>
          <span className={`badge status-${lead.status.toLowerCase()}`}>{formatLabel(lead.status)}</span>
          <span className={`badge priority-${lead.priority.toLowerCase()}`}>
            {formatLabel(lead.priority)} Priority
          </span>
          {lead.nextFollowUpAt && isOverdueFollowUp(lead.nextFollowUpAt) ? (
            <span className="overdue-chip">Overdue</span>
          ) : null}
        </div>

        <div className="tab-row" style={{ marginTop: 14 }}>
          <Link
            href={`/hq/leads/${lead.id}?tab=overview`}
            className={`tab-chip ${currentTab === "overview" ? "active" : ""}`}
          >
            Overview
          </Link>
          <Link
            href={`/hq/leads/${lead.id}?tab=messages`}
            className={`tab-chip ${currentTab === "messages" ? "active" : ""}`}
          >
            Messages
          </Link>
        </div>
      </section>

      {currentTab === "overview" ? (
        <>
          <section className="grid two-col">
            <article className="card">
              <h3>Lead Details</h3>
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
                  <dt>Source</dt>
                  <dd>{formatLabel(lead.leadSource)}</dd>
                </div>
                <div>
                  <dt>First Contact</dt>
                  <dd>{formatDateTime(lead.firstContactedAt)}</dd>
                </div>
                <div>
                  <dt>Last Contact</dt>
                  <dd>{formatDateTime(lead.lastContactedAt)}</dd>
                </div>
              </dl>
            </article>

            <article className="card">
              <h3>Update Lead</h3>
              <p className="muted">Status, priority, assignee, follow-up, and notes.</p>

              <form action={updateLeadAction} className="auth-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="leadId" value={lead.id} />

                <label>
                  Status
                  <select name="status" defaultValue={lead.status}>
                    {leadStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Priority
                  <select name="priority" defaultValue={lead.priority}>
                    {leadPriorityOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Assigned to
                  <select name="assignedToUserId" defaultValue={lead.assignedToUserId || "unassigned"}>
                    <option value="unassigned">Unassigned</option>
                    {internalUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Next Follow-up
                  <input
                    type="datetime-local"
                    name="nextFollowUpAt"
                    defaultValue={toDateTimeLocalValue(lead.nextFollowUpAt)}
                  />
                </label>

                <label>
                  Notes
                  <textarea name="notes" defaultValue={lead.notes || ""} rows={6} />
                </label>

                <button type="submit" className="btn primary">
                  Save changes
                </button>

                {saved ? <p className="form-status">Lead updated.</p> : null}
                {error === "invalid-assignee" ? (
                  <p className="form-status">Select a valid internal assignee.</p>
                ) : null}
                {error === "invalid-followup" ? (
                  <p className="form-status">Follow-up date is invalid.</p>
                ) : null}
              </form>
            </article>
          </section>

          <section className="card">
            <h3>Activity Timeline</h3>
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
          </section>
        </>
      ) : (
        <section className="card">
          <h3>Messages</h3>
          <p className="muted">Thread for this lead only.</p>
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
      )}
    </>
  );
}
