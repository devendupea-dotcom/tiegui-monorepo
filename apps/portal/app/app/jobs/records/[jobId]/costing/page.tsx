import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManageJobCosting } from "@/lib/job-costing";
import { getParam, resolveAppScope } from "../../../../_lib/portal-scope";
import JobCostingManager from "./job-costing-manager";

export const dynamic = "force-dynamic";

export default async function JobCostingDetailPage({
  params,
  searchParams,
}: {
  params: {
    jobId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (!params.jobId) {
    notFound();
  }

  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: `/app/jobs/records/${params.jobId}/costing`,
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser(`/app/jobs/records/${params.jobId}/costing`);
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManageJobCosting({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  return (
    <JobCostingManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
      initialJobId={params.jobId}
    />
  );
}
