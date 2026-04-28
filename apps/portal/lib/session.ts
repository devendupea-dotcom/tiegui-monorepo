import type { Role } from "@prisma/client";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";

export type AppSession = Session & {
  user?:
    | (Session["user"] & {
        id?: string;
        role?: Role;
        defaultOrgId?: string | null;
        orgId?: string | null;
        mustChangePassword?: boolean;
      })
    | null;
};

export type AppSessionUser = NonNullable<AppSession["user"]>;

export function isInternalRole(role: Role | string | null | undefined): role is "INTERNAL" {
  return role === "INTERNAL";
}

export async function requireSessionUser(nextPath: string): Promise<AppSessionUser> {
  const session = (await getServerSession(authOptions)) as AppSession | null;
  if (!session?.user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return session.user;
}

export async function requireInternalUser(nextPath: string): Promise<AppSessionUser> {
  const user = await requireSessionUser(nextPath);
  if (!isInternalRole(user.role)) {
    redirect("/app");
  }
  return user;
}

export function getDefaultSessionOrgId(user: Pick<AppSessionUser, "defaultOrgId" | "orgId">): string | null {
  return user.defaultOrgId ?? user.orgId ?? null;
}

/**
 * @deprecated Legacy compatibility helper during tenant-access rollout.
 * Membership-aware org resolution happens server-side in app-api-permissions.ts.
 */
export function requireClientOrgId(user: Pick<AppSessionUser, "role" | "defaultOrgId" | "orgId">): string {
  const defaultOrgId = getDefaultSessionOrgId(user);
  if (!isInternalRole(user.role) && defaultOrgId) {
    return defaultOrgId;
  }

  throw new Error("Client account is missing org scope.");
}

/**
 * @deprecated Legacy compatibility helper during tenant-access rollout.
 * It only checks the default workspace carried in session and does not replace
 * server-side membership resolution for multi-org users.
 */
export function canAccessOrg(user: Pick<AppSessionUser, "role" | "defaultOrgId" | "orgId">, orgId: string): boolean {
  return isInternalRole(user.role) || getDefaultSessionOrgId(user) === orgId;
}
