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
import {
  AppApiError,
  assertCanMutateLeadJob,
  assertOrgReadAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/leads/[leadId]/messages";

type RouteContext = {
  params: Promise<{ leadId: string }>;
};

async function assertWorkerCanViewLead(input: { actorId: string; orgId: string; leadId: string }) {
  const allowed = await prisma.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
      OR: [
        { assignedToUserId: input.actorId },
        { createdByUserId: input.actorId },
        { events: { some: { assignedToUserId: input.actorId } } },
        { events: { some: { workerAssignments: { some: { workerUserId: input.actorId } } } } },
      ],
    },
    select: { id: true },
  });

  if (!allowed) {
    throw new AppApiError("Workers can only access assigned jobs.", 403);
  }
}

async function getScopedLeadOrResponse(leadId: string) {
  try {
    const actor = await requireAppApiActor();
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
      return { response: NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 }) };
    }

    assertOrgReadAccess(actor, lead.orgId);

    if (!actor.internalUser && !canManageAnyOrgJobs(actor) && actor.calendarAccessRole === "WORKER") {
      await assertWorkerCanViewLead({ actorId: actor.id, orgId: lead.orgId, leadId: lead.id });
    }

    return { lead, actor };
  } catch (error) {
    if (error instanceof AppApiError) {
      return { response: NextResponse.json({ ok: false, error: error.message }, { status: error.status }) };
    }

    const message = error instanceof Error ? error.message : "Unauthorized";
    return { response: NextResponse.json({ ok: false, error: message }, { status: 401 }) };
  }
}

export async function GET(_req: Request, props: RouteContext) {
  const params = await props.params;
  const leadId = params.leadId;
  const scoped = await getScopedLeadOrResponse(leadId);
  if ("response" in scoped) {
    return scoped.response;
  }

  const messages = await prisma.message.findMany({
    where: { leadId: scoped.lead.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      fromNumberE164: true,
      toNumberE164: true,
      body: true,
      type: true,
      provider: true,
      providerMessageSid: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, messages });
}

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  const leadId = params.leadId;
  const scoped = await getScopedLeadOrResponse(leadId);
  if ("response" in scoped) {
    return scoped.response;
  }

  await assertCanMutateLeadJob({ actor: scoped.actor, orgId: scoped.lead.orgId, leadId: scoped.lead.id });

  let body = "";
  let fromNumberE164: string | null = null;
  let idempotencyKey: string | null = null;
  try {
    const payload = (await req.json()) as {
      body?: unknown;
      fromNumberE164?: unknown;
      idempotencyKey?: unknown;
    };
    body = typeof payload.body === "string" ? payload.body : "";
    fromNumberE164 = typeof payload.fromNumberE164 === "string" ? normalizeE164(payload.fromNumberE164) : null;
    idempotencyKey = normalizeManualSmsIdempotencyKey(req, payload.idempotencyKey);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const cleanedBody = body.trim();
  if (!cleanedBody) {
    return NextResponse.json({ ok: false, error: "Message body is required." }, { status: 400 });
  }

  const smsBlock = await getSmsSendBlockState({
    orgId: scoped.lead.orgId,
    phoneE164: scoped.lead.phoneE164,
    legacyLeadStatus: scoped.lead.status,
  });
  if (smsBlock.blocked) {
    return NextResponse.json(
      {
        ok: false,
        error:
          smsBlock.reason ||
          "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
      },
      { status: 403 },
    );
  }

  if (cleanedBody.length > 1600) {
    return NextResponse.json({ ok: false, error: "Message must be 1600 characters or less." }, { status: 400 });
  }

  const response = await runIdempotentManualSmsMutation({
    orgId: scoped.lead.orgId,
    route: ROUTE,
    scope: "manual-sms:lead-thread",
    idempotencyKey,
    run: async (): Promise<ManualSmsApiResponse> => {
      const result = await sendManualLeadSms({
        actor: scoped.actor,
        lead: scoped.lead,
        body: cleanedBody,
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
}
