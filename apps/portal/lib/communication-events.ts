import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-error";
import type {
  CommunicationChannel,
  CommunicationEventType,
  MessageDirection,
  MessageStatus,
  VoicemailTranscriptionStatus,
} from "@prisma/client";

type Tx = Prisma.TransactionClient;

type CommunicationRefsInput = {
  leadId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
};

type CommunicationRefs = {
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
};

export type TimelineStatus = "queued" | "sent" | "delivered" | "failed" | "read";

export type TimelineLikeEvent = {
  id: string;
  createdAt: string;
};

export function buildCommunicationIdempotencyKey(prefix: string, ...parts: Array<string | number | null | undefined>) {
  const body = parts
    .filter((value): value is string | number => value !== null && value !== undefined && `${value}`.trim() !== "")
    .map((value) => `${value}`)
    .join("|");

  return `${prefix}:${createHash("sha1").update(body).digest("hex")}`;
}

export function mapMessageStatusToTimelineStatus(status: MessageStatus | null | undefined): TimelineStatus | undefined {
  switch (status) {
    case "QUEUED":
      return "queued";
    case "SENT":
      return "sent";
    case "DELIVERED":
      return "delivered";
    case "FAILED":
      return "failed";
    default:
      return undefined;
  }
}

export function mapMessageDirection(direction: MessageDirection): "inbound" | "outbound" {
  return direction === "INBOUND" ? "inbound" : "outbound";
}

export function sortTimelineEventsStable<T extends TimelineLikeEvent>(events: T[]): T[] {
  return [...events].sort((left, right) => {
    const timeDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return left.id.localeCompare(right.id);
  });
}

async function resolveCommunicationRefs(tx: Tx, input: CommunicationRefsInput): Promise<CommunicationRefs> {
  if (!input.leadId) {
    return {
      leadId: null,
      contactId: input.contactId || null,
      conversationId: input.conversationId || null,
    };
  }

  if (input.contactId && input.conversationId) {
    return {
      leadId: input.leadId,
      contactId: input.contactId,
      conversationId: input.conversationId,
    };
  }

  const lead = await tx.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      orgId: true,
      customerId: true,
      conversationState: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!lead) {
    throw new AppApiError("Communication event lead not found.", 404);
  }

  const contactId = input.contactId || lead.customerId || null;
  if (!contactId) {
    throw new AppApiError("Communication events require a linked contact when leadId is present.", 409);
  }

  const conversationId =
    input.conversationId ||
    lead.conversationState?.id ||
    (
      await tx.leadConversationState.upsert({
        where: {
          leadId: lead.id,
        },
        update: {},
        create: {
          orgId: lead.orgId,
          leadId: lead.id,
        },
        select: {
          id: true,
        },
      })
    ).id;

  return {
    leadId: lead.id,
    contactId,
    conversationId,
  };
}

