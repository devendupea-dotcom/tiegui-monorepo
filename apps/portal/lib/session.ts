import type { Role } from "@prisma/client";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";

export type AppSession = Session & {
  user?:
    | (Session["user"] & {
        id?: string;
        role?: Role;
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
    redirect("/dashboard");
  }
  return user;
}

export function requireClientOrgId(user: Pick<AppSessionUser, "role" | "orgId">): string {
  if (!isInternalRole(user.role) && user.orgId) {
    return user.orgId;
  }

  throw new Error("Client account is missing org scope.");
}

export function canAccessOrg(user: Pick<AppSessionUser, "role" | "orgId">, orgId: string): boolean {
  return isInternalRole(user.role) || user.orgId === orgId;
}
