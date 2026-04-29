import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { sendManualLeadSms } from "@/lib/manual-outbound-sms";
import { getSmsSendBlockState } from "@/lib/sms-consent";
import {
  normalizeManualSmsIdempotencyKey,
  runIdempotentManualSmsMutation,
  type ManualSmsApiResponse,
} from "@/lib/manual-sms-idempotency";
import { AppApiError, assertCanMutateLeadJob, assertOrgReadAccess, requireAppApiActor } from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/inbox/send";

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
    const idempotencyKey = normalizeManualSmsIdempotencyKey(req, payload?.idempotencyKey);

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

    const smsBlock = await getSmsSendBlockState({
      orgId: lead.orgId,
      phoneE164: lead.phoneE164,
      legacyLeadStatus: lead.status,
    });
    if (smsBlock.blocked) {
      throw new AppApiError(
        smsBlock.reason ||
          "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
        403,
      );
    }

    const response = await runIdempotentManualSmsMutation({
      orgId: lead.orgId,
      route: ROUTE,
      scope: "manual-sms:inbox-send",
      idempotencyKey,
      run: async (): Promise<ManualSmsApiResponse> => {
        const result = await sendManualLeadSms({
          actor,
          lead,
          body,
          fromNumberE164,
          clientIdempotencyKey: idempotencyKey,
        });

        if (!result.ok) {
          return {
            httpStatus: result.httpStatus,
            body: {
              ok: false,
              error: result.error,
              notice: result.notice,
              deliveryState: result.deliveryState,
              liveSend: result.liveSend,
              readinessCode: result.readinessCode,
              failure: result.failure,
            },
          };
        }

        return {
          httpStatus: 200,
          body: {
            ok: true,
            message: result.message,
            notice: result.notice,
            deliveryState: result.deliveryState,
            liveSend: result.liveSend,
            readinessCode: result.readinessCode,
            failure: result.failure,
          },
        };
      },
    });

    return NextResponse.json(response.body, { status: response.httpStatus });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to send message.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
