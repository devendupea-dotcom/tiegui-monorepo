import { canManageJobRecords } from "@/lib/job-records";
import { getParam, resolveAppScope } from "../../_lib/portal-scope";
import { requireAppPageViewer } from "../../_lib/portal-viewer";
import JobRecordsManager from "./job-records-manager";

export const dynamic = "force-dynamic";

export default async function JobRecordsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/jobs/records",
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/jobs/records",
    orgId: scope.orgId,
  });

  const canManage = canManageJobRecords({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  return (
    <JobRecordsManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
    />
  );
}
