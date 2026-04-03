import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManageBusinessExpenses } from "@/lib/business-expenses";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import BusinessExpensesManager from "./business-expenses-manager";

export const dynamic = "force-dynamic";

export default async function BusinessExpensesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const initialJobId = getParam(searchParams?.jobId);
  const scope = await resolveAppScope({
    nextPath: "/app/expenses",
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser("/app/expenses");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManageBusinessExpenses({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  return (
    <BusinessExpensesManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
      initialJobId={initialJobId || null}
    />
  );
}
