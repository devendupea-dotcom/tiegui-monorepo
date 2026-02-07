import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp } from "@/lib/hq";

export const dynamic = "force-dynamic";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "leads", label: "Leads" },
  { key: "calls", label: "Calls" },
  { key: "messages", label: "Messages" },
  { key: "calendar", label: "Calendar" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function getTab(value: string | string[] | undefined): TabKey {
  const current = typeof value === "string" ? value : "overview";
  return tabs.some((tab) => tab.key === current) ? (current as TabKey) : "overview";
}

export default async function HqBusinessFolderPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tab = getTab(searchParams?.tab);

  const organization = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, createdAt: true },
  });

  if (!organization) {
    notFound();
  }

  const tabBaseHref = `/hq/businesses/${organization.id}`;

  return (
    <>
      <section className="card">
        <Link href="/hq/businesses" className="table-link">
          ← All Businesses
        </Link>
        <h2 style={{ marginTop: 8 }}>{organization.name}</h2>
        <p className="muted">Project folder • created {formatDateTime(organization.createdAt)}</p>

        <div className="tab-row" style={{ marginTop: 14 }}>
          {tabs.map((item) => (
            <Link
              key={item.key}
              href={`${tabBaseHref}?tab=${item.key}`}
              className={`tab-chip ${tab === item.key ? "active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      {tab === "overview" ? <OverviewTab orgId={organization.id} /> : null}
      {tab === "leads" ? <LeadsTab orgId={organization.id} /> : null}
      {tab === "calls" ? <CallsTab orgId={organization.id} /> : null}
      {tab === "messages" ? <MessagesTab orgId={organization.id} /> : null}
      {tab === "calendar" ? <CalendarTab orgId={organization.id} /> : null}
    </>
  );
}

async function OverviewTab({ orgId }: { orgId: string }) {
  const now = new Date();
  const start30 = new Date(now);
  start30.setDate(start30.getDate() - 30);

  const [leadsCount, bookedCount, dueCount, callsCount, messagesCount, eventsCount] = await Promise.all([
    prisma.lead.count({ where: { orgId } }),
    prisma.lead.count({ where: { orgId, status: "BOOKED", updatedAt: { gte: start30 } } }),
    prisma.lead.count({ where: { orgId, nextFollowUpAt: { lte: now } } }),
    prisma.call.count({ where: { orgId } }),
    prisma.message.count({ where: { orgId } }),
    prisma.event.count({ where: { orgId } }),
  ]);

  return (
    <section className="grid">
      <article className="card kpi-card">
        <h2>Total Leads</h2>
        <p className="kpi-value">{leadsCount}</p>
      </article>
      <article className="card kpi-card">
        <h2>Booked (30d)</h2>
        <p className="kpi-value">{bookedCount}</p>
      </article>
      <article className="card kpi-card">
        <h2>Follow-ups Due</h2>
        <p className="kpi-value">{dueCount}</p>
      </article>
      <article className="card kpi-card">
        <h2>Calls</h2>
        <p className="kpi-value">{callsCount}</p>
      </article>
      <article className="card kpi-card">
        <h2>Messages</h2>
        <p className="kpi-value">{messagesCount}</p>
      </article>
      <article className="card kpi-card">
        <h2>Events</h2>
        <p className="kpi-value">{eventsCount}</p>
      </article>
    </section>
  );
}

async function LeadsTab({ orgId }: { orgId: string }) {
  const leads = await prisma.lead.findMany({
    where: { orgId },
    include: {
      assignedTo: { select: { name: true, email: true } },
    },
    orderBy: [{ nextFollowUpAt: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  return (
    <section className="card">
      <h2>Leads</h2>
      {leads.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No leads yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assigned</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link className="table-link" href={`/hq/leads/${lead.id}`}>
                      {lead.contactName || lead.businessName || "Unnamed Lead"}
                    </Link>
                  </td>
                  <td>{lead.phoneE164}</td>
                  <td>
                    <span className={`badge status-${lead.status.toLowerCase()}`}>
                      {formatLabel(lead.status)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge priority-${lead.priority.toLowerCase()}`}>
                      {formatLabel(lead.priority)}
                    </span>
                  </td>
                  <td>{lead.assignedTo?.name || lead.assignedTo?.email || "Unassigned"}</td>
                  <td>
                    {lead.nextFollowUpAt ? (
                      <div className="stack-cell">
                        <span>{formatDateTime(lead.nextFollowUpAt)}</span>
                        {isOverdueFollowUp(lead.nextFollowUpAt) ? (
                          <span className="overdue-chip">Overdue</span>
                        ) : null}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function CallsTab({ orgId }: { orgId: string }) {
  const calls = await prisma.call.findMany({
    where: { orgId },
    include: {
      lead: { select: { id: true, contactName: true, businessName: true, phoneE164: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 300,
  });

  return (
    <section className="card">
      <h2>Calls</h2>
      {calls.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No calls yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Direction</th>
                <th>Status</th>
                <th>From</th>
                <th>To</th>
                <th>Lead</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id}>
                  <td>{formatDateTime(call.startedAt)}</td>
                  <td>{formatLabel(call.direction)}</td>
                  <td>{formatLabel(call.status)}</td>
                  <td>{call.fromNumberE164}</td>
                  <td>{call.toNumberE164}</td>
                  <td>
                    {call.lead ? (
                      <Link className="table-link" href={`/hq/leads/${call.lead.id}`}>
                        {call.lead.contactName || call.lead.businessName || call.lead.phoneE164}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function MessagesTab({ orgId }: { orgId: string }) {
  const messages = await prisma.message.findMany({
    where: { orgId },
    include: {
      lead: { select: { id: true, contactName: true, businessName: true, phoneE164: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <section className="card">
      <h2>Messages</h2>
      {messages.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No messages yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Direction</th>
                <th>From</th>
                <th>To</th>
                <th>Body</th>
                <th>Lead</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id}>
                  <td>{formatDateTime(message.createdAt)}</td>
                  <td>{formatLabel(message.direction)}</td>
                  <td>{message.fromNumberE164}</td>
                  <td>{message.toNumberE164}</td>
                  <td>{message.body}</td>
                  <td>
                    {message.lead ? (
                      <Link className="table-link" href={`/hq/leads/${message.lead.id}`}>
                        {message.lead.contactName || message.lead.businessName || message.lead.phoneE164}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function CalendarTab({ orgId }: { orgId: string }) {
  const [followUps, events] = await Promise.all([
    prisma.lead.findMany({
      where: { orgId, nextFollowUpAt: { not: null } },
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        nextFollowUpAt: true,
      },
      orderBy: { nextFollowUpAt: "asc" },
    }),
    prisma.event.findMany({
      where: { orgId },
      include: {
        lead: { select: { id: true, contactName: true, businessName: true, phoneE164: true } },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const feed = [
    ...followUps
      .filter((lead): lead is typeof lead & { nextFollowUpAt: Date } => Boolean(lead.nextFollowUpAt))
      .map((lead) => ({
        id: `followup-${lead.id}`,
        type: "FOLLOW_UP",
        title: `Follow-up: ${lead.contactName || lead.businessName || lead.phoneE164}`,
        startAt: lead.nextFollowUpAt,
        leadId: lead.id,
      })),
    ...events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      startAt: event.startAt,
      leadId: event.lead?.id,
    })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  return (
    <section className="card">
      <h2>Calendar</h2>
      {feed.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No calendar items yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Title</th>
                <th>Lead</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="stack-cell">
                      <span>{formatDateTime(item.startAt)}</span>
                      {item.type === "FOLLOW_UP" && isOverdueFollowUp(item.startAt) ? (
                        <span className="overdue-chip">Overdue</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{formatLabel(item.type)}</td>
                  <td>{item.title}</td>
                  <td>
                    {item.leadId ? (
                      <Link className="table-link" href={`/hq/leads/${item.leadId}`}>
                        Open Lead
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
