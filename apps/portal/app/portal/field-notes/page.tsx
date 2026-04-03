import { redirect } from "next/navigation";

function getParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default function PortalFieldNotesRedirectPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  const orgId = getParam(searchParams?.orgId);
  const mobile = getParam(searchParams?.mobile);

  if (orgId) {
    params.set("orgId", orgId);
  }
  if (mobile) {
    params.set("mobile", mobile);
  }

  const query = params.toString();
  redirect(query ? `/app/field-notes?${query}` : "/app/field-notes");
}
