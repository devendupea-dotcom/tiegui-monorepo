import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import DispatchManager from "./dispatch-manager";

export const dynamic = "force-dynamic";

export default async function DispatchPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const requestedDate = getParam(searchParams?.date) || "";
  const requestedJobId = getParam(searchParams?.jobId) || null;
  const scope = await resolveAppScope({
    nextPath: "/app/dispatch",
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/dispatch",
    orgId: scope.orgId,
  });
  const canManage = viewer.internalUser || viewer.calendarAccessRole !== "READ_ONLY";

  return (
    <DispatchManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
      initialDate={requestedDate}
      initialJobId={requestedJobId}
    />
  );
}
