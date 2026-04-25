import { redirect } from "next/navigation";

function getParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function PortalMaterialsRedirectPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
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
  redirect(query ? `/app/materials?${query}` : "/app/materials");
}
