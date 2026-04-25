import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken, decode } from "next-auth/jwt";
import { normalizeEnvValue } from "./lib/env";

type GetTokenRequest = NonNullable<Parameters<typeof getToken>[0]>["req"];

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const token = await getToken({
    req: req as unknown as GetTokenRequest,
    secret: normalizeEnvValue(process.env.NEXTAUTH_SECRET),
  });

  // Not logged in → login
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = token.role;
  const isInternal = role === "INTERNAL";

  // Force password reset
  if (token.mustChangePassword && pathname !== "/set-password") {
    return NextResponse.redirect(new URL("/set-password", req.url));
  }

  // 🔥 FORCE INTERNAL USERS INTO HQ
  if (isInternal && !pathname.startsWith("/hq") && !pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/hq", req.url));
  }

  // Admin vault protection
  if (pathname.startsWith("/admin")) {
    if (!isInternal) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    const vaultKey = normalizeEnvValue(process.env.ADMIN_VAULT_KEY);
    if (!vaultKey) {
      return NextResponse.redirect(new URL("/admin/unlock", req.url));
    }

    if (pathname === "/admin/unlock") return NextResponse.next();

    const vaultToken = req.cookies.get("tg_admin_vault")?.value;
    const decoded = await decode({
      token: vaultToken,
      secret: vaultKey,
      salt: "admin-vault",
    });

    if (!decoded || decoded.sub !== token.sub || decoded.unlocked !== true) {
      return NextResponse.redirect(new URL("/admin/unlock", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/hq/:path*", "/admin/:path*", "/set-password"],
};
