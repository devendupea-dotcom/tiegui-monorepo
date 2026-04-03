import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { canManageEstimates } from "@/lib/estimates";
import { getEstimateReferencesForOrg } from "@/lib/estimates-store";
import { getParam, resolveAppScope } from "../../_lib/portal-scope";
import EstimateManager from "../estimate-manager";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({
  params,
  searchParams,
}: {
  params: {
    estimateId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (!params.estimateId) {
    notFound();
  }

  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: `/app/estimates/${params.estimateId}`,
    requestedOrgId,
  });

  const sessionUser = await requireSessionUser(`/app/estimates/${params.estimateId}`);
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        })
      : null;

  const canManage = canManageEstimates({
    internalUser: scope.internalUser,
    calendarAccessRole: currentUser?.calendarAccessRole || "OWNER",
  });

  const references = await getEstimateReferencesForOrg(scope.orgId);

  return (
    <EstimateManager
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      canManage={canManage}
      initialEstimateId={params.estimateId}
      initialCreate={false}
      leadOptions={references.leads}
      materials={references.materials}
    />
  );
}
