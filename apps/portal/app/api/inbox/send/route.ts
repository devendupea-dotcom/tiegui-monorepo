import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordOutboundSmsCommunicationEvent } from "@/lib/communication-events";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { sendOutboundSms } from "@/lib/sms";
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

    const organization = await prisma.organization.findUnique({
      where: { id: lead.orgId },
      select: {
        smsFromNumberE164: true,
        twilioConfig: {
          select: {
            id: true,
            phoneNumber: true,
            messagingServiceSid: true,
            status: true,
          },
        },
      },
    });

    if (!organization?.twilioConfig?.id || !organization.twilioConfig.phoneNumber || !organization.twilioConfig.messagingServiceSid) {
      throw new AppApiError(
        "Inbox sending is unavailable until Twilio is configured in HQ org settings. Ask an internal admin to complete HQ -> Org -> Twilio setup first.",
        409,
      );
    }

    if (organization.twilioConfig.status !== "ACTIVE") {
      throw new AppApiError(
        `Inbox sending is unavailable while Twilio is ${organization.twilioConfig.status}. Ask an internal admin to finish HQ -> Org -> Twilio setup first.`,
        409,
      );
    }

    const resolvedFromNumber =
      fromNumberE164 ||
      normalizeE164(organization.twilioConfig.phoneNumber || null) ||
      normalizeE164(organization?.smsFromNumberE164 || null);

    if (!resolvedFromNumber) {
      throw new AppApiError("No outbound SMS number is configured for this business yet.", 400);
    }

    const now = new Date();
    const pausedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const providerResult = await sendOutboundSms({
      orgId: lead.orgId,
      fromNumberE164: resolvedFromNumber,
      toNumberE164: lead.phoneE164,
      body,
    });
    const finalFromNumber = providerResult.resolvedFromNumberE164 || resolvedFromNumber;

    if (!finalFromNumber) {
      throw new AppApiError(providerResult.notice || "No outbound SMS number is configured for this business yet.", 400);
    }

    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          direction: "OUTBOUND",
          type: "MANUAL",
          fromNumberE164: finalFromNumber,
          toNumberE164: lead.phoneE164,
          body,
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

      await recordOutboundSmsCommunicationEvent(tx, {
        orgId: lead.orgId,
        leadId: lead.id,
        contactId: lead.customerId,
        conversationId: lead.conversationState?.id || null,
        messageId: message.id,
        actorUserId: actor.id || null,
        body,
        fromNumberE164: finalFromNumber,
        toNumberE164: lead.phoneE164,
        providerMessageSid: providerResult.providerMessageSid,
        status: providerResult.status,
        occurredAt: message.createdAt,
      });

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          lastContactedAt: now,
          lastOutboundAt: now,
        },
      });

      await tx.leadConversationState.updateMany({
        where: {
          leadId: lead.id,
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
          orgId: lead.orgId,
          leadId: lead.id,
          action: "TAKEOVER_TRIGGERED",
          metadataJson: {
            reason: "Manual outbound message",
            actorUserId: actor.id || "unknown",
            pausedUntil: pausedUntil.toISOString(),
          },
        },
      });

      await tx.smsDispatchQueue.updateMany({
        where: {
          orgId: lead.orgId,
          leadId: lead.id,
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
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to send message.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
