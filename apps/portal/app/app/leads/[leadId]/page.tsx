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

export default function LegacyLeadDetailRedirectPage({
  params,
  searchParams,
}: {
  params: { leadId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(`/app/jobs/${params.leadId}${toQuery(searchParams)}`);
}
