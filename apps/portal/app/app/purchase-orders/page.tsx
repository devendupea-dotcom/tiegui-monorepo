import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManagePurchaseOrders } from "@/lib/purchase-orders";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import PurchaseOrdersManager from "./purchase-orders-manager";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const initialJobId = getParam(searchParams?.jobId);
  const scope = await resolveAppScope({
    nextPath: "/app/purchase-orders",
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser("/app/purchase-orders");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManagePurchaseOrders({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  return (
    <PurchaseOrdersManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
      initialJobId={initialJobId || null}
    />
  );
}
