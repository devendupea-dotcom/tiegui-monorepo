import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManageMaterials } from "@/lib/materials";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import MaterialsManager from "./materials-manager";

export const dynamic = "force-dynamic";

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/materials", requestedOrgId });

  const sessionUser = await requireSessionUser("/app/materials");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManageMaterials({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  return (
    <MaterialsManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
    />
  );
}
