import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isInternalRole } from "@/lib/session";

export class HqApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "hq_api_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function requireInternalApiUser() {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user || !isInternalRole(user.role)) {
    throw new HqApiError("Unauthorized", 401, "unauthorized");
  }
  return user;
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HqApiError("Invalid JSON body.", 400, "invalid_json");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HqApiError("JSON body must be an object.", 400, "invalid_body");
  }

  return body as Record<string, unknown>;
}

export function getOptionalString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HqApiError(`${key} must be a string.`, 400, `invalid_${key}`);
  }
  return value;
}

export function jsonFromHqApiError(error: unknown, fallbackMessage = "HQ API request failed.") {
  if (error instanceof HqApiError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "request_error";
    return NextResponse.json(
      { ok: false, error: error.message, code },
      { status },
    );
  }

  return NextResponse.json(
    { ok: false, error: fallbackMessage },
    { status: 500 },
  );
}
