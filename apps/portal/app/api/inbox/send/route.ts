import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { sendManualLeadSms } from "@/lib/manual-outbound-sms";
import { AppApiError, assertCanMutateLeadJob, assertOrgReadAccess, requireAppApiActor } from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const leadId = toStringOrEmpty(payload?.leadId).trim();
    const body = toStringOrEmpty(payload?.body).trim();
    const fromNumberE164 = payload?.fromNumberE164 ? normalizeE164(toStringOrEmpty(payload.fromNumberE164)) : null;

    if (!leadId) {
      throw new AppApiError("leadId is required.", 400);
    }
    if (!body) {
      throw new AppApiError("Message body is required.", 400);
    }
    if (body.length > 1600) {
      throw new AppApiError("Message must be 1600 characters or less.", 400);
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        orgId: true,
        phoneE164: true,
        status: true,
        customerId: true,
        conversationState: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!lead) {
      throw new AppApiError("Lead not found.", 404);
    }

    assertOrgReadAccess(actor, lead.orgId);
    await assertCanMutateLeadJob({ actor, orgId: lead.orgId, leadId: lead.id });

    if (lead.status === "DNC") {
      throw new AppApiError(
        "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
        403,
      );
    }

    const result = await sendManualLeadSms({
      actor,
      lead,
      body,
      fromNumberE164,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          notice: result.notice,
          deliveryState: result.deliveryState,
          liveSend: result.liveSend,
          readinessCode: result.readinessCode,
        },
        { status: result.httpStatus },
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
      notice: result.notice,
      deliveryState: result.deliveryState,
      liveSend: result.liveSend,
      readinessCode: result.readinessCode,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to send message.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
