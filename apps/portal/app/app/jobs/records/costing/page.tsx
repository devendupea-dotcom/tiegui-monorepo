import { canManageJobCosting } from "@/lib/job-costing";
import { getParam, resolveAppScope } from "../../../_lib/portal-scope";
import { requireAppPageViewer } from "../../../_lib/portal-viewer";
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
  const viewer = await requireAppPageViewer({
    nextPath: "/app/jobs/records/costing",
    orgId: scope.orgId,
  });

  const canManage = canManageJobCosting({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  return (
    <JobCostingManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
      initialJobId={null}
    />
  );
}
