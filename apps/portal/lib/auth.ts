import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { normalizeEnvValue } from "./env";
import { verifyPassword } from "./passwords";

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

function withEmailVerified<T extends { [key: string]: unknown }>(user: T | null) {
  if (!user) return null;
  if ("emailVerified" in user) return user;
  return { ...user, emailVerified: null };
}

const baseAdapter = PrismaAdapter(prisma);

const adapter: Adapter = {
  ...baseAdapter,
  async createUser(data: any) {
    const email = data.email?.trim().toLowerCase();
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

    // Our Prisma User model does not store emailVerified, but NextAuth expects it.
    return { ...user, emailVerified: null } as any;
  },
  async updateUser(data: any) {
    const email = data.email?.trim().toLowerCase();

    // NextAuth may pass fields (like emailVerified, name, image) that don't exist in our User model.
    const user = await prisma.user.update({
      where: { id: data.id },
      data: {
        ...(email ? { email } : {}),
      },
    });

    return { ...user, emailVerified: null } as any;
  },
  async getUser(id) {
    const user = await baseAdapter.getUser?.(id);
    return withEmailVerified(user as any) as any;
  },
  async getUserByEmail(email) {
    const user = await baseAdapter.getUserByEmail?.(email);
    return withEmailVerified(user as any) as any;
  },
  async getUserByAccount(account) {
    const user = await baseAdapter.getUserByAccount?.(account);
    return withEmailVerified(user as any) as any;
  },
  async getSessionAndUser(sessionToken) {
    const result = await baseAdapter.getSessionAndUser?.(sessionToken);
    if (!result) return null;
    return {
      ...result,
      user: withEmailVerified(result.user as any),
    } as any;
  },
};

type RateLimitBucket = { count: number; resetAt: number };
const loginBuckets = new Map<string, RateLimitBucket>();

function getClientIp(req: any): string {
  const headers = req?.headers;
  const xff =
    typeof headers?.get === "function"
      ? headers.get("x-forwarded-for")
      : headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0]!.trim();
  const realIp =
    typeof headers?.get === "function" ? headers.get("x-real-ip") : headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.length) return realIp.trim();
  return "unknown";
}

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    loginBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

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

        const ip = getClientIp(req);
        const bucketKey = `credentials:${ip}:${email}`;
        if (isRateLimited(bucketKey, 10, 60_000)) {
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

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          orgId: user.orgId,
          mustChangePassword: user.mustChangePassword,
        } as any;
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
      if (user) {
        token.role = (user as any).role;
        token.orgId = (user as any).orgId ?? null;
        token.mustChangePassword = (user as any).mustChangePassword ?? false;
        token.name = (user as any).name ?? token.name ?? null;
        return token;
      }

      // If the user is forced to change their password, keep checking the DB so we can
      // clear the flag immediately after /set-password succeeds.
      if (((token as any).mustChangePassword || !token.name) && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { name: true, role: true, orgId: true, mustChangePassword: true },
        });
        if (dbUser) {
          token.name = dbUser.name ?? token.name ?? null;
          token.role = dbUser.role;
          token.orgId = dbUser.orgId ?? null;
          (token as any).mustChangePassword = dbUser.mustChangePassword;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = (typeof token.name === "string" ? token.name : session.user.name) ?? null;
        (session.user as any).id = token.sub;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId ?? null;
        (session.user as any).mustChangePassword = (token as any).mustChangePassword ?? false;
      }
      return session;
    },
  },
};
