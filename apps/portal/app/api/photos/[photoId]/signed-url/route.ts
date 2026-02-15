import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { requireR2 } from "@/lib/r2";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { upstashRedis } from "@/lib/upstash";

export const runtime = "nodejs";

type RouteContext = {
  params: { photoId: string };
};

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:photos:signed-url",
      limit: 120,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const cacheKey = `photo:signed-url:${params.photoId}`;
    if (upstashRedis) {
      const cached = await upstashRedis.get(cacheKey);
      if (typeof cached === "string" && cached.length > 0) {
        return NextResponse.json({ ok: true, url: cached });
      }
    }

    const photo = await prisma.photo.findUnique({
      where: { id: params.photoId },
      select: {
        id: true,
        orgId: true,
        key: true,
      },
    });

    if (!photo) {
      throw new AppApiError("Photo not found.", 404);
    }

    assertOrgReadAccess(actor, photo.orgId);

    const { r2, bucket } = requireR2();
    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: bucket,
        Key: photo.key,
      }),
      { expiresIn: 60 },
    );

    if (upstashRedis) {
      await upstashRedis.set(cacheKey, url, { ex: 55 });
    }

    return NextResponse.json({ ok: true, url });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to sign photo URL.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
