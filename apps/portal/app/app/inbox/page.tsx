import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import UnifiedInbox from "./unified-inbox";

export const dynamic = "force-dynamic";

export default async function ClientInboxPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const requestedLeadId = getParam(searchParams?.leadId);
  const requestedContext = getParam(searchParams?.context);
  const scope = await resolveAppScope({ nextPath: "/app/inbox", requestedOrgId });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/inbox",
    orgId: scope.orgId,
  });
  const canManage = viewer.internalUser || viewer.calendarAccessRole !== "READ_ONLY";

  return (
    <UnifiedInbox
      orgId={scope.orgId}
      internalUser={viewer.internalUser}
      onboardingComplete={scope.onboardingComplete}
      canManage={canManage}
      initialLeadId={requestedLeadId}
      initialOpenContextEditor={requestedContext === "edit"}
    />
  );
}
