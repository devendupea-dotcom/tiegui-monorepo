import { getParam, resolveAppScope } from "../_lib/portal-scope";
import FieldNotesScanner from "./field-notes-scanner";

export const dynamic = "force-dynamic";

export default async function FieldNotesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/field-notes",
    requestedOrgId,
  });

  return <FieldNotesScanner orgId={scope.orgId} orgName={scope.orgName} internalUser={scope.internalUser} />;
}
