import { addMinutes } from "date-fns";
import { Prisma, type ConversationStage, type MessageStatus } from "@prisma/client";
import { recordOutboundSmsCommunicationEvent } from "@/lib/communication-events";
import { prisma } from "@/lib/prisma";
import { ACTIVE_CONVERSATION_FOLLOW_UP_STAGES } from "@/lib/sms-automation-guards";
import { sendOutboundSms } from "@/lib/sms";
import { queueSmsDispatch } from "@/lib/sms-dispatch-queue";
import { normalizeSmsAgentPlaybook } from "@/lib/conversational-sms-agent-playbook";
import {
  getFollowUpCadenceMinutes,
  mapStageToLeadIntake,
  sanitizeMessageBody,
  type ConversationLead,
  type ConversationOrgConfig,
} from "@/lib/conversational-sms-core";
import { resolveMessageLocale } from "@/lib/message-language";
import { ensureAutomatedSmsCompliance } from "@/lib/sms-compliance";
import { normalizeCustomTemplates } from "@/lib/conversational-sms-templates";

const HUMANIZED_REPLY_DELAY_MINUTES = 2;
const MAX_HUMANIZED_REPLY_DELAY_MINUTES = 3;
const FOLLOW_UP_CLAIM_HOLD_MINUTES = 5;

export async function getConversationOrgConfig(orgId: string): Promise<ConversationOrgConfig | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      messageLanguage: true,
      smsTone: true,
      autoReplyEnabled: true,
      followUpsEnabled: true,
      autoBookingEnabled: true,
      smsFromNumberE164: true,
      smsQuietHoursStartMinute: true,
      smsQuietHoursEndMinute: true,
      smsGreetingLine: true,
      smsWorkingHoursText: true,
      smsWebsiteSignature: true,
      missedCallAutoReplyBody: true,
      missedCallAutoReplyBodyEn: true,
      missedCallAutoReplyBodyEs: true,
      intakeAskLocationBody: true,
      intakeAskLocationBodyEn: true,
      intakeAskLocationBodyEs: true,
      intakeAskWorkTypeBody: true,
      intakeAskWorkTypeBodyEn: true,
      intakeAskWorkTypeBodyEs: true,
      intakeAskCallbackBody: true,
      intakeAskCallbackBodyEn: true,
      intakeAskCallbackBodyEs: true,
      intakeCompletionBody: true,
      intakeCompletionBodyEn: true,
      intakeCompletionBodyEs: true,
      dashboardConfig: {
        select: {
          calendarTimezone: true,
          defaultSlotMinutes: true,
        },
      },
      messagingSettings: {
        select: {
          smsTone: true,
          autoReplyEnabled: true,
          followUpsEnabled: true,
          autoBookingEnabled: true,
          workingHoursStart: true,
          workingHoursEnd: true,
          slotDurationMinutes: true,
          bufferMinutes: true,
          daysAhead: true,
          timezone: true,
          customTemplates: true,
          aiIntakeProfile: true,
        },
      },
    },
  });

  if (!org) return null;

  const messaging = org.messagingSettings;
  const customTemplates = normalizeCustomTemplates(messaging?.customTemplates);

  return {
    id: org.id,
    name: org.name,
    messageLanguage: org.messageLanguage,
    smsTone: messaging?.smsTone || org.smsTone,
    autoReplyEnabled: messaging?.autoReplyEnabled ?? org.autoReplyEnabled,
    followUpsEnabled: messaging?.followUpsEnabled ?? org.followUpsEnabled,
    autoBookingEnabled: messaging?.autoBookingEnabled ?? org.autoBookingEnabled,
    smsFromNumberE164: org.smsFromNumberE164,
    smsQuietHoursStartMinute: org.smsQuietHoursStartMinute,
    smsQuietHoursEndMinute: org.smsQuietHoursEndMinute,
    workingHoursStart: messaging?.workingHoursStart || "09:00",
    workingHoursEnd: messaging?.workingHoursEnd || "17:00",
    slotDurationMinutes: Math.max(15, Math.min(180, messaging?.slotDurationMinutes || org.dashboardConfig?.defaultSlotMinutes || 60)),
    bufferMinutes: Math.max(0, Math.min(120, messaging?.bufferMinutes || 15)),
    daysAhead: Math.max(1, Math.min(14, messaging?.daysAhead || 3)),
    messagingTimezone: messaging?.timezone || org.dashboardConfig?.calendarTimezone || "America/Los_Angeles",
    customTemplates,
    smsAgentPlaybook: normalizeSmsAgentPlaybook(messaging?.aiIntakeProfile),
    smsGreetingLine: org.smsGreetingLine,
    smsWorkingHoursText: org.smsWorkingHoursText || (messaging ? `${messaging.workingHoursStart}-${messaging.workingHoursEnd}` : null),
    smsWebsiteSignature: org.smsWebsiteSignature,
    missedCallAutoReplyBody: org.missedCallAutoReplyBody,
    missedCallAutoReplyBodyEn: org.missedCallAutoReplyBodyEn,
    missedCallAutoReplyBodyEs: org.missedCallAutoReplyBodyEs,
    intakeAskLocationBody: org.intakeAskLocationBody,
    intakeAskLocationBodyEn: org.intakeAskLocationBodyEn,
    intakeAskLocationBodyEs: org.intakeAskLocationBodyEs,
    intakeAskWorkTypeBody: org.intakeAskWorkTypeBody,
    intakeAskWorkTypeBodyEn: org.intakeAskWorkTypeBodyEn,
    intakeAskWorkTypeBodyEs: org.intakeAskWorkTypeBodyEs,
    intakeAskCallbackBody: org.intakeAskCallbackBody,
    intakeAskCallbackBodyEn: org.intakeAskCallbackBodyEn,
    intakeAskCallbackBodyEs: org.intakeAskCallbackBodyEs,
    intakeCompletionBody: org.intakeCompletionBody,
    intakeCompletionBodyEn: org.intakeCompletionBodyEn,
    intakeCompletionBodyEs: org.intakeCompletionBodyEs,
    dashboardConfig: org.dashboardConfig,
  };
}

