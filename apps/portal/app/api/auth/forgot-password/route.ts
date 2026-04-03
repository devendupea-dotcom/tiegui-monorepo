import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureForgotPasswordAllowed, getClientIpFromHeaders } from "@/lib/auth-rate-limit";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { createResetToken } from "@/lib/tokens";
import { sendEmail } from "@/lib/mailer";
import { getBaseUrlFromRequest } from "@/lib/urls";

export async function POST(req: Request) {
  // Always return a generic success response (don't reveal whether the email exists).
  let email = "";
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email : "";
  } catch {
    // ignore
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return NextResponse.json({ ok: true });
  }

  const ip = getClientIpFromHeaders(req);
  const rateLimit = await ensureForgotPasswordAllowed({
    email: normalizedEmail,
    ip,
    checker: checkSlidingWindowLimit,
  });
  if (!rateLimit.ok) {
    return NextResponse.json({ ok: true });
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ ok: true });
  }

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
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendEmail({
      to: user.email,
      subject: "Reset your portal password",
      text: `Use this link to reset your password:\n\n${resetUrl}\n\nThis link expires in 60 minutes. If you didn’t request this, you can ignore this email.`,
    });
  } catch (error) {
    console.error("forgot-password: sendEmail failed", error);
  }

  return NextResponse.json({ ok: true });
}
