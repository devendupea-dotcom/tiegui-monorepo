import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessOrg, isInternalRole, requireSessionUser } from "@/lib/session";

export type AppScope = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  onboardingComplete: boolean;
};

export function getParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function withOrgQuery(path: string, orgId: string, internalUser: boolean): string {
  if (!internalUser) {
    return path;
  }
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`;
}

export function isOpenJobStatus(status: string): boolean {
  return status !== "NOT_INTERESTED" && status !== "DNC";
}

export async function resolveAppScope({
  nextPath,
  requestedOrgId,
}: {
  nextPath: string;
  requestedOrgId?: string;
}): Promise<AppScope> {
  const user = await requireSessionUser(nextPath);
  const internalUser = isInternalRole(user.role);

  if (!internalUser) {
    if (!user.orgId) {
      redirect("/login?next=/app");
    }

    const org = await prisma.organization.findUnique({
      where: { id: user.orgId },
      select: {
        id: true,
        name: true,
        onboardingCompletedAt: true,
      },
    });

    if (!org) {
      redirect("/app");
    }

    const onboardingIncomplete = !org.onboardingCompletedAt;
    const onboardingPath = nextPath.startsWith("/app/onboarding");
    if (onboardingIncomplete && !onboardingPath) {
      const onboardingUrl = new URL("/app/onboarding", "http://localhost");
      onboardingUrl.searchParams.set("step", "1");
      redirect(`${onboardingUrl.pathname}${onboardingUrl.search}`);
    }

    return {
      orgId: org.id,
      orgName: org.name,
      internalUser: false,
      onboardingComplete: !onboardingIncomplete,
    };
  }

  const requested = getParam(requestedOrgId);
  if (requested) {
    const org = await prisma.organization.findUnique({
      where: { id: requested },
      select: { id: true, name: true },
    });

    if (!org) {
      redirect("/hq/businesses");
    }

    return {
      orgId: org.id,
      orgName: org.name,
      internalUser: true,
      onboardingComplete: true,
    };
  }

  const firstOrg = await prisma.organization.findFirst({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!firstOrg) {
    redirect("/hq/businesses");
  }

  return {
    orgId: firstOrg.id,
    orgName: firstOrg.name,
    internalUser: true,
    onboardingComplete: true,
  };
}

export async function requireAppOrgAccess(nextPath: string, orgId: string): Promise<{ internalUser: boolean }> {
  const user = await requireSessionUser(nextPath);
  const internalUser = isInternalRole(user.role);

  if (!canAccessOrg(user, orgId)) {
    redirect("/app");
  }

  return { internalUser };
}