export async function getConversationLead(leadId: string): Promise<ConversationLead | null> {
  return prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      orgId: true,
      customerId: true,
      phoneE164: true,
      status: true,
      preferredLanguage: true,
      businessName: true,
      contactName: true,
      lastOutboundAt: true,
      nextFollowUpAt: true,
    },
  });
}

export async function getOrCreateConversationState(lead: ConversationLead) {
  return prisma.leadConversationState.upsert({
    where: { leadId: lead.id },
    create: {
      orgId: lead.orgId,
      leadId: lead.id,
      stage: "NEW",
      followUpStep: 0,
    },
    update: {},
  });
}

export async function auditConversation(input: {
  orgId: string;
  leadId: string;
  conversationStateId?: string | null;
  action: "AUTO_MESSAGE_SENT" | "STAGE_CHANGED" | "FOLLOWUP_SCHEDULED" | "TAKEOVER_TRIGGERED" | "OPT_OUT" | "BOOKED_CREATED";
  metadataJson?: Prisma.InputJsonValue;
}) {
  await prisma.leadConversationAuditEvent.create({
    data: {
      orgId: input.orgId,
      leadId: input.leadId,
      conversationStateId: input.conversationStateId || null,
      action: input.action,
      metadataJson: input.metadataJson,
    },
  });
}

export async function cancelQueuedAutomation(input: { orgId: string; leadId: string; reason: string }) {
  await prisma.smsDispatchQueue.updateMany({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      status: "QUEUED",
    },
    data: {
      status: "FAILED",
      lastError: input.reason,
    },
  });
}

