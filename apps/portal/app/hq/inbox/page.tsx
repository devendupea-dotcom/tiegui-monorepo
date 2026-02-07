import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  endOfToday,
  endOfWeek,
  formatDateTime,
  formatLabel,
  isOverdueFollowUp,
  leadPriorityOptions,
  leadStatusOptions,
  startOfToday,
} from "@/lib/hq";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function isLeadStatus(value: string): value is (typeof leadStatusOptions)[number] {
  return leadStatusOptions.some((option) => option === value);
}

function isLeadPriority(value: string): value is (typeof leadPriorityOptions)[number] {
  return leadPriorityOptions.some((option) => option === value);
}

export default async function HqInboxPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const status = getParam(searchParams?.status);
  const assignedToUserId = getParam(searchParams?.assignedToUserId);
  const orgId = getParam(searchParams?.orgId);
  const priority = getParam(searchParams?.priority);
  const due = getParam(searchParams?.due);

  const where: Prisma.LeadWhereInput = {};

  if (isLeadStatus(status)) {
    where.status = status;
  }

  if (isLeadPriority(priority)) {
    where.priority = priority;
  }

  if (orgId) {
    where.orgId = orgId;
  }

  if (assignedToUserId === "unassigned") {
    where.assignedToUserId = null;
  } else if (assignedToUserId) {
    where.assignedToUserId = assignedToUserId;
  }

  const now = new Date();
  if (due === "overdue") {
    where.nextFollowUpAt = { lt: now };
  } else if (due === "today") {
    where.nextFollowUpAt = {
      gte: startOfToday(now),
      lte: endOfToday(now),
    };
  } else if (due === "this_week") {
    where.nextFollowUpAt = {
      gte: now,
      lte: endOfWeek(now),
    };
  }

  const [organizations, internalUsers, leads] = await Promise.all([
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
      where,
      include: {
        org: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ nextFollowUpAt: "asc" }, { createdAt: "desc" }],
      take: 300,
    }),
  ]);

  return (
    <>
      <section className="card">
        <h2>HQ Inbox</h2>
        <p className="muted">All leads across every business.</p>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          <label>
            Status
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {leadStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {formatLabel(option)}
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
            Priority
            <select name="priority" defaultValue={priority}>
              <option value="">All</option>
              {leadPriorityOptions.map((option) => (
                <option key={option} value={option}>
                  {formatLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Follow-up due
            <select name="due" defaultValue={due}>
              <option value="">Any</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="this_week">This week</option>
            </select>
          </label>

          <button className="btn primary" type="submit">
            Apply filters
          </button>
          <Link className="btn secondary" href="/hq/inbox">
            Reset
          </Link>
        </form>
      </section>

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
                  <th>Business</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Follow-up</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const overdue = isOverdueFollowUp(lead.nextFollowUpAt);
                  return (
                    <tr key={lead.id}>
                      <td>{lead.org.name}</td>
                      <td>
                        <Link href={`/hq/leads/${lead.id}`} className="table-link">
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
                            {overdue && <span className="overdue-chip">Overdue</span>}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{formatDateTime(lead.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
