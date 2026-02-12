import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

type RouteContext = {
  params: { jobId: string };
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();

    const lead = await prisma.lead.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        orgId: true,
      },
    });

    if (!lead) {
      throw new AppApiError("Job not found.", 404);
    }

    await assertCanMutateLeadJob({
      actor,
      orgId: lead.orgId,
      leadId: lead.id,
    });

    const formData = await req.formData();
    const file = formData.get("photo") || formData.get("photoFile");
    const captionRaw = String(formData.get("caption") || "").trim();

    if (!(file instanceof File) || file.size <= 0 || !file.type.startsWith("image/")) {
      throw new AppApiError("An image file is required.", 400);
    }

    if (file.size > MAX_PHOTO_BYTES) {
      throw new AppApiError("Photo must be 5MB or smaller.", 400);
    }

    if (captionRaw.length > 200) {
      throw new AppApiError("Caption must be 200 characters or less.", 400);
    }

    const bytes = await file.arrayBuffer();
    const imageDataUrl = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;

    const photo = await prisma.leadPhoto.create({
      data: {
        orgId: lead.orgId,
        leadId: lead.id,
        createdByUserId: actor.id,
        fileName: file.name || "job-photo",
        mimeType: file.type,
        imageDataUrl,
        caption: captionRaw || null,
      },
      select: {
        id: true,
        leadId: true,
        fileName: true,
        mimeType: true,
        imageDataUrl: true,
        caption: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, photo });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to upload photo.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
