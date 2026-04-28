import { redirect } from "next/navigation";

function toQuery(searchParams: Record<string, string | string[] | undefined> | undefined): string {
  const params = new URLSearchParams();

  if (!searchParams) {
    return "";
  }

  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (typeof rawValue === "string") {
      params.set(key, rawValue);
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        params.append(key, value);
      }
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export default async function LegacyLeadDetailRedirectPage(
  props: {
    params: Promise<{ leadId: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  redirect(`/app/jobs/${params.leadId}${toQuery(searchParams)}`);
}
