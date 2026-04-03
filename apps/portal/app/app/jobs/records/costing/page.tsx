import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManageJobCosting } from "@/lib/job-costing";
import { getParam, resolveAppScope } from "../../../_lib/portal-scope";
import JobCostingManager from "../[jobId]/costing/job-costing-manager";

export const dynamic = "force-dynamic";

export default async function JobCostingOverviewPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/jobs/records/costing",
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser("/app/jobs/records/costing");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManageJobCosting({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  return (
    <JobCostingManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
      initialJobId={null}
    />
  );
}
