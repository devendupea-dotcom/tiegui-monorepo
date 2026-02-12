import { redirect } from "next/navigation";
import { isInternalRole, requireSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LegacyDashboardRedirect() {
  const user = await requireSessionUser("/dashboard");

  if (isInternalRole(user.role)) {
    redirect("/hq");
  }

  redirect("/app");
}
