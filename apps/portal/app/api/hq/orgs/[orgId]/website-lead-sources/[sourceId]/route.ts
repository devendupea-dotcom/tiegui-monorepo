import { NextResponse } from "next/server";
import {
  getOptionalString,
  jsonFromHqApiError,
  readJsonObject,
  requireInternalApiUser,
} from "@/lib/hq-api";
import { updateWebsiteLeadSource } from "@/lib/website-lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ orgId: string; sourceId: string }>;
};

export async function PATCH(req: Request, props: RouteContext) {
  try {
    await requireInternalApiUser();
    const params = await props.params;
    const body = await readJsonObject(req);

    const source = await updateWebsiteLeadSource({
      orgId: params.orgId,
      sourceId: params.sourceId,
      name: getOptionalString(body, "name") ?? undefined,
      description: getOptionalString(body, "description"),
      allowedOrigin: getOptionalString(body, "allowedOrigin"),
    });

    return NextResponse.json({
      ok: true,
      source,
    });
  } catch (error) {
    return jsonFromHqApiError(error, "Failed to update website lead source.");
  }
}
