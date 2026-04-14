import type { NextAuthOptions } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import type { JWT } from "next-auth/jwt";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Role } from "@prisma/client";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { ensureCredentialLoginAllowed, getClientIpFromHeaders } from "./auth-rate-limit";
import { prisma } from "./prisma";
import { normalizeEnvValue } from "./env";
import { verifyPassword } from "./passwords";
import { checkSlidingWindowLimit } from "./rate-limit";

// Prefer SMTP_URL (our canonical name) but allow EMAIL_SERVER for compatibility.
// Also strip accidental wrapping quotes from Vercel env vars.
const emailServer = normalizeEnvValue(process.env.SMTP_URL) || normalizeEnvValue(process.env.EMAIL_SERVER);
const emailFrom = normalizeEnvValue(process.env.EMAIL_FROM);
const nextAuthSecret = normalizeEnvValue(process.env.NEXTAUTH_SECRET);
const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);

function parseAdminEmails(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

type AppAuthUser = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  defaultOrgId: string | null;
  orgId: string | null;
  mustChangePassword: boolean;
};

type AppJwt = JWT & {
  role?: Role;
  defaultOrgId?: string | null;
  orgId?: string | null;
  mustChangePassword?: boolean;
};

type SessionUserExtras = {
  id?: string;
  role?: Role;
  defaultOrgId?: string | null;
  orgId?: string | null;
  mustChangePassword?: boolean;
};

type AdapterCreateUserInput = Parameters<NonNullable<Adapter["createUser"]>>[0];
type AdapterUpdateUserInput = Parameters<NonNullable<Adapter["updateUser"]>>[0];

function withEmailVerified<T extends { emailVerified?: Date | null }>(user: T | null | undefined): (T & { emailVerified: Date | null }) | null {
  if (!user) return null;
  return { ...user, emailVerified: user.emailVerified ?? null };
}

function toAdapterUser(user: { id: string; email: string; name: string | null }): AdapterUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: null,
  };
}

function readRole(value: unknown): Role | undefined {
  return value === "INTERNAL" || value === "CLIENT" ? value : undefined;
}

function readAppAuthUser(user: unknown): Partial<AppAuthUser> {
  if (!user || typeof user !== "object") {
    return {};
  }

  const record = user as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    name: typeof record.name === "string" || record.name === null ? (record.name as string | null) : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
    role: readRole(record.role),
    defaultOrgId:
      typeof record.defaultOrgId === "string" || record.defaultOrgId === null
        ? (record.defaultOrgId as string | null)
        : undefined,
    orgId: typeof record.orgId === "string" || record.orgId === null ? (record.orgId as string | null) : undefined,
    mustChangePassword: typeof record.mustChangePassword === "boolean" ? record.mustChangePassword : undefined,
  };
}

const baseAdapter = PrismaAdapter(prisma);

const adapter: Adapter = {
  ...baseAdapter,
  async createUser(data: AdapterCreateUserInput) {
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email) throw new Error("Missing email");

    const hasAnyUser = Boolean(
      await prisma.user.findFirst({
        select: { id: true },
      }),
    );

    // Invite-only: do NOT create users automatically via auth. The only exception is
    // a one-time bootstrap of the very first INTERNAL user on a brand new database.
    const isBootstrapAllowed = !hasAnyUser && (adminEmails.length === 0 || adminEmails.includes(email));
    if (!isBootstrapAllowed) {
      throw new Error("Invite required");
    }

    const localPart = email.split("@")[0] ?? "";
    const fallbackName = localPart
      .split(/[._-]/g)
      .filter((part: string): part is string => Boolean(part))
      .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

    const user = await prisma.user.create({
      data: {
        name: fallbackName || null,
        email,
        role: "INTERNAL",
        orgId: null,
        mustChangePassword: true,
      },
    });

    return toAdapterUser(user);
  },
  async updateUser(data: AdapterUpdateUserInput) {
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : undefined;

    // NextAuth may pass fields (like emailVerified, name, image) that don't exist in our User model.
    const user = await prisma.user.update({
      where: { id: data.id },
      data: {
        ...(email ? { email } : {}),
      },
    });

    return toAdapterUser(user);
  },
  async getUser(id) {
    const user = await baseAdapter.getUser?.(id);
    return withEmailVerified(user);
  },
  async getUserByEmail(email) {
    const user = await baseAdapter.getUserByEmail?.(email);
    return withEmailVerified(user);
  },
  async getUserByAccount(account) {
    const user = await baseAdapter.getUserByAccount?.(account);
    return withEmailVerified(user);
  },
  async getSessionAndUser(sessionToken) {
    const result = await baseAdapter.getSessionAndUser?.(sessionToken);
    if (!result?.user) return null;
    const user = withEmailVerified(result.user);
    if (!user) return null;
    return {
      ...result,
      user,
    };
  },
};

export const authOptions: NextAuthOptions = {
  secret: nextAuthSecret,
  adapter,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
    verifyRequest: "/login?verify=1",
  },
  providers: [
    CredentialsProvider({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (!email || typeof password !== "string" || password.length === 0) return null;

        const ip = getClientIpFromHeaders(req);
        const rateLimit = await ensureCredentialLoginAllowed({
          email,
          ip,
          checker: checkSlidingWindowLimit,
        });
        if (!rateLimit.ok) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            orgId: true,
            passwordHash: true,
            mustChangePassword: true,
          },
        });

        if (!user?.passwordHash) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        const authUser: AppAuthUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          defaultOrgId: user.orgId,
          orgId: user.orgId,
          mustChangePassword: user.mustChangePassword,
        };

        return authUser;
      },
    }),
    ...(emailServer && emailFrom
      ? [
          EmailProvider({
            server: emailServer,
            from: emailFrom,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const appToken = token as AppJwt;

      if (user) {
        const authUser = readAppAuthUser(user);
        appToken.role = authUser.role;
        appToken.defaultOrgId = authUser.defaultOrgId ?? authUser.orgId ?? null;
        appToken.orgId = authUser.orgId ?? null;
        appToken.mustChangePassword = authUser.mustChangePassword ?? false;
        appToken.name = authUser.name ?? token.name ?? null;
        return appToken;
      }

      // If the user is forced to change their password, keep checking the DB so we can
      // clear the flag immediately after /set-password succeeds.
      if ((appToken.mustChangePassword || !token.name) && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { name: true, role: true, orgId: true, mustChangePassword: true },
        });
        if (dbUser) {
          appToken.name = dbUser.name ?? token.name ?? null;
          appToken.role = dbUser.role;
          appToken.defaultOrgId = dbUser.orgId ?? null;
          appToken.orgId = dbUser.orgId ?? null;
          appToken.mustChangePassword = dbUser.mustChangePassword;
        }
      }
      return appToken;
    },
    async session({ session, token }) {
      if (session.user) {
        const sessionUser = session.user as typeof session.user & SessionUserExtras;
        const appToken = token as AppJwt;
        session.user.name = (typeof token.name === "string" ? token.name : session.user.name) ?? null;
        sessionUser.id = token.sub;
        sessionUser.role = appToken.role;
        sessionUser.defaultOrgId = appToken.defaultOrgId ?? token.orgId ?? null;
        sessionUser.orgId = appToken.orgId ?? null;
        sessionUser.mustChangePassword = appToken.mustChangePassword ?? false;
      }
      return session;
    },
  },
};
