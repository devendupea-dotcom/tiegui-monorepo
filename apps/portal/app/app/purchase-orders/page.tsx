import { canManagePurchaseOrders } from "@/lib/purchase-orders";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import PurchaseOrdersManager from "./purchase-orders-manager";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const initialJobId = getParam(searchParams?.jobId);
  const scope = await resolveAppScope({
    nextPath: "/app/purchase-orders",
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/purchase-orders",
    orgId: scope.orgId,
  });

  const canManage = canManagePurchaseOrders({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  return (
    <PurchaseOrdersManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
      initialJobId={initialJobId || null}
    />
  );
}
