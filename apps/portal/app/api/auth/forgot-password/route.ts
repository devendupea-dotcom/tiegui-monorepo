import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createResetToken } from "@/lib/tokens";
import { sendEmail } from "@/lib/mailer";
import { getBaseUrlFromRequest } from "@/lib/urls";

type RateLimitBucket = { count: number; resetAt: number };
const buckets = new Map<string, RateLimitBucket>();

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

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
  const ip = getClientIp(req);
  if (!normalizedEmail || isRateLimited(`forgot:${ip}`, 10, 60_000)) {
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

