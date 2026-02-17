import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;
export const dynamic = "force-dynamic";

function toQueryString(searchParams: SearchParams | undefined): string {
  if (!searchParams) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function MessagesAliasPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  redirect(`/app/inbox${toQueryString(searchParams)}`);
}
