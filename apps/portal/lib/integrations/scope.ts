import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isInternalRole, type AppSessionUser } from "@/lib/session";

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

export function assertOrgAccess(user: Pick<AppSessionUser, "role" | "orgId">, orgId: string) {
  if (isInternalRole(user.role)) {
    return;
  }

  if (!user.orgId || user.orgId !== orgId) {
    throw new IntegrationScopeError("Forbidden", 403);
  }
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
  const internalUser = isInternalRole(user.role);

  if (!internalUser) {
    if (!user.orgId) {
      throw new IntegrationScopeError("Client account is missing org scope.", 400);
    }
    return {
      orgId: user.orgId,
      internalUser: false,
      user,
    };
  }

  const requestedOrgId = getQueryParam(req, "orgId");
  if (requestedOrgId) {
    const exists = await prisma.organization.findUnique({
      where: { id: requestedOrgId },
      select: { id: true },
    });
    if (!exists) {
      throw new IntegrationScopeError("Organization not found.", 404);
    }
    return {
      orgId: requestedOrgId,
      internalUser: true,
      user,
    };
  }

  const firstOrg = await prisma.organization.findFirst({
    select: { id: true },
    orderBy: { name: "asc" },
  });

  if (!firstOrg) {
    throw new IntegrationScopeError("No organizations found.", 404);
  }

  return {
    orgId: firstOrg.id,
    internalUser: true,
    user,
  };
}
