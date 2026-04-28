import { NextResponse } from "next/server";
import {
  getOptionalString,
  jsonFromHqApiError,
  readJsonObject,
  requireInternalApiUser,
} from "@/lib/hq-api";
import {
  createWebsiteLeadSource,
  listWebsiteLeadSources,
  listWebsiteLeadSubmissionReceipts,
} from "@/lib/website-lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ orgId: string }>;
};

export async function GET(_req: Request, props: RouteContext) {
  try {
    await requireInternalApiUser();
    const params = await props.params;
    const [sources, recentReceipts] = await Promise.all([
      listWebsiteLeadSources(params.orgId),
      listWebsiteLeadSubmissionReceipts({ orgId: params.orgId, take: 25 }),
    ]);

    return NextResponse.json({
      ok: true,
      sources,
      recentReceipts,
    });
  } catch (error) {
    return jsonFromHqApiError(error, "Failed to list website lead sources.");
  }
}

export async function POST(req: Request, props: RouteContext) {
  try {
    await requireInternalApiUser();
    const params = await props.params;
    const body = await readJsonObject(req);
    const name = getOptionalString(body, "name");
    const description = getOptionalString(body, "description");
    const allowedOrigin = getOptionalString(body, "allowedOrigin");

    const result = await createWebsiteLeadSource({
      orgId: params.orgId,
      name: name || "",
      description,
      allowedOrigin,
    });

    return NextResponse.json(
      {
        ok: true,
        source: result.source,
        plaintextSecret: result.plaintextSecret,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonFromHqApiError(error, "Failed to create website lead source.");
  }
}
