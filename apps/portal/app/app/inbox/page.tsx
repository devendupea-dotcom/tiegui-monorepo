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

  return (
    <UnifiedInbox orgId={scope.orgId} internalUser={scope.internalUser} onboardingComplete={scope.onboardingComplete} />
  );
}

