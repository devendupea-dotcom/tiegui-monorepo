import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp } from "@/lib/hq";
import { isInternalRole, requireSessionUser } from "@/lib/session";
import LeadMessageThread from "@/app/_components/lead-message-thread";

type TimelineItem = {
  id: string;
  kind: "CALL" | "EVENT";
  timestamp: Date;
  title: string;
  details?: string;
};

function getTab(value: string | string[] | undefined): "overview" | "messages" {
  return value === "messages" ? "messages" : "overview";
}

export const dynamic = "force-dynamic";

export default async function ClientLeadDetailPage({
  params,
  searchParams,
}: {
  params: { leadId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await requireSessionUser(`/app/leads/${params.leadId}`);

  if (isInternalRole(user.role)) {
    redirect(`/hq/leads/${params.leadId}`);
  }

  if (!user.orgId) {
    redirect("/dashboard");
  }

  const currentTab = getTab(searchParams?.tab);

  const lead = await prisma.lead.findFirst({
    where: {
      id: params.leadId,
      orgId: user.orgId,
    },
    include: {
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
        take: 30,
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
        take: 30,
      },
    },
  });

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

  return (
    <main className="page">
      <section className="card">
        <Link href="/dashboard" className="table-link">
          ← Back to Dashboard
        </Link>
        <h1 style={{ marginTop: 8 }}>{lead.contactName || lead.businessName || lead.phoneE164}</h1>
        <div className="quick-meta" style={{ marginTop: 10 }}>
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
            href={`/app/leads/${lead.id}?tab=overview`}
            className={`tab-chip ${currentTab === "overview" ? "active" : ""}`}
          >
            Overview
          </Link>
          <Link
            href={`/app/leads/${lead.id}?tab=messages`}
            className={`tab-chip ${currentTab === "messages" ? "active" : ""}`}
          >
            Messages
          </Link>
        </div>
      </section>

      {currentTab === "overview" ? (
        <>
          <section className="card">
            <h2>Lead Details</h2>
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
                <dt>Next Follow-up</dt>
                <dd>{formatDateTime(lead.nextFollowUpAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="card">
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
          </section>
        </>
      ) : (
        <section className="card">
          <h2>Messages</h2>
          <p className="muted">Conversation thread for this lead only.</p>
          <LeadMessageThread
            leadId={lead.id}
            initialMessages={lead.messages.map((message) => ({
              ...message,
              createdAt: message.createdAt.toISOString(),
            }))}
          />
        </section>
      )}
    </main>
  );
}
