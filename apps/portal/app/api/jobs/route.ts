import { NextResponse } from "next/server";
import { Prisma, type JobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { jobListInclude, saveJobRecord } from "@/lib/job-records-store";
import { jobStatusOptions, serializeJobListItem } from "@/lib/job-records";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobCreatePayload = {
  orgId?: unknown;
  customerName?: unknown;
  address?: unknown;
  projectType?: unknown;
  notes?: unknown;
  status?: unknown;
  estimateDraftId?: unknown;
  measurements?: unknown;
  materials?: unknown;
  labor?: unknown;
};

function isJobStatus(value: string): boolean {
  return jobStatusOptions.includes(value as (typeof jobStatusOptions)[number]);
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    assertOrgReadAccess(actor, orgId);

    const query = url.searchParams.get("q")?.trim() || "";
    const status = url.searchParams.get("status")?.trim().toUpperCase() || "";

    const where: Prisma.JobWhereInput = {
      orgId,
      ...(query
        ? {
            OR: [
              { customerName: { contains: query, mode: "insensitive" } },
              { address: { contains: query, mode: "insensitive" } },
              { projectType: { contains: query, mode: "insensitive" } },
              { notes: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(isJobStatus(status) ? { status: status as JobStatus } : {}),
    };

    const jobs = await prisma.job.findMany({
      where,
      include: jobListInclude,
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    });

    return NextResponse.json({
      ok: true,
      jobs: jobs.map(serializeJobListItem),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/jobs",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load jobs.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as JobCreatePayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    assertOrgWriteAccess(actor, orgId);

    const job = await saveJobRecord({
      orgId,
      actorId: actor.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/jobs",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
