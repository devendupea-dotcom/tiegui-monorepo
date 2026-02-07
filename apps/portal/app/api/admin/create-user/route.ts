import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createResetToken } from "@/lib/tokens";
import { sendEmail } from "@/lib/mailer";
import { getBaseUrlFromRequest } from "@/lib/urls";
import { decode } from "next-auth/jwt";
import { normalizeEnvValue } from "@/lib/env";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const requesterRole = session?.user?.role;
  if (!session?.user?.email || requesterRole !== "INTERNAL") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const vaultKey = normalizeEnvValue(process.env.ADMIN_VAULT_KEY);
  if (!vaultKey) {
    return NextResponse.json(
      { ok: false, error: "Admin vault is not configured (missing ADMIN_VAULT_KEY)." },
      { status: 500 },
    );
  }

  const requesterEmail = session.user.email.trim().toLowerCase();
  const requester = await prisma.user.findUnique({
    where: { email: requesterEmail },
    select: { id: true, role: true },
  });

  if (!requester || requester.role !== "INTERNAL") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const vaultToken = cookies().get("tg_admin_vault")?.value;
  const decoded = await decode({ token: vaultToken, secret: vaultKey, salt: "admin-vault" });
  if (!decoded || decoded.sub !== requester.id || decoded.unlocked !== true) {
    return NextResponse.json({ ok: false, error: "Admin vault is locked. Unlock it first." }, { status: 403 });
  }

  let email = "";
  let role: "CLIENT" | "INTERNAL" = "CLIENT";
  let orgId: string | null = null;
  let sendWelcomeEmail = true;
  let name: string | null = null;
  try {
    const body = (await req.json()) as {
      email?: unknown;
      role?: unknown;
      orgId?: unknown;
      sendEmail?: unknown;
      name?: unknown;
    };
    email = typeof body.email === "string" ? body.email : "";
    role = body.role === "INTERNAL" ? "INTERNAL" : "CLIENT";
    orgId = typeof body.orgId === "string" ? body.orgId : null;
    sendWelcomeEmail = typeof body.sendEmail === "boolean" ? body.sendEmail : sendWelcomeEmail;
    name = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : null;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  }

  if (role === "CLIENT") {
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "Client users must be assigned to an organization." },
        { status: 400 },
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ ok: false, error: "Invalid organization." }, { status: 400 });
    }
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: false, error: "User already exists." }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      name,
      role,
      orgId: role === "CLIENT" ? orgId : null,
      mustChangePassword: true,
    },
    select: { id: true, email: true },
  });

  const { token, tokenHash } = createResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt,
    },
  });

  const baseUrl = getBaseUrlFromRequest(req);
  const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  if (sendWelcomeEmail) {
    try {
      await sendEmail({
        to: user.email,
        subject: "Set up your portal password",
        text: `You now have access to the TieGui Portal.\n\nSet your password here:\n${setupUrl}\n\nThis link expires in 60 minutes.\n\nAfter setting your password, you can sign in at:\n${baseUrl}/login`,
      });
    } catch (error) {
      console.error("admin:create-user sendEmail failed", error);
    }
  }

  return NextResponse.json({ ok: true, user, ...(sendWelcomeEmail ? {} : { setupUrl }) });
}
