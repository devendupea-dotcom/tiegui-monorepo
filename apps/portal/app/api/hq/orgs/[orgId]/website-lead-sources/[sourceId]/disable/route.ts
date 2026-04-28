import { NextResponse } from "next/server";
import { jsonFromHqApiError, requireInternalApiUser } from "@/lib/hq-api";
import { setWebsiteLeadSourceActive } from "@/lib/website-lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ orgId: string; sourceId: string }>;
};

export async function POST(_req: Request, props: RouteContext) {
  try {
    await requireInternalApiUser();
    const params = await props.params;
    const source = await setWebsiteLeadSourceActive({
      orgId: params.orgId,
      sourceId: params.sourceId,
      active: false,
    });

    return NextResponse.json({
      ok: true,
      source,
    });
  } catch (error) {
    return jsonFromHqApiError(error, "Failed to disable website lead source.");
  }
}
