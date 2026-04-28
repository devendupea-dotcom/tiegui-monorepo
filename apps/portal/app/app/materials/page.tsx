import { canManageMaterials } from "@/lib/materials";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import MaterialsManager from "./materials-manager";

export const dynamic = "force-dynamic";

export default async function MaterialsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/materials", requestedOrgId });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/materials",
    orgId: scope.orgId,
  });

  const canManage = canManageMaterials({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  return (
    <MaterialsManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
    />
  );
}
