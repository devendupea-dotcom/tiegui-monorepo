import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp } from "@/lib/hq";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

type CalendarItem = {
  id: string;
  orgId: string;
  orgName: string;
  leadId?: string;
  leadLabel?: string;
  assignedTo?: string;
  type: string;
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date | null;
  overdue: boolean;
};

export default async function HqCalendarPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const orgId = getParam(searchParams?.orgId);
  const assignedToUserId = getParam(searchParams?.assignedToUserId);

  const leadWhere: Prisma.LeadWhereInput = {
    nextFollowUpAt: { not: null },
  };
  const eventWhere: Prisma.EventWhereInput = {};

  if (orgId) {
    leadWhere.orgId = orgId;
    eventWhere.orgId = orgId;
  }

  if (assignedToUserId === "unassigned") {
    leadWhere.assignedToUserId = null;
    eventWhere.assignedToUserId = null;
  } else if (assignedToUserId) {
    leadWhere.assignedToUserId = assignedToUserId;
    eventWhere.assignedToUserId = assignedToUserId;
  }

  const [organizations, internalUsers, followUpLeads, events] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "INTERNAL" },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.lead.findMany({
      where: leadWhere,
      select: {
        id: true,
        orgId: true,
        org: { select: { name: true } },
        contactName: true,
        businessName: true,
        phoneE164: true,
        notes: true,
        nextFollowUpAt: true,
        assignedTo: { select: { name: true, email: true } },
      },
      orderBy: { nextFollowUpAt: "asc" },
      take: 500,
    }),
    prisma.event.findMany({
      where: eventWhere,
      select: {
        id: true,
        orgId: true,
        org: { select: { name: true } },
        leadId: true,
        lead: { select: { contactName: true, businessName: true, phoneE164: true } },
        type: true,
        title: true,
        description: true,
        startAt: true,
        endAt: true,
        assignedTo: { select: { name: true, email: true } },
      },
      orderBy: { startAt: "asc" },
      take: 500,
    }),
  ]);

  const items: CalendarItem[] = [
    ...followUpLeads
      .filter((lead): lead is typeof lead & { nextFollowUpAt: Date } => Boolean(lead.nextFollowUpAt))
      .map((lead) => ({
        id: `followup-${lead.id}`,
        orgId: lead.orgId,
        orgName: lead.org.name,
        leadId: lead.id,
        leadLabel: lead.contactName || lead.businessName || lead.phoneE164,
        assignedTo: lead.assignedTo?.name || lead.assignedTo?.email || "Unassigned",
        type: "FOLLOW_UP",
        title: `Follow-up: ${lead.contactName || lead.businessName || lead.phoneE164}`,
        description: lead.notes || undefined,
        startAt: lead.nextFollowUpAt,
        endAt: null,
        overdue: isOverdueFollowUp(lead.nextFollowUpAt),
      })),
    ...events.map((event) => ({
      id: event.id,
      orgId: event.orgId,
      orgName: event.org.name,
      leadId: event.leadId || undefined,
      leadLabel: event.lead
        ? event.lead.contactName || event.lead.businessName || event.lead.phoneE164
        : undefined,
      assignedTo: event.assignedTo?.name || event.assignedTo?.email || "Unassigned",
      type: event.type,
      title: event.title,
      description: event.description || undefined,
      startAt: event.startAt,
      endAt: event.endAt,
      overdue: event.type === "FOLLOW_UP" && isOverdueFollowUp(event.startAt),
    })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  return (
    <>
      <section className="card">
        <h2>HQ Calendar</h2>
        <p className="muted">Shared follow-up and event schedule across all businesses.</p>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          <label>
            Business
            <select name="orgId" defaultValue={orgId}>
              <option value="">All</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Assigned to
            <select name="assignedToUserId" defaultValue={assignedToUserId}>
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {internalUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email}
                </option>
              ))}
            </select>
          </label>

          <button className="btn primary" type="submit">
            Apply filters
          </button>
          <Link className="btn secondary" href="/hq/calendar">
            Reset
          </Link>
        </form>
      </section>

      <section className="card">
        <h2>Upcoming + Overdue</h2>
        {items.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No events yet.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Business</th>
                  <th>Assigned</th>
                  <th>Lead</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="stack-cell">
                        <span>{formatDateTime(item.startAt)}</span>
                        {item.overdue && <span className="overdue-chip">Overdue</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge status-${item.type.toLowerCase()}`}>
                        {formatLabel(item.type)}
                      </span>
                    </td>
                    <td>
                      <div className="stack-cell">
                        <span>{item.title}</span>
                        {item.description ? <span className="muted">{item.description}</span> : null}
                      </div>
                    </td>
                    <td>{item.orgName}</td>
                    <td>{item.assignedTo}</td>
                    <td>
                      {item.leadId ? (
                        <Link className="table-link" href={`/hq/leads/${item.leadId}`}>
                          {item.leadLabel || "Lead"}
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
    </>
  );
}
