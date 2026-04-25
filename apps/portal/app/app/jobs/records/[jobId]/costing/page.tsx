import { notFound } from "next/navigation";
import { canManageJobCosting } from "@/lib/job-costing";
import { getParam, resolveAppScope } from "../../../../_lib/portal-scope";
import { requireAppPageViewer } from "../../../../_lib/portal-viewer";
import JobCostingManager from "./job-costing-manager";

export const dynamic = "force-dynamic";

export default async function JobCostingDetailPage(
  props: {
    params: Promise<{
      jobId: string;
    }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!params.jobId) {
    notFound();
  }

  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: `/app/jobs/records/${params.jobId}/costing`,
    requestedOrgId,
  });

  const viewer = await requireAppPageViewer({
    nextPath: `/app/jobs/records/${params.jobId}/costing`,
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
      internalUser={scope.internalUser}
      canManage={canManage}
      initialJobId={params.jobId}
    />
  );
}
