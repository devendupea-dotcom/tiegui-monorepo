import { redirect } from "next/navigation";
import { getParam } from "@/app/app/_lib/portal-scope";

export default function ExpensesPortalAliasPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  const orgId = getParam(searchParams?.orgId);
  const jobId = getParam(searchParams?.jobId);

  if (orgId) {
    params.set("orgId", orgId);
  }
  if (jobId) {
    params.set("jobId", jobId);
  }

  redirect(params.size ? `/app/expenses?${params.toString()}` : "/app/expenses");
}