export async function sendConversationMessage(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  stateId: string;
  body: string;
  messageType: "AUTOMATION" | "SYSTEM_NUDGE" | "MANUAL";
  allowWhenStopped?: boolean;
  allowPendingA2P?: boolean;
}) {
  if (!input.allowWhenStopped && input.lead.status === "DNC") {
    return { ok: false as const, status: "FAILED" as MessageStatus, notice: "Lead is opted out." };
  }

  const compliantBody = ensureAutomatedSmsCompliance({
    body: input.body,
    locale: resolveMessageLocale({
      organizationLanguage: input.organization.messageLanguage,
      leadPreferredLanguage: input.lead.preferredLanguage,
    }),
    messageType: input.messageType,
  });
  const text = sanitizeMessageBody(compliantBody);
  if (!text) {
    return { ok: false as const, status: "FAILED" as MessageStatus, notice: "Message body is empty." };
  }

  const outbound = await sendOutboundSms({
    orgId: input.organization.id,
    fromNumberE164: input.organization.smsFromNumberE164 || null,
    toNumberE164: input.lead.phoneE164,
    body: text,
    allowPendingA2P: input.allowPendingA2P,
  });

  if (outbound.suppressed) {
    return {
      ok: false as const,
      status: outbound.status,
      notice: outbound.notice || "Suppressed outbound SMS because the contact is opted out.",
    };
  }

  if (outbound.status === "FAILED") {
    console.warn(
      `[sms:auto] outbound send failed orgId=${input.organization.id} leadId=${input.lead.id} type=${input.messageType} reason=${outbound.notice || "unknown"}`,
    );
  }

  const resolvedFrom = outbound.resolvedFromNumberE164 || input.organization.smsFromNumberE164;
  if (!resolvedFrom) {
    return {
      ok: false as const,
      status: "FAILED" as MessageStatus,
      notice: outbound.notice || "No sender number configured.",
    };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        orgId: input.organization.id,
        leadId: input.lead.id,
        direction: "OUTBOUND",
        type: input.messageType,
        fromNumberE164: resolvedFrom,
        toNumberE164: input.lead.phoneE164,
        body: text,
        provider: "TWILIO",
        providerMessageSid: outbound.providerMessageSid,
        status: outbound.status,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    await recordOutboundSmsCommunicationEvent(tx, {
      orgId: input.organization.id,
      leadId: input.lead.id,
      contactId: input.lead.customerId,
      conversationId: input.stateId,
      messageId: message.id,
      body: text,
      fromNumberE164: resolvedFrom,
      toNumberE164: input.lead.phoneE164,
      providerMessageSid: outbound.providerMessageSid,
      status: outbound.status,
      deliveryNotice: outbound.notice || null,
      occurredAt: message.createdAt,
    });

    await tx.lead.update({
      where: { id: input.lead.id },
      data: {
        lastOutboundAt: now,
        lastContactedAt: now,
      },
    });

    await tx.leadConversationState.update({
      where: { id: input.stateId },
      data: {
        lastOutboundAt: now,
      },
    });
  });

  await auditConversation({
    orgId: input.organization.id,
    leadId: input.lead.id,
    conversationStateId: input.stateId,
    action: "AUTO_MESSAGE_SENT",
    metadataJson: {
      messageType: input.messageType,
      status: outbound.status,
    },
  });

  return { ok: outbound.status !== "FAILED", status: outbound.status, notice: outbound.notice };
}

export async function queueConversationReply(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  stateId: string;
  body: string;
  messageType: "AUTOMATION" | "SYSTEM_NUDGE" | "MANUAL";
  fallbackFromNumberE164?: string | null;
  delayMinutes?: number;
  sendAfterAt?: Date;
}) {
  if (input.lead.status === "DNC") {
    return { ok: false as const, status: "FAILED" as MessageStatus, notice: "Lead is opted out." };
  }

  const compliantBody = ensureAutomatedSmsCompliance({
    body: input.body,
    locale: resolveMessageLocale({
      organizationLanguage: input.organization.messageLanguage,
      leadPreferredLanguage: input.lead.preferredLanguage,
    }),
    messageType: input.messageType,
  });
  const text = sanitizeMessageBody(compliantBody);
  if (!text) {
    return { ok: false as const, status: "FAILED" as MessageStatus, notice: "Message body is empty." };
  }

  const fromNumberE164 = input.organization.smsFromNumberE164 || input.fallbackFromNumberE164 || null;
  if (!fromNumberE164) {
    return {
      ok: false as const,
      status: "FAILED" as MessageStatus,
      notice: "No sender number configured for delayed SMS reply.",
    };
  }

  const sendAfterAt =
    input.sendAfterAt ||
    addMinutes(
      new Date(),
      Math.max(1, Math.min(MAX_HUMANIZED_REPLY_DELAY_MINUTES, input.delayMinutes ?? HUMANIZED_REPLY_DELAY_MINUTES)),
    );
  await queueSmsDispatch({
    orgId: input.organization.id,
    leadId: input.lead.id,
    kind: "AUTOMATION_GENERIC",
    messageType: input.messageType,
    fromNumberE164,
    toNumberE164: input.lead.phoneE164,
    body: text,
    sendAfterAt,
  });

  return { ok: true as const, status: "QUEUED" as MessageStatus, sendAfterAt };
}

