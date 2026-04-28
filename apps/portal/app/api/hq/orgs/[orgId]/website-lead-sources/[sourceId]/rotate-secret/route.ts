import { NextResponse } from "next/server";
import { jsonFromHqApiError, requireInternalApiUser } from "@/lib/hq-api";
import { rotateWebsiteLeadSourceSecret } from "@/lib/website-lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ orgId: string; sourceId: string }>;
};

export async function POST(_req: Request, props: RouteContext) {
  try {
    await requireInternalApiUser();
    const params = await props.params;
    const result = await rotateWebsiteLeadSourceSecret({
      orgId: params.orgId,
      sourceId: params.sourceId,
    });

    return NextResponse.json({
      ok: true,
      source: result.source,
      plaintextSecret: result.plaintextSecret,
    });
  } catch (error) {
    return jsonFromHqApiError(error, "Failed to rotate website lead source secret.");
  }
}
