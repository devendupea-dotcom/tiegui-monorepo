import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decode, getToken } from "next-auth/jwt";
import { normalizeEnvValue } from "./lib/env";

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isInternal = (role: unknown) => role === "INTERNAL";

  let token: Awaited<ReturnType<typeof getToken>> | null = null;
  try {
    token = await getToken({ req, secret: normalizeEnvValue(process.env.NEXTAUTH_SECRET) });
  } catch (error) {
    console.error("middleware:getToken failed", error);
    token = null;
  }

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if ((token as any).mustChangePassword && pathname !== "/set-password") {
    const setPasswordUrl = new URL("/set-password", req.url);
    setPasswordUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(setPasswordUrl);
  }

  if (pathname.startsWith("/hq") && !isInternal(token.role)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (pathname.startsWith("/app") && isInternal(token.role)) {
    return NextResponse.redirect(new URL("/hq", req.url));
  }

  if (pathname.startsWith("/admin")) {
    if (!isInternal(token.role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // Admin routes are locked behind an additional vault key.
    // This avoids leaving admin tools unlocked just because someone found a session cookie.
    const vaultKey = normalizeEnvValue(process.env.ADMIN_VAULT_KEY);
    if (!vaultKey) {
      const unlockUrl = new URL("/admin/unlock", req.url);
      unlockUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(unlockUrl);
    }

    if (pathname === "/admin/unlock") {
      return NextResponse.next();
    }

    const vaultToken = req.cookies.get("tg_admin_vault")?.value;
    const decoded = await decode({ token: vaultToken, secret: vaultKey, salt: "admin-vault" });
    if (!decoded || decoded.sub !== token.sub || decoded.unlocked !== true) {
      const unlockUrl = new URL("/admin/unlock", req.url);
      unlockUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(unlockUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/app/:path*", "/hq/:path*", "/admin/:path*", "/set-password"],
};
