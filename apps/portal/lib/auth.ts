import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "./prisma";
import { randomUUID } from "crypto";

const emailServer = process.env.EMAIL_SERVER || process.env.SMTP_URL;
const emailFrom = process.env.EMAIL_FROM;

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

const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
const baseAdapter = PrismaAdapter(prisma);

const adapter: Adapter = {
  ...baseAdapter,
  async createUser(data: any) {
    const email = data.email?.trim().toLowerCase();
    if (!email) throw new Error("Missing email");

    // Bootstrap a minimal org + user so email sign-in can work on a fresh database.
    const [domain] = email.split("@").slice(1);
    const organizationName = domain || "New Organization";

    const organization = await prisma.organization.create({
      data: {
        name: organizationName,
        twilioNumber: `pending-${randomUUID()}`,
      },
    });

    const hasAnyUser = Boolean(
      await prisma.user.findFirst({
        select: { id: true },
      }),
    );

    const role = !hasAnyUser || adminEmails.includes(email) ? "SUPERADMIN" : "CLIENT";
    const user = await prisma.user.create({
      data: {
        email,
        role,
        organizationId: organization.id,
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

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  adapter,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
    verifyRequest: "/login?verify=1",
  },
  providers: [
    EmailProvider({
      server: emailServer,
      from: emailFrom,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.organizationId = (user as any).organizationId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).organizationId = token.organizationId;
      }
      return session;
    },
  },
};
