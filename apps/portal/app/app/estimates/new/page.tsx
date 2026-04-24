import { redirect } from "next/navigation";

function getParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function LegacyEstimateRedirectPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = new URLSearchParams();
  const orgId = getParam(searchParams?.orgId);
  const mobile = getParam(searchParams?.mobile);
  const draftId = getParam(searchParams?.draftId);

  if (orgId) {
    params.set("orgId", orgId);
  }
  if (mobile) {
    params.set("mobile", mobile);
  }

  if (draftId) {
    const query = params.toString();
    redirect(query ? `/app/estimates/${draftId}?${query}` : `/app/estimates/${draftId}`);
  }

  params.set("create", "1");
  redirect(`/app/estimates?${params.toString()}`);
}
