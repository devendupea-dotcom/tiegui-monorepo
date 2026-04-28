import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeEnvValue } from "@/lib/env";
import { encode } from "next-auth/jwt";
import { createHash, timingSafeEqual } from "node:crypto";
import { ensureAdminVaultUnlockAllowed, getClientIpFromHeaders } from "@/lib/auth-rate-limit";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

function safeEqual(a: string, b: string): boolean {
  const aDigest = createHash("sha256").update(a, "utf8").digest();
  const bDigest = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(aDigest, bDigest);
}

const ADMIN_VAULT_SESSION_SECONDS = 30 * 60;

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

  const rateLimit = await ensureAdminVaultUnlockAllowed({
    email: session.user.email,
    ip: getClientIpFromHeaders(req),
    checker: checkSlidingWindowLimit,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many unlock attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  let key = "";
  try {
    const body = (await req.json()) as { key?: unknown };
    key = typeof body.key === "string" ? body.key : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  if (!key || !safeEqual(key, vaultKey)) {
    return NextResponse.json({ ok: false, error: "Invalid vault key." }, { status: 400 });
  }

  const requesterEmail = session.user.email.trim().toLowerCase();
  const requester = await prisma.user.findUnique({
    where: { email: requesterEmail },
    select: { id: true, role: true },
  });
  if (!requester || requester.role !== "INTERNAL") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const token = await encode({
    token: { sub: requester.id, unlocked: true },
    secret: vaultKey,
    salt: "admin-vault",
    maxAge: ADMIN_VAULT_SESSION_SECONDS,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set("tg_admin_vault", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: ADMIN_VAULT_SESSION_SECONDS,
  });
  return response;
}