export async function upsertCommunicationEvent(
  tx: Tx,
  input: {
    orgId: string;
    leadId?: string | null;
    contactId?: string | null;
    conversationId?: string | null;
    callId?: string | null;
    messageId?: string | null;
    actorUserId?: string | null;
    type: CommunicationEventType;
    channel: CommunicationChannel;
    occurredAt: Date;
    summary: string;
    metadataJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
    provider?: string | null;
    providerCallSid?: string | null;
    providerParentCallSid?: string | null;
    providerMessageSid?: string | null;
    providerStatus?: string | null;
    idempotencyKey: string;
  },
) {
  // CommunicationEvent is the audit/history source of truth. Message/Call remain
  // provider transport records, while LeadConversationState is automation state.
  const refs = await resolveCommunicationRefs(tx, {
    leadId: input.leadId,
    contactId: input.contactId,
    conversationId: input.conversationId,
  });

  return tx.communicationEvent.upsert({
    where: {
      orgId_idempotencyKey: {
        orgId: input.orgId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    update: {
      leadId: refs.leadId,
      contactId: refs.contactId,
      conversationId: refs.conversationId,
      callId: input.callId || null,
      messageId: input.messageId || null,
      actorUserId: input.actorUserId || null,
      type: input.type,
      channel: input.channel,
      occurredAt: input.occurredAt,
      summary: input.summary,
      metadataJson: input.metadataJson ?? Prisma.JsonNull,
      provider: input.provider || null,
      providerCallSid: input.providerCallSid || null,
      providerParentCallSid: input.providerParentCallSid || null,
      providerMessageSid: input.providerMessageSid || null,
      providerStatus: input.providerStatus || null,
    },
    create: {
      orgId: input.orgId,
      leadId: refs.leadId,
      contactId: refs.contactId,
      conversationId: refs.conversationId,
      callId: input.callId || null,
      messageId: input.messageId || null,
      actorUserId: input.actorUserId || null,
      type: input.type,
      channel: input.channel,
      occurredAt: input.occurredAt,
      summary: input.summary,
      metadataJson: input.metadataJson ?? Prisma.JsonNull,
      provider: input.provider || null,
      providerCallSid: input.providerCallSid || null,
      providerParentCallSid: input.providerParentCallSid || null,
      providerMessageSid: input.providerMessageSid || null,
      providerStatus: input.providerStatus || null,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function upsertVoicemailArtifact(
  tx: Tx,
  input: {
    orgId: string;
    leadId?: string | null;
    contactId?: string | null;
    conversationId?: string | null;
    callId?: string | null;
    communicationEventId: string;
    providerCallSid?: string | null;
    recordingSid?: string | null;
    recordingUrl?: string | null;
    recordingDurationSeconds?: number | null;
    transcriptionStatus?: VoicemailTranscriptionStatus | null;
    transcriptionText?: string | null;
    voicemailAt: Date;
    metadataJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  },
) {
  const refs = await resolveCommunicationRefs(tx, {
    leadId: input.leadId,
    contactId: input.contactId,
    conversationId: input.conversationId,
  });

  return tx.voicemailArtifact.upsert({
    where: {
      communicationEventId: input.communicationEventId,
    },
    update: {
      leadId: refs.leadId,
      contactId: refs.contactId,
      conversationId: refs.conversationId,
      callId: input.callId || null,
      providerCallSid: input.providerCallSid || null,
      recordingSid: input.recordingSid || null,
      recordingUrl: input.recordingUrl || null,
      recordingDurationSeconds: input.recordingDurationSeconds ?? null,
      transcriptionStatus: input.transcriptionStatus || null,
      transcriptionText: input.transcriptionText || null,
      voicemailAt: input.voicemailAt,
      metadataJson: input.metadataJson ?? Prisma.JsonNull,
    },
    create: {
      orgId: input.orgId,
      leadId: refs.leadId,
      contactId: refs.contactId,
      conversationId: refs.conversationId,
      callId: input.callId || null,
      communicationEventId: input.communicationEventId,
      providerCallSid: input.providerCallSid || null,
      recordingSid: input.recordingSid || null,
      recordingUrl: input.recordingUrl || null,
      recordingDurationSeconds: input.recordingDurationSeconds ?? null,
      transcriptionStatus: input.transcriptionStatus || null,
      transcriptionText: input.transcriptionText || null,
      voicemailAt: input.voicemailAt,
      metadataJson: input.metadataJson ?? Prisma.JsonNull,
    },
  });
}

export async function recordOutboundSmsCommunicationEvent(
  tx: Tx,
  input: {
    orgId: string;
    leadId: string;
    contactId?: string | null;
    conversationId?: string | null;
    messageId: string;
    actorUserId?: string | null;
    body: string;
    fromNumberE164: string;
    toNumberE164: string;
    providerMessageSid?: string | null;
    status?: MessageStatus | null;
    occurredAt: Date;
  },
) {
  return upsertCommunicationEvent(tx, {
    orgId: input.orgId,
    leadId: input.leadId,
    contactId: input.contactId || null,
    conversationId: input.conversationId || null,
    messageId: input.messageId,
    actorUserId: input.actorUserId || null,
    type: "OUTBOUND_SMS_SENT",
    channel: "SMS",
    occurredAt: input.occurredAt,
    summary: "Outbound SMS sent",
    metadataJson: {
      body: input.body,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      status: input.status || null,
    },
    provider: "TWILIO",
    providerMessageSid: input.providerMessageSid || null,
    providerStatus: input.status || null,
    idempotencyKey: buildCommunicationIdempotencyKey(
      "sms-outbound",
      input.orgId,
      input.messageId,
      input.providerMessageSid,
      input.occurredAt.toISOString(),
    ),
  });
}
