import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp } from "@/lib/hq";
import { requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

export const dynamic = "force-dynamic";

function toSnippet(value: string, maxLength = 90): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export default async function ClientInboxPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/inbox", requestedOrgId });
  const sessionUser = await requireSessionUser("/app/inbox");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  const leadWhere: Prisma.LeadWhereInput = {
    orgId: scope.orgId,
    ...(!scope.internalUser && currentUser?.calendarAccessRole === "WORKER"
      ? {
          OR: [
            { assignedToUserId: currentUser.id },
            { createdByUserId: currentUser.id },
            { events: { some: { assignedToUserId: currentUser.id } } },
            { events: { some: { workerAssignments: { some: { workerUserId: currentUser.id } } } } },
          ],
        }
      : {}),
  };

  const jobs = await prisma.lead.findMany({
    where: leadWhere,
    select: {
      id: true,
      status: true,
      priority: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      nextFollowUpAt: true,
      updatedAt: true,
      messages: {
        select: {
          direction: true,
          body: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });

  return (
    <section className="card">
      <h2>Inbox</h2>
      <p className="muted">Latest thread activity by job.</p>

      {jobs.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          No jobs yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Last message</th>
                <th>Follow-up</th>
                <th>Thread</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const lastMessage = job.messages[0];
                return (
                  <tr key={job.id}>
                    <td>
                      <div className="stack-cell">
                        <strong>{job.contactName || job.businessName || job.phoneE164}</strong>
                        <span className="muted">{job.phoneE164}</span>
                      </div>
                    </td>
                    <td>
                      <div className="stack-cell">
                        <span className={`badge status-${job.status.toLowerCase()}`}>
                          {formatLabel(job.status)}
                        </span>
                        <span className={`badge priority-${job.priority.toLowerCase()}`}>
                          {formatLabel(job.priority)}
                        </span>
                      </div>
                    </td>
                    <td>
                      {lastMessage ? (
                        <div className="stack-cell">
                          <span className="muted">
                            {formatLabel(lastMessage.direction)} • {formatDateTime(lastMessage.createdAt)}
                          </span>
                          <span>{toSnippet(lastMessage.body)}</span>
                        </div>
                      ) : (
                        <span className="muted">No messages yet.</span>
                      )}
                    </td>
                    <td>
                      {job.nextFollowUpAt ? (
                        <div className="stack-cell">
                          <span>{formatDateTime(job.nextFollowUpAt)}</span>
                          {isOverdueFollowUp(job.nextFollowUpAt) ? <span className="overdue-chip">Overdue</span> : null}
                        </div>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <Link
                        className="table-link"
                        href={withOrgQuery(`/app/jobs/${job.id}?tab=messages`, scope.orgId, scope.internalUser)}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
