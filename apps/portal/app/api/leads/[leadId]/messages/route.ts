import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { sendOutboundSms } from "@/lib/sms";
import {
  AppApiError,
  assertCanMutateLeadJob,
  assertOrgReadAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: { leadId: string };
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

export async function GET(_req: Request, { params }: RouteContext) {
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

export async function POST(req: Request, { params }: RouteContext) {
  const leadId = params.leadId;
  const scoped = await getScopedLeadOrResponse(leadId);
  if ("response" in scoped) {
    return scoped.response;
  }

  await assertCanMutateLeadJob({ actor: scoped.actor, orgId: scoped.lead.orgId, leadId: scoped.lead.id });

  let body = "";
  let fromNumberE164: string | null = null;
  try {
    const payload = (await req.json()) as {
      body?: unknown;
      fromNumberE164?: unknown;
    };
    body = typeof payload.body === "string" ? payload.body : "";
    fromNumberE164 = typeof payload.fromNumberE164 === "string" ? normalizeE164(payload.fromNumberE164) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const cleanedBody = body.trim();
  if (!cleanedBody) {
    return NextResponse.json({ ok: false, error: "Message body is required." }, { status: 400 });
  }

  if (scoped.lead.status === "DNC") {
    return NextResponse.json(
      {
        ok: false,
        error: "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
      },
      { status: 403 },
    );
  }

  if (cleanedBody.length > 1600) {
    return NextResponse.json({ ok: false, error: "Message must be 1600 characters or less." }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: scoped.lead.orgId },
    select: {
      smsFromNumberE164: true,
      twilioConfig: {
        select: {
          phoneNumber: true,
        },
      },
    },
  });

  const resolvedFromNumber =
    fromNumberE164 ||
    normalizeE164(organization?.twilioConfig?.phoneNumber || null) ||
    normalizeE164(organization?.smsFromNumberE164 || null);

  if (!resolvedFromNumber) {
    return NextResponse.json(
      {
        ok: false,
        error: "No outbound SMS number is configured for this business yet.",
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const pausedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const providerResult = await sendOutboundSms({
    orgId: scoped.lead.orgId,
    fromNumberE164: resolvedFromNumber,
    toNumberE164: scoped.lead.phoneE164,
    body: cleanedBody,
  });
  const finalFromNumber = providerResult.resolvedFromNumberE164 || resolvedFromNumber;

  if (!finalFromNumber) {
    return NextResponse.json(
      {
        ok: false,
        error: providerResult.notice || "No outbound SMS number is configured for this business yet.",
      },
      { status: 400 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        orgId: scoped.lead.orgId,
        leadId: scoped.lead.id,
        direction: "OUTBOUND",
        type: "MANUAL",
        fromNumberE164: finalFromNumber,
        toNumberE164: scoped.lead.phoneE164,
        body: cleanedBody,
        provider: "TWILIO",
        providerMessageSid: providerResult.providerMessageSid,
        status: providerResult.status,
      },
      select: {
        id: true,
        direction: true,
        type: true,
        fromNumberE164: true,
        toNumberE164: true,
        body: true,
        provider: true,
        providerMessageSid: true,
        status: true,
        createdAt: true,
      },
    });

    await tx.lead.update({
      where: { id: scoped.lead.id },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
      },
    });

    await tx.leadConversationState.updateMany({
      where: {
        leadId: scoped.lead.id,
        stage: {
          in: ["NEW", "ASKED_WORK", "ASKED_ADDRESS", "ASKED_TIMEFRAME", "OFFERED_BOOKING", "HUMAN_TAKEOVER"],
        },
      },
      data: {
        stage: "HUMAN_TAKEOVER",
        pausedUntil,
        nextFollowUpAt: null,
        followUpStep: 0,
        bookingOptions: Prisma.DbNull,
      },
    });

    await tx.leadConversationAuditEvent.create({
      data: {
        orgId: scoped.lead.orgId,
        leadId: scoped.lead.id,
        action: "TAKEOVER_TRIGGERED",
        metadataJson: {
          reason: "Manual outbound message",
          actorUserId: scoped.actor.id || "unknown",
          pausedUntil: pausedUntil.toISOString(),
        },
      },
    });

    await tx.smsDispatchQueue.updateMany({
      where: {
        orgId: scoped.lead.orgId,
        leadId: scoped.lead.id,
        status: "QUEUED",
      },
      data: {
        status: "FAILED",
        lastError: "Canceled after manual outbound message.",
      },
    });

    return message;
  });

  return NextResponse.json({ ok: true, message: created, notice: providerResult.notice });
}

