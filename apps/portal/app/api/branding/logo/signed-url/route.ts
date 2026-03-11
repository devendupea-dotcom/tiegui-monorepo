import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getPhotoStorageRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { upstashRedis } from "@/lib/upstash";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:branding:logo:signed-url",
      limit: 120,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const url = new URL(req.url);
    const requestedOrgId = url.searchParams.get("orgId");
    const orgId = await resolveActorOrgId({ actor, requestedOrgId });
    assertOrgReadAccess(actor, orgId);

    const cacheKey = `branding:logo:signed-url:${orgId}`;
    if (upstashRedis) {
      const cached = await upstashRedis.get(cacheKey);
      if (typeof cached === "string" && cached.length > 0) {
        return NextResponse.json({ ok: true, url: cached });
      }
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        logoPhotoId: true,
      },
    });

    if (!org) {
      throw new AppApiError("Organization not found.", 404);
    }

    if (!org.logoPhotoId) {
      return NextResponse.json({ ok: true, url: null });
    }

    const photo = await getPhotoStorageRecord({
      photoId: org.logoPhotoId,
      orgId,
    });

    if (!photo) {
      return NextResponse.json({ ok: true, url: null });
    }

    if (photo.imageDataUrl) {
      return NextResponse.json({ ok: true, url: photo.imageDataUrl });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ ok: true, url: null });
    }

    const { r2, bucket } = requireR2();
    const signedUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: bucket,
        Key: photo.key,
      }),
      { expiresIn: 60 },
    );

    if (upstashRedis) {
      await upstashRedis.set(cacheKey, signedUrl, { ex: 55 });
    }

    return NextResponse.json({ ok: true, url: signedUrl });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to sign logo URL.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
