import { canManageEstimates } from "@/lib/estimates";
import { getEstimateReferencesForOrg } from "@/lib/estimates-store";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import EstimateManager from "./estimate-manager";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const initialCreate = getParam(searchParams?.create) === "1";
  const scope = await resolveAppScope({
    nextPath: "/app/estimates",
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/estimates",
    orgId: scope.orgId,
  });

  const canManage = canManageEstimates({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  const references = await getEstimateReferencesForOrg(scope.orgId);

  return (
    <EstimateManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
      initialEstimateId={null}
      initialCreate={initialCreate}
      leadOptions={references.leads}
      materials={references.materials}
    />
  );
}
