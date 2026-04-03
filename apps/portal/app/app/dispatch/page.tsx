import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import DispatchManager from "./dispatch-manager";

export const dynamic = "force-dynamic";

export default async function DispatchPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const requestedDate = getParam(searchParams?.date) || "";
  const requestedJobId = getParam(searchParams?.jobId) || null;
  const scope = await resolveAppScope({
    nextPath: "/app/dispatch",
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser("/app/dispatch");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = scope.internalUser || currentUser?.calendarAccessRole !== "READ_ONLY";

  return (
    <DispatchManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
      initialDate={requestedDate}
      initialJobId={requestedJobId}
    />
  );
}
