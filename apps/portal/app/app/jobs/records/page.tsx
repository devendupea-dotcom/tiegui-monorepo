import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManageJobRecords } from "@/lib/job-records";
import { getParam, resolveAppScope } from "../../_lib/portal-scope";
import JobRecordsManager from "./job-records-manager";

export const dynamic = "force-dynamic";

export default async function JobRecordsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/jobs/records",
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser("/app/jobs/records");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManageJobRecords({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  return (
    <JobRecordsManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
    />
  );
}
