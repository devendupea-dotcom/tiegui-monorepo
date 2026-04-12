import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { type AppSessionUser } from "@/lib/session";

export class IntegrationScopeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function getQueryParam(req: Request, key: string): string | null {
  const value = new URL(req.url).searchParams.get(key);
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function requireIntegrationSessionUser(): Promise<AppSessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new IntegrationScopeError("Unauthorized", 401);
  }
  return session.user as AppSessionUser;
}

export async function resolveIntegrationOrgScope(req: Request): Promise<{
  orgId: string;
  internalUser: boolean;
  user: AppSessionUser;
}> {
  const user = await requireIntegrationSessionUser();
  const requestedOrgId = getQueryParam(req, "orgId");

  try {
    const actor = await requireAppApiActor();
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId,
    });
    return {
      orgId,
      internalUser: actor.internalUser,
      user,
    };
  } catch (error) {
    if (error instanceof AppApiError) {
      throw new IntegrationScopeError(error.message, error.status);
    }
    throw error;
  }
}

export async function assertOrgAccess(
  user: Pick<AppSessionUser, "id" | "role" | "orgId">,
  orgId: string,
): Promise<void> {
  if (!user.id) {
    throw new IntegrationScopeError("Unauthorized", 401);
  }

  try {
    const actor = await requireAppApiActor();
    if (actor.id !== user.id) {
      throw new IntegrationScopeError("Unauthorized", 401);
    }
    await resolveActorOrgId({
      actor,
      requestedOrgId: orgId,
    });
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      throw error;
    }
    if (error instanceof AppApiError) {
      throw new IntegrationScopeError(error.message, error.status);
    }
    throw error;
  }
}
