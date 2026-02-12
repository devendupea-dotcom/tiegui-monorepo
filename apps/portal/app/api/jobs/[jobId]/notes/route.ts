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

const IDEMPOTENT_ROUTE = "/api/jobs/[jobId]/notes";

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || "";

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

    if (idempotencyKey) {
      const existingReceipt = await prisma.clientMutationReceipt.findUnique({
        where: {
          orgId_idempotencyKey: {
            orgId: lead.orgId,
            idempotencyKey,
          },
        },
        select: {
          route: true,
          responseJson: true,
        },
      });

      if (existingReceipt && existingReceipt.route === IDEMPOTENT_ROUTE && existingReceipt.responseJson) {
        return NextResponse.json(existingReceipt.responseJson as { ok: boolean; note: unknown });
      }
    }

    const payload = (await req.json().catch(() => null)) as { body?: unknown } | null;
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";

    if (!body) {
      throw new AppApiError("Note body is required.", 400);
    }

    if (body.length > 4000) {
      throw new AppApiError("Note body must be 4000 characters or less.", 400);
    }

    const note = await prisma.leadNote.create({
      data: {
        orgId: lead.orgId,
        leadId: lead.id,
        createdByUserId: actor.id,
        body,
      },
      select: {
        id: true,
        leadId: true,
        body: true,
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

    const responsePayload = { ok: true, note };
    const responseJson = JSON.parse(JSON.stringify(responsePayload)) as typeof responsePayload;

    if (idempotencyKey) {
      await prisma.clientMutationReceipt.upsert({
        where: {
          orgId_idempotencyKey: {
            orgId: lead.orgId,
            idempotencyKey,
          },
        },
        create: {
          orgId: lead.orgId,
          idempotencyKey,
          route: IDEMPOTENT_ROUTE,
          responseJson: responseJson as never,
        },
        update: {
          route: IDEMPOTENT_ROUTE,
          responseJson: responseJson as never,
        },
      });
    }

    return NextResponse.json(responseJson);
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to add note.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
