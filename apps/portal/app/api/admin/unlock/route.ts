import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeEnvValue } from "@/lib/env";
import { encode } from "next-auth/jwt";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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
    maxAge: 60 * 60 * 12,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set("tg_admin_vault", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
