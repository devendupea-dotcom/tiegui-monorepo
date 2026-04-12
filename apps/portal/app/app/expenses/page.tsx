import { canManageBusinessExpenses } from "@/lib/business-expenses";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
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
  const viewer = await requireAppPageViewer({
    nextPath: "/app/expenses",
    orgId: scope.orgId,
  });

  const canManage = canManageBusinessExpenses({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  return (
    <BusinessExpensesManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={viewer.internalUser}
      canManage={canManage}
      initialJobId={initialJobId || null}
    />
  );
}