export async function setConversationStage(input: {
  orgId: string;
  leadId: string;
  stateId: string;
  previousStage: ConversationStage;
  stage: ConversationStage;
  data?: Prisma.LeadConversationStateUpdateInput;
  leadData?: Prisma.LeadUpdateInput;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.leadConversationState.update({
      where: { id: input.stateId },
      data: {
        stage: input.stage,
        ...(input.data || {}),
      },
    });
    await tx.lead.update({
      where: { id: input.leadId },
      data: {
        intakeStage: mapStageToLeadIntake(input.stage),
        ...(input.leadData || {}),
      },
    });
  });

  await auditConversation({
    orgId: input.orgId,
    leadId: input.leadId,
    conversationStateId: input.stateId,
    action: "STAGE_CHANGED",
    metadataJson: {
      previousStage: input.previousStage,
      nextStage: input.stage,
    },
  });
}

export async function setNextFollowUp(input: {
  organization: ConversationOrgConfig;
  leadId: string;
  stateId: string;
  stage: ConversationStage;
  sentFollowUpCount: number;
  fromAt?: Date;
}) {
  const cadence = getFollowUpCadenceMinutes(input.stage, ACTIVE_CONVERSATION_FOLLOW_UP_STAGES);
  const nextMinutes = cadence[input.sentFollowUpCount];
  if (!input.organization.followUpsEnabled || !nextMinutes) {
    await prisma.$transaction([
      prisma.leadConversationState.update({
        where: { id: input.stateId },
        data: {
          nextFollowUpAt: null,
          followUpStep: input.sentFollowUpCount,
        },
      }),
      prisma.lead.update({
        where: { id: input.leadId },
        data: { nextFollowUpAt: null },
      }),
    ]);
    return;
  }

  const nextFollowUpAt = addMinutes(input.fromAt || new Date(), nextMinutes);
  await prisma.$transaction([
    prisma.leadConversationState.update({
      where: { id: input.stateId },
      data: {
        nextFollowUpAt,
        followUpStep: input.sentFollowUpCount,
      },
    }),
    prisma.lead.update({
      where: { id: input.leadId },
      data: { nextFollowUpAt },
    }),
  ]);

  await auditConversation({
    orgId: input.organization.id,
    leadId: input.leadId,
    conversationStateId: input.stateId,
    action: "FOLLOWUP_SCHEDULED",
    metadataJson: {
      stage: input.stage,
      sentFollowUpCount: input.sentFollowUpCount,
      nextFollowUpAt: nextFollowUpAt.toISOString(),
      nextMinutes,
    },
  });
}

export async function claimDueConversationFollowUp(input: {
  stateId: string;
  stage: ConversationStage;
  followUpStep: number;
  nextFollowUpAt: Date;
}) {
  const holdUntil = addMinutes(new Date(), FOLLOW_UP_CLAIM_HOLD_MINUTES);
  const claim = await prisma.leadConversationState.updateMany({
    where: {
      id: input.stateId,
      stage: input.stage,
      followUpStep: input.followUpStep,
      nextFollowUpAt: input.nextFollowUpAt,
    },
    data: {
      nextFollowUpAt: holdUntil,
    },
  });

  return claim.count > 0;
}

export async function getLiveConversationFollowUpState(stateId: string) {
  return prisma.leadConversationState.findUnique({
    where: { id: stateId },
    select: {
      id: true,
      orgId: true,
      leadId: true,
      stage: true,
      followUpStep: true,
      workSummary: true,
      addressText: true,
      addressCity: true,
      timeframe: true,
      bookingOptions: true,
      lastInboundAt: true,
      nextFollowUpAt: true,
      pausedUntil: true,
      stoppedAt: true,
      lead: {
        select: {
          id: true,
          orgId: true,
          customerId: true,
          phoneE164: true,
          status: true,
          preferredLanguage: true,
          businessName: true,
          contactName: true,
          lastOutboundAt: true,
          nextFollowUpAt: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              direction: true,
              type: true,
              createdAt: true,
              body: true,
            },
          },
        },
      },
    },
  });
}
