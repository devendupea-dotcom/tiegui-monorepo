import {
  Prisma,
  type MessageDirection,
  type MessageStatus,
  type MessageType,
} from "@prisma/client";
import { recordOutboundSmsCommunicationEvent } from "@/lib/communication-events";
import type { AppApiActor } from "@/lib/app-api-permissions";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendOutboundSms } from "@/lib/sms";
import {
  canComposeManualSms,
  getTwilioMessagingComposeNotice,
  resolveTwilioMessagingReadiness,
  type TwilioMessagingReadinessCode,
} from "@/lib/twilio-readiness";

type ManualLeadContext = {
  id: string;
  orgId: string;
  phoneE164: string;
  customerId: string | null;
  conversationState: {
    id: string;
  } | null;
};

type ManualLeadMessage = {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
  provider: "TWILIO";
  providerMessageSid: string | null;
  status: MessageStatus | null;
  createdAt: Date;
};

export type ManualSmsDeliveryState =
  | "SENT"
  | "QUEUED"
  | "FAILED"
  | "SUPPRESSED"
  | "NOT_LIVE";

export type ManualLeadSmsSendResult =
  | {
      ok: false;
      httpStatus: number;
      error: string;
      notice?: string;
      deliveryState: ManualSmsDeliveryState;
      liveSend: boolean;
      readinessCode: TwilioMessagingReadinessCode;
    }
  | {
      ok: true;
      httpStatus: 200;
      message: ManualLeadMessage;
      notice?: string;
      deliveryState: Exclude<ManualSmsDeliveryState, "SUPPRESSED" | "NOT_LIVE">;
      liveSend: boolean;
      readinessCode: TwilioMessagingReadinessCode;
    };

function resolveDeliveryState(status: MessageStatus): "SENT" | "QUEUED" | "FAILED" {
  if (status === "FAILED") {
    return "FAILED";
  }
  if (status === "QUEUED") {
    return "QUEUED";
  }
  return "SENT";
}

export async function sendManualLeadSms(input: {
  actor: Pick<AppApiActor, "id">;
  lead: ManualLeadContext;
  body: string;
  fromNumberE164?: string | null;
}): Promise<ManualLeadSmsSendResult> {
  const organization = await prisma.organization.findUnique({
    where: { id: input.lead.orgId },
    select: {
      smsFromNumberE164: true,
      twilioConfig: {
        select: {
          phoneNumber: true,
          status: true,
        },
      },
    },
  });

  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: organization?.twilioConfig || null,
  });

  const resolvedFromNumber =
    normalizeE164(input.fromNumberE164 || null) ||
    normalizeE164(organization?.twilioConfig?.phoneNumber || null) ||
    normalizeE164(organization?.smsFromNumberE164 || null);

  if (!resolvedFromNumber) {
    return {
      ok: false,
      httpStatus: 400,
      error: "No outbound SMS number is configured for this business yet.",
      deliveryState: "NOT_LIVE",
      liveSend: false,
      readinessCode: readiness.code,
    };
  }

  if (!canComposeManualSms(readiness.code)) {
    const notice =
      getTwilioMessagingComposeNotice(readiness.code) ||
      "Messaging is not live for this workspace yet.";
    return {
      ok: false,
      httpStatus: 409,
      error: notice,
      notice,
      deliveryState: "NOT_LIVE",
      liveSend: false,
      readinessCode: readiness.code,
    };
  }

  const providerResult = await sendOutboundSms({
    orgId: input.lead.orgId,
    fromNumberE164: resolvedFromNumber,
    toNumberE164: input.lead.phoneE164,
    body: input.body,
  });
  const finalFromNumber =
    providerResult.resolvedFromNumberE164 || resolvedFromNumber;

  if (!finalFromNumber) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        providerResult.notice ||
        "No outbound SMS number is configured for this business yet.",
      notice: providerResult.notice,
      deliveryState: "NOT_LIVE",
      liveSend: false,
      readinessCode: readiness.code,
    };
  }

  if (providerResult.suppressed) {
    return {
      ok: false,
      httpStatus: 403,
      error:
        providerResult.notice ||
        "Suppressed outbound SMS because the contact is opted out.",
      notice: providerResult.notice,
      deliveryState: "SUPPRESSED",
      liveSend: false,
      readinessCode: readiness.code,
    };
  }

  const now = new Date();
  const pausedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        orgId: input.lead.orgId,
        leadId: input.lead.id,
        direction: "OUTBOUND",
        type: "MANUAL",
        fromNumberE164: finalFromNumber,
        toNumberE164: input.lead.phoneE164,
        body: input.body,
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
      orgId: input.lead.orgId,
      leadId: input.lead.id,
      contactId: input.lead.customerId,
      conversationId: input.lead.conversationState?.id || null,
      messageId: message.id,
      actorUserId: input.actor.id || null,
      body: input.body,
      fromNumberE164: finalFromNumber,
      toNumberE164: input.lead.phoneE164,
      providerMessageSid: providerResult.providerMessageSid,
      status: providerResult.status,
      deliveryNotice: providerResult.notice || null,
      occurredAt: message.createdAt,
    });

    await tx.lead.update({
      where: { id: input.lead.id },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
      },
    });

    await tx.leadConversationState.updateMany({
      where: {
        leadId: input.lead.id,
        stage: {
          in: [
            "NEW",
            "ASKED_WORK",
            "ASKED_ADDRESS",
            "ASKED_TIMEFRAME",
            "OFFERED_BOOKING",
            "HUMAN_TAKEOVER",
          ],
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
        orgId: input.lead.orgId,
        leadId: input.lead.id,
        action: "TAKEOVER_TRIGGERED",
        metadataJson: {
          reason: "Manual outbound message",
          actorUserId: input.actor.id || "unknown",
          pausedUntil: pausedUntil.toISOString(),
        },
      },
    });

    await tx.smsDispatchQueue.updateMany({
      where: {
        orgId: input.lead.orgId,
        leadId: input.lead.id,
        status: "QUEUED",
      },
      data: {
        status: "FAILED",
        lastError: "Canceled after manual outbound message.",
      },
    });

    return message;
  });

  return {
    ok: true,
    httpStatus: 200,
    message: created,
    notice: providerResult.notice,
    deliveryState: resolveDeliveryState(providerResult.status),
    liveSend: readiness.code === "ACTIVE",
    readinessCode: readiness.code,
  };
}
