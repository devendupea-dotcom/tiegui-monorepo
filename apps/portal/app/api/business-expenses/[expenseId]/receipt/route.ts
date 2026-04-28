import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { setBusinessExpenseReceipt } from "@/lib/business-expenses-store";
import { fileToDataUrl } from "@/lib/inline-images";
import { createPhotoRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const contentTypeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function toUtcDatePrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

type RouteContext = {
  params: Promise<{ expenseId: string }>;
};

async function resolveExpenseOrgId(expenseId: string): Promise<string> {
  const scoped = await prisma.businessExpense.findUnique({
    where: { id: expenseId },
    select: { orgId: true },
  });

  if (!scoped) {
    throw new AppApiError("Business expense not found.", 404);
  }

  return scoped.orgId;
}

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolveExpenseOrgId(params.expenseId);
    assertOrgWriteAccess(actor, orgId);

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:business-expenses:receipt",
      limit: 20,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many uploads. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = (await req.json().catch(() => null)) as { clear?: unknown } | null;
      if (payload?.clear === true) {
        const expense = await setBusinessExpenseReceipt({
          orgId,
          expenseId: params.expenseId,
          receiptPhotoId: null,
        });

        return NextResponse.json({ ok: true, expense });
      }

      throw new AppApiError("Receipt image is required.", 400);
    }

    const formData = await req.formData();
    const fileCandidate = formData.get("receipt") || formData.get("photo") || formData.get("photoFile");
    const file = fileCandidate instanceof File ? fileCandidate : null;

    if (!file || file.size <= 0) {
      throw new AppApiError("Receipt image is required.", 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppApiError("Receipt image must be 8MB or smaller.", 400);
    }

    const ext = contentTypeToExt[file.type];
    if (!ext) {
      throw new AppApiError("Unsupported receipt type. Use JPEG, PNG, or WebP.", 400);
    }

    const key = `${orgId}/expenses/${toUtcDatePrefix()}/${randomUUID()}.${ext}`;
    const photo = isR2Configured()
      ? await (async () => {
          const { r2, bucket } = requireR2();
          await r2.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: Buffer.from(await file.arrayBuffer()),
              ContentType: file.type,
            }),
          );

          return createPhotoRecord({
            orgId,
            key,
            contentType: file.type,
            sizeBytes: file.size,
            originalName: file.name,
            imageDataUrl: null,
          });
        })()
      : await createPhotoRecord({
          orgId,
          key,
          contentType: file.type,
          sizeBytes: file.size,
          originalName: file.name,
          imageDataUrl: await fileToDataUrl(file),
        });

    const expense = await setBusinessExpenseReceipt({
      orgId,
      expenseId: params.expenseId,
      receiptPhotoId: photo.id,
    });

    return NextResponse.json({
      ok: true,
      expense,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/business-expenses/[expenseId]/receipt",
      expenseId: params.expenseId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to upload receipt.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
