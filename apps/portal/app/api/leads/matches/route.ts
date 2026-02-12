import { NextResponse } from "next/server";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { AppApiError, requireAppApiActor, resolveActorOrgId } from "@/lib/app-api-permissions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const rawPhone = url.searchParams.get("phone")?.trim() || "";
    const requestedOrgId = url.searchParams.get("orgId")?.trim() || null;
    const orgId = await resolveActorOrgId({ actor, requestedOrgId });

    const phoneE164 = normalizeE164(rawPhone);
    if (!phoneE164) {
      return NextResponse.json({ ok: true, matches: [] });
    }

    const matches = await prisma.customer.findMany({
      where: {
        orgId,
        phoneE164,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        addressLine: true,
      },
    });

    return NextResponse.json({
      ok: true,
      matches,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to lookup customer matches.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
