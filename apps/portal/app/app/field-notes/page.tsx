import { getParam, resolveAppScope } from "../_lib/portal-scope";
import FieldNotesScanner from "./field-notes-scanner";

export const dynamic = "force-dynamic";

export default async function FieldNotesPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/field-notes",
    requestedOrgId,
  });

  return <FieldNotesScanner orgId={scope.orgId} orgName={scope.orgName} internalUser={scope.internalUser} />;
}
