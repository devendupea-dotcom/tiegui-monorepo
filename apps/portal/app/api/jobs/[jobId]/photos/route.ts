import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { createLeadPhoto } from "@/lib/lead-photos";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
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

    const created = await createLeadPhoto({
      req,
      orgId: lead.orgId,
      leadId: lead.id,
      actorId: actor.id,
      fallbackFileName: "job-photo",
    });

    return NextResponse.json({ ok: true, photo: created });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to upload photo.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
