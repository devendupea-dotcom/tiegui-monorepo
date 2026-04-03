import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import UnifiedInbox from "./unified-inbox";

export const dynamic = "force-dynamic";

export default async function ClientInboxPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/inbox", requestedOrgId });
  const sessionUser = await requireSessionUser("/app/inbox");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;
  const canManage = scope.internalUser || currentUser?.calendarAccessRole !== "READ_ONLY";

  return (
    <UnifiedInbox
      orgId={scope.orgId}
      internalUser={scope.internalUser}
      onboardingComplete={scope.onboardingComplete}
      canManage={canManage}
    />
  );
}
