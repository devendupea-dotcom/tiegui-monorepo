import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
  type AppApiActor,
} from "@/lib/app-api-permissions";

export type AppScope = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  onboardingComplete: boolean;
};

export type AppScopeActor = AppApiActor & {
  orgId: string;
};

export function getParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function withOrgQuery(path: string, orgId: string, internalUser: boolean): string {
  if (!internalUser) {
    return path;
  }
  const hashIndex = path.indexOf("#");
  const basePath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const joiner = basePath.includes("?") ? "&" : "?";
  return `${basePath}${joiner}orgId=${encodeURIComponent(orgId)}${hash}`;
}

export function isOpenJobStatus(status: string): boolean {
  return status !== "NOT_INTERESTED" && status !== "DNC";
}

function redirectToLogin(nextPath: string): never {
  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

function handlePortalScopeResolutionError(input: {
  error: unknown;
  nextPath: string;
  internalUser: boolean;
}): never {
  const { error, nextPath, internalUser } = input;

  if (error instanceof AppApiError) {
    if (error.status === 401) {
      redirectToLogin(nextPath);
    }

    if (internalUser) {
      redirect("/hq/businesses");
    }

    if (nextPath !== "/app") {
      redirect("/app");
    }

    throw new Error(error.message);
  }

  throw error;
}

export async function requireAppOrgActor(nextPath: string, orgId: string): Promise<AppScopeActor> {
  let actor: AppApiActor;
  try {
    actor = await requireAppApiActor();
  } catch (error) {
    handlePortalScopeResolutionError({
      error,
      nextPath,
      internalUser: false,
    });
  }

  try {
    await resolveActorOrgId({
      actor,
      requestedOrgId: orgId,
    });
  } catch (error) {
    handlePortalScopeResolutionError({
      error,
      nextPath,
      internalUser: actor.internalUser,
    });
  }

  return actor as AppScopeActor;
}

export async function resolveAppScope({
  nextPath,
  requestedOrgId,
}: {
  nextPath: string;
  requestedOrgId?: string;
}): Promise<AppScope> {
  let actor: AppApiActor;
  try {
    actor = await requireAppApiActor();
  } catch (error) {
    handlePortalScopeResolutionError({
      error,
      nextPath,
      internalUser: false,
    });
  }

  let resolvedOrgId: string;
  try {
    resolvedOrgId = await resolveActorOrgId({
      actor,
      requestedOrgId,
    });
  } catch (error) {
    handlePortalScopeResolutionError({
      error,
      nextPath,
      internalUser: actor.internalUser,
    });
  }

  const org = await prisma.organization.findUnique({
    where: { id: resolvedOrgId },
    select: {
      id: true,
      name: true,
      onboardingCompletedAt: true,
    },
  });

  if (!org) {
    if (actor.internalUser) {
      redirect("/hq/businesses");
    }
    redirect("/app");
  }

  const onboardingIncomplete = !org.onboardingCompletedAt;
  const onboardingPath = nextPath.startsWith("/app/onboarding");
  if (!actor.internalUser && onboardingIncomplete && !onboardingPath) {
    const onboardingUrl = new URL("/app/onboarding", "http://localhost");
    onboardingUrl.searchParams.set("step", "1");
    redirect(withOrgQuery(`${onboardingUrl.pathname}${onboardingUrl.search}`, org.id, actor.internalUser));
  }

  return {
    orgId: org.id,
    orgName: org.name,
    internalUser: actor.internalUser,
    onboardingComplete: !onboardingIncomplete,
  };
}

export async function requireAppOrgAccess(nextPath: string, orgId: string): Promise<{ internalUser: boolean }> {
  const actor = await requireAppOrgActor(nextPath, orgId);
  return { internalUser: actor.internalUser };
}
