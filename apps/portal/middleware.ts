import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { normalizeEnvValue } from "./lib/env";

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

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

  if (pathname.startsWith("/admin") && token.role !== "SUPERADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"]
};
