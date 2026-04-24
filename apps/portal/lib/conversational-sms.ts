import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Prisma } from "@prisma/client";
import type { ConversationStage, MessageStatus } from "@prisma/client";
import { buildMissedCallOpeningMessages } from "@/lib/missed-call-opening";
import { prisma } from "@/lib/prisma";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";
import { syncLeadBookingState } from "@/lib/lead-booking";
import {
  ACTIVE_CONVERSATION_FOLLOW_UP_STAGES,
  getAutomatedFollowUpThrottleUntil,
  shouldSkipQueuedFollowUp,
  shouldSuppressMissedCallKickoff,
} from "@/lib/sms-automation-guards";
import { ensureSmsOptOutHint } from "@/lib/sms-compliance";
import { queueSmsDispatch } from "@/lib/sms-dispatch-queue";
import { rankConversationalSmsSlotCandidates } from "@/lib/conversational-sms-scheduling";
import { renderSmsTemplate } from "@/lib/conversational-sms-templates";
import { isWithinSmsSendWindow, nextSmsSendWindowStartUtc } from "@/lib/sms-quiet-hours";
import {
  buildSlotList,
  buildSlotTemplateContext,
  buildTemplateBundle,
  formatMissingField,
  formatSlotLabel,
  getFollowUpCadenceMinutes,
  hasStartKeyword,
  hasStopKeyword,
  isAmbiguousTimeSelection,
  parseAddress,
  parseBookingSelection,
  parseTimeframe,
  parseWorkAndLocation,
  sanitizeMessageBody,
  shouldRouteInboundSmsToHuman,
  type ConversationLead,
  type ConversationOrgConfig,
  type SlotOption,
  type TemplateBundle,
  withSignature,
} from "@/lib/conversational-sms-core";
import {
  getTrustedConversationalSmsLlmReplyBody,
  hasConversationalSmsLlmExtractionConfidence,
  hasConversationalSmsLlmHandoffConfidence,
} from "@/lib/conversational-sms-llm-contract";
import {
  buildConversationalSmsLlmCacheKey,
  maybeInterpretConversationalSmsTurn,
  type ConversationalSmsLlmInput,
} from "@/lib/conversational-sms-llm";
import {
  auditConversation,
  cancelQueuedAutomation,
  claimDueConversationFollowUp,
  getConversationLead,
  getConversationOrgConfig,
  getLiveConversationFollowUpState,
  getOrCreateConversationState,
  queueConversationReply,
  sendConversationMessage,
  setConversationStage,
  setNextFollowUp,
} from "@/lib/conversational-sms-state";
import { listWorkspaceUsers, sortWorkspaceUsersByCalendarRoleThenLabel } from "@/lib/workspace-users";

const OFFERED_SLOT_COUNT = 3;
const OFFERED_SLOT_LOOKAHEAD_DAYS = 10;
const OFFERED_SLOT_CANDIDATE_LIMIT = OFFERED_SLOT_COUNT * 8;
const OFFER_HOLD_MINUTES = 10;
const TAKEOVER_PAUSE_HOURS = 24;
const MISSED_CALL_FOLLOW_UP_DELAY_MINUTES = 2;

function preferLlmReplyBody(fallbackBody: string, replyBody: string | null): string {
  return replyBody || fallbackBody;
}

function buildConversationSummaryLine(input: {
  lead: ConversationLead;
  workSummary?: string | null;
  addressText?: string | null;
  addressCity?: string | null;
  timeframe?: string | null;
  slotLabel?: string | null;
  reason: string;
  inboundBody?: string | null;
}): string {
  const details = [
    `callback: ${input.lead.phoneE164}`,
    input.workSummary ? `work: ${sanitizeMessageBody(input.workSummary)}` : null,
    input.addressText ? `address: ${sanitizeMessageBody(input.addressText)}` : null,
    !input.addressText && input.addressCity ? `city: ${sanitizeMessageBody(input.addressCity)}` : null,
    input.timeframe ? `timeframe: ${input.timeframe}` : null,
    input.slotLabel ? `slot: ${input.slotLabel}` : null,
  ].filter(Boolean);

  const note = [`[SMS Intake] ${input.reason}`, details.length > 0 ? details.join(" | ") : null]
    .filter(Boolean)
    .join(" — ");
  if (!input.inboundBody) return note;
  return `${note}. Message: "${sanitizeMessageBody(input.inboundBody)}"`;
}

type HandleInboundResult = {
  stage: ConversationStage;
  action:
    | "STOPPED"
    | "UNSTOPPED"
    | "TAKEOVER"
    | "ADVANCED"
    | "BOOKED"
    | "IGNORED"
    | "NOOP";
};

export type MissedCallKickoffDispatchResult =
  | {
      outcome: "sent";
      messageStatus: MessageStatus;
      notice?: string;
    }
  | {
      outcome: "queued";
      queueId: string;
      created: boolean;
    }
  | {
      outcome: "skipped";
      reason: string;
    }
  | {
      outcome: "failed";
      reason: string;
    };

async function getWorkerCandidates(orgId: string) {
  const workers = await listWorkspaceUsers({
    organizationId: orgId,
    excludeReadOnly: true,
  });

  return sortWorkspaceUsersByCalendarRoleThenLabel(workers).slice(0, 60);
}

async function createBookingOptions(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  locale: "EN" | "ES";
}): Promise<SlotOption[]> {
  const calendar = await getOrgCalendarSettings(input.organization.id);
  const timezone = input.organization.messagingTimezone || calendar.calendarTimezone;
  const appointmentMinutes = Math.max(
    15,
    Math.min(180, input.organization.slotDurationMinutes || input.organization.dashboardConfig?.defaultSlotMinutes || calendar.defaultSlotMinutes),
  );
  const blockMinutes = Math.max(appointmentMinutes, appointmentMinutes + input.organization.bufferMinutes);
  const lookaheadDays = Math.max(1, Math.min(14, input.organization.daysAhead || OFFERED_SLOT_LOOKAHEAD_DAYS));

  await prisma.calendarHold.updateMany({
    where: {
      orgId: input.organization.id,
      leadId: input.lead.id,
      source: "SMS_AGENT",
      status: "ACTIVE",
    },
    data: {
      status: "CANCELLED",
      expiresAt: new Date(),
    },
  });

  const workers = await getWorkerCandidates(input.organization.id);
  if (workers.length === 0) return [];

  const now = new Date();
  const usedSlotUtc = new Set<string>();
  const candidates: Array<{ workerUserId: string; startAt: Date; endAt: Date }> = [];

  outer: for (let offset = 0; offset < lookaheadDays; offset += 1) {
    const date = formatInTimeZone(addDays(now, offset), timezone, "yyyy-MM-dd");

    for (const worker of workers) {
      const availability = await computeAvailabilityForWorker({
        orgId: input.organization.id,
        workerUserId: worker.id,
        date,
        durationMinutes: blockMinutes,
      });
      let workerCandidateCount = 0;
      for (const slotUtc of availability.slotsUtc) {
        if (usedSlotUtc.has(slotUtc)) continue;
        const slotDate = new Date(slotUtc);
        if (slotDate.getTime() <= now.getTime()) continue;
        usedSlotUtc.add(slotUtc);
        candidates.push({
          workerUserId: worker.id,
          startAt: slotDate,
          endAt: addMinutes(slotDate, blockMinutes),
        });
        workerCandidateCount += 1;
        if (workerCandidateCount >= OFFERED_SLOT_COUNT * 2) {
          break;
        }
        if (candidates.length >= OFFERED_SLOT_CANDIDATE_LIMIT) {
          break outer;
        }
      }
    }
  }

  const prioritizedCandidates = rankConversationalSmsSlotCandidates({
    candidates,
    timeZone: timezone,
    preferredWindowStart: input.organization.workingHoursStart,
    preferredWindowEnd: input.organization.workingHoursEnd,
    limit: OFFERED_SLOT_COUNT,
  });

  const expiresAt = addMinutes(now, OFFER_HOLD_MINUTES);
  const labels = ["A", "B", "C"] as const;
  const options: SlotOption[] = [];
  for (let index = 0; index < prioritizedCandidates.length && index < OFFERED_SLOT_COUNT; index += 1) {
    const candidate = prioritizedCandidates[index]!;
    const hold = await prisma.calendarHold.create({
      data: {
        orgId: input.organization.id,
        leadId: input.lead.id,
        workerUserId: candidate.workerUserId,
        title: `${input.organization.name} Estimate`,
        customerName: input.lead.contactName || input.lead.businessName || null,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        source: "SMS_AGENT",
        status: "ACTIVE",
        expiresAt,
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        workerUserId: true,
      },
    });

    const label = formatSlotLabel({
      startAt: hold.startAt,
      timeZone: timezone,
      locale: input.locale,
    });
    options.push({
      id: labels[index]!,
      holdId: hold.id,
      startAtIso: hold.startAt.toISOString(),
      endAtIso: hold.endAt.toISOString(),
      workerUserId: hold.workerUserId,
      label,
      matchText: label.toLowerCase(),
    });
  }

  return options;
}

async function bookFromSelectedOption(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  stateId: string;
  option: SlotOption;
  templates: TemplateBundle;
  stateAddress: string | null;
  workSummary: string | null;
  timeframe: string | null;
}): Promise<boolean> {
  const hold = await prisma.calendarHold.findFirst({
    where: {
      id: input.option.holdId,
      orgId: input.organization.id,
      leadId: input.lead.id,
      source: "SMS_AGENT",
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
    },
  });
  if (!hold) return false;

  const event = await prisma.$transaction(async (tx) => {
    const nextEvent = await tx.event.create({
      data: {
        orgId: input.organization.id,
        leadId: input.lead.id,
        type: "ESTIMATE",
        status: "CONFIRMED",
        busy: true,
        title: `${input.organization.name} Estimate`,
        description: "Booked from conversational SMS flow.",
        customerName: input.lead.contactName || input.lead.businessName || null,
        addressLine: input.stateAddress,
        startAt: hold.startAt,
        endAt: hold.endAt,
        assignedToUserId: hold.workerUserId,
        workerAssignments: {
          create: [
            {
              orgId: input.organization.id,
              workerUserId: hold.workerUserId,
            },
          ],
        },
      },
      select: {
        id: true,
        assignedToUserId: true,
      },
    });

    await tx.calendarHold.updateMany({
      where: {
        orgId: input.organization.id,
        leadId: input.lead.id,
        source: "SMS_AGENT",
        status: "ACTIVE",
      },
      data: { status: "CANCELLED" },
    });

    await tx.calendarHold.update({
      where: { id: hold.id },
      data: { status: "CONFIRMED" },
    });

    await tx.leadConversationState.update({
      where: { id: input.stateId },
      data: {
        stage: "BOOKED",
        nextFollowUpAt: null,
        followUpStep: 0,
        pausedUntil: null,
        bookingOptions: Prisma.DbNull,
        bookedStartAt: hold.startAt,
        bookedEndAt: hold.endAt,
        bookedCalendarEventId: nextEvent.id,
      },
    });

    await syncLeadBookingState(tx, {
      orgId: input.organization.id,
      leadId: input.lead.id,
      eventId: nextEvent.id,
      type: "ESTIMATE",
      status: "CONFIRMED",
      startAt: hold.startAt,
      endAt: hold.endAt,
      title: `${input.organization.name} Estimate`,
      customerName: input.lead.contactName || input.lead.businessName || null,
      addressLine: input.stateAddress,
      createdByUserId: null,
    });

    await tx.leadNote.create({
      data: {
        orgId: input.organization.id,
        leadId: input.lead.id,
        body: buildConversationSummaryLine({
          lead: input.lead,
          reason: "Estimate booked by SMS agent",
          workSummary: input.workSummary,
          addressText: input.stateAddress,
          timeframe: input.timeframe,
          slotLabel: `${input.option.id}) ${input.option.label}`,
        }),
      },
    });

    return nextEvent;
  });

  if (event.assignedToUserId) {
    void enqueueGoogleSyncJob({
      orgId: input.organization.id,
      userId: event.assignedToUserId,
      eventId: event.id,
      action: "UPSERT_EVENT",
    });
  }

  await auditConversation({
    orgId: input.organization.id,
    leadId: input.lead.id,
    conversationStateId: input.stateId,
    action: "BOOKED_CREATED",
    metadataJson: {
      calendarEventId: event.id,
      holdId: hold.id,
      slotOption: input.option.id,
      startAt: hold.startAt.toISOString(),
      endAt: hold.endAt.toISOString(),
    },
  });

  const confirmation = renderSmsTemplate(input.templates.bookingConfirmation, {
    bizName: input.organization.name,
    address: input.stateAddress || "your property",
    slotLabel: `${input.option.id}) ${input.option.label}`,
  });
  await sendConversationMessage({
    organization: input.organization,
    lead: input.lead,
    stateId: input.stateId,
    body: withSignature({ body: confirmation, websiteSignature: input.organization.smsWebsiteSignature }),
    messageType: "AUTOMATION",
  });

  return true;
}

async function activateHumanTakeover(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  stateId: string;
  currentStage: ConversationStage;
  reason: string;
  inboundBody: string;
  workSummary?: string | null;
  addressText?: string | null;
  addressCity?: string | null;
  timeframe?: string | null;
  sendAck?: boolean;
  templates: TemplateBundle;
}) {
  const pausedUntil = addMinutes(new Date(), TAKEOVER_PAUSE_HOURS * 60);
  await prisma.$transaction(async (tx) => {
    await tx.leadConversationState.update({
      where: { id: input.stateId },
      data: {
        stage: "HUMAN_TAKEOVER",
        pausedUntil,
        nextFollowUpAt: null,
        bookingOptions: Prisma.DbNull,
      },
    });
    await tx.lead.update({
      where: { id: input.lead.id },
      data: {
        intakeStage: "COMPLETED",
        nextFollowUpAt: null,
      },
    });
    await tx.leadNote.create({
      data: {
        orgId: input.organization.id,
        leadId: input.lead.id,
        body: buildConversationSummaryLine({
          lead: input.lead,
          reason: input.reason,
          inboundBody: input.inboundBody,
          workSummary: input.workSummary,
          addressText: input.addressText,
          addressCity: input.addressCity,
          timeframe: input.timeframe,
        }),
      },
    });
  });

  await auditConversation({
    orgId: input.organization.id,
    leadId: input.lead.id,
    conversationStateId: input.stateId,
    action: "TAKEOVER_TRIGGERED",
    metadataJson: {
      reason: input.reason,
      pausedUntil: pausedUntil.toISOString(),
      previousStage: input.currentStage,
    },
  });

  if (input.sendAck) {
    await sendConversationMessage({
      organization: input.organization,
      lead: input.lead,
      stateId: input.stateId,
      body: withSignature({
        body: renderSmsTemplate(input.templates.humanAck, { bizName: input.organization.name }),
        websiteSignature: input.organization.smsWebsiteSignature,
      }),
      messageType: "AUTOMATION",
    });
  }
}

export async function startConversationalSmsFromMissedCall(input: {
  orgId: string;
  leadId: string;
  toNumberE164: string;
}): Promise<MissedCallKickoffDispatchResult> {
  const now = new Date();
  const [organization, lead] = await Promise.all([
    getConversationOrgConfig(input.orgId),
    getConversationLead(input.leadId),
  ]);
  if (!organization || !lead) {
    return { outcome: "skipped", reason: "missing_context" };
  }
  if (lead.status === "DNC") {
    return { outcome: "skipped", reason: "lead_dnc" };
  }
  if (!organization.autoReplyEnabled) {
    return { outcome: "skipped", reason: "auto_reply_disabled" };
  }

  const state = await getOrCreateConversationState(lead);
  if (shouldSuppressMissedCallKickoff({ state, now })) {
    return { outcome: "skipped", reason: "conversation_in_progress" };
  }

  const templates = buildTemplateBundle({ organization, lead });
  const kickoff = buildMissedCallOpeningMessages({
    organization,
    locale: templates.locale,
    openerTemplate: templates.initial,
  });
  const initialSend = await sendConversationMessage({
    organization,
    lead,
    stateId: state.id,
    body: kickoff.immediateBody,
    messageType: "AUTOMATION",
    allowPendingA2P: true,
  });

  if (!initialSend.ok) {
    return {
      outcome: "failed",
      reason: initialSend.notice || "Missed-call opener failed to send.",
    };
  }

  if (kickoff.delayedPromptBody) {
    await queueConversationReply({
      organization,
      lead,
      stateId: state.id,
      body: kickoff.delayedPromptBody,
      messageType: "AUTOMATION",
      fallbackFromNumberE164: input.toNumberE164,
      delayMinutes: MISSED_CALL_FOLLOW_UP_DELAY_MINUTES,
    });
  }

  await setConversationStage({
    orgId: organization.id,
    leadId: lead.id,
    stateId: state.id,
    previousStage: state.stage,
    stage: "ASKED_WORK",
    data: {
      pausedUntil: null,
      stoppedAt: null,
      bookingOptions: Prisma.DbNull,
      nextFollowUpAt: null,
      followUpStep: 0,
    },
  });
  await setNextFollowUp({
    organization,
    leadId: lead.id,
    stateId: state.id,
    stage: "ASKED_WORK",
    sentFollowUpCount: 0,
    fromAt: new Date(),
  });

  return {
    outcome: "sent",
    messageStatus: initialSend.status,
    notice: initialSend.notice,
  };
}

export async function queueConversationalIntroForQuietHours(input: {
  orgId: string;
  leadId: string;
  toNumberE164: string;
  sendAfterAt: Date;
}): Promise<MissedCallKickoffDispatchResult> {
  const now = new Date();
  const [organization, lead] = await Promise.all([
    getConversationOrgConfig(input.orgId),
    getConversationLead(input.leadId),
  ]);
  if (!organization || !lead) {
    return { outcome: "skipped", reason: "missing_context" };
  }
  if (lead.status === "DNC") {
    return { outcome: "skipped", reason: "lead_dnc" };
  }
  if (!organization.autoReplyEnabled) {
    return { outcome: "skipped", reason: "auto_reply_disabled" };
  }

  const state = await getOrCreateConversationState(lead);
  if (shouldSuppressMissedCallKickoff({ state, now })) {
    return { outcome: "skipped", reason: "conversation_in_progress" };
  }
  const templates = buildTemplateBundle({ organization, lead });
  const kickoff = buildMissedCallOpeningMessages({
    organization,
    locale: templates.locale,
    openerTemplate: templates.initial,
  });
  const fromNumber = organization.smsFromNumberE164 || input.toNumberE164;
  const queued = await queueSmsDispatch({
    orgId: organization.id,
    leadId: lead.id,
    kind: "MISSED_CALL_INTRO",
    messageType: "AUTOMATION",
    fromNumberE164: fromNumber,
    toNumberE164: input.toNumberE164,
    body: kickoff.immediateBody,
    sendAfterAt: input.sendAfterAt,
  });

  if (kickoff.delayedPromptBody) {
    await queueConversationReply({
      organization,
      lead,
      stateId: state.id,
      body: kickoff.delayedPromptBody,
      messageType: "AUTOMATION",
      fallbackFromNumberE164: input.toNumberE164,
      sendAfterAt: addMinutes(input.sendAfterAt, MISSED_CALL_FOLLOW_UP_DELAY_MINUTES),
    });
  }

  await setConversationStage({
    orgId: organization.id,
    leadId: lead.id,
    stateId: state.id,
    previousStage: state.stage,
    stage: "ASKED_WORK",
    data: {
      pausedUntil: null,
      stoppedAt: null,
      bookingOptions: Prisma.DbNull,
      nextFollowUpAt: null,
      followUpStep: 0,
    },
  });

  // Schedule relative to the delayed ask-work prompt so there is still a reminder ladder.
  const firstFollowUp = addMinutes(
    input.sendAfterAt,
    (kickoff.delayedPromptBody ? MISSED_CALL_FOLLOW_UP_DELAY_MINUTES : 0) +
      (getFollowUpCadenceMinutes("ASKED_WORK", ACTIVE_CONVERSATION_FOLLOW_UP_STAGES)[0] || 10),
  );
  await prisma.$transaction([
    prisma.leadConversationState.update({
      where: { id: state.id },
      data: {
        nextFollowUpAt: firstFollowUp,
        followUpStep: 0,
      },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        nextFollowUpAt: firstFollowUp,
      },
    }),
  ]);

  return { outcome: "queued", queueId: queued.id, created: queued.created };
}

export async function handleConversationalSmsInbound(input: {
  orgId: string;
  leadId: string;
  inboundBody: string;
  toNumberE164?: string | null;
}): Promise<HandleInboundResult> {
  const body = sanitizeMessageBody(input.inboundBody);
  if (!body) {
    return { stage: "NEW", action: "NOOP" };
  }

  const [organization, lead] = await Promise.all([
    getConversationOrgConfig(input.orgId),
    getConversationLead(input.leadId),
  ]);
  if (!organization || !lead) {
    return { stage: "NEW", action: "IGNORED" };
  }

  const state = await getOrCreateConversationState(lead);
  const templates = buildTemplateBundle({ organization, lead });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        lastInboundAt: now,
        lastContactedAt: now,
        nextFollowUpAt: null,
      },
    });
    await tx.leadConversationState.update({
      where: { id: state.id },
      data: {
        lastInboundAt: now,
        nextFollowUpAt: null,
      },
    });
  });
  await cancelQueuedAutomation({
    orgId: organization.id,
    leadId: lead.id,
    reason: "Canceled after inbound reply.",
  });

  if (hasStopKeyword(body)) {
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: "DNC",
          nextFollowUpAt: null,
          intakeStage: "COMPLETED",
        },
      });
      await tx.leadConversationState.update({
        where: { id: state.id },
        data: {
          stage: "CLOSED",
          stoppedAt: now,
          pausedUntil: null,
          nextFollowUpAt: null,
          bookingOptions: Prisma.DbNull,
          followUpStep: 0,
        },
      });
    });
    await auditConversation({
      orgId: organization.id,
      leadId: lead.id,
      conversationStateId: state.id,
      action: "OPT_OUT",
      metadataJson: { inbound: body },
    });
    await sendConversationMessage({
      organization,
      lead,
      stateId: state.id,
      body: renderSmsTemplate(templates.optOutConfirmation, {
        bizName: organization.name,
      }),
      messageType: "AUTOMATION",
      allowWhenStopped: true,
    });
    return { stage: "CLOSED", action: "STOPPED" };
  }

  if (hasStartKeyword(body) && lead.status === "DNC") {
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: "FOLLOW_UP",
          intakeStage: "INTRO_SENT",
        },
      });
      await tx.leadConversationState.update({
        where: { id: state.id },
        data: {
          stage: "ASKED_WORK",
          stoppedAt: null,
          pausedUntil: null,
          followUpStep: 0,
          nextFollowUpAt: null,
        },
      });
    });

    const restartPrompt = ensureSmsOptOutHint(
      renderSmsTemplate(templates.initial, { bizName: organization.name }),
      templates.locale,
    );
    await sendConversationMessage({
      organization,
      lead: { ...lead, status: "FOLLOW_UP" },
      stateId: state.id,
      body: withSignature({ body: restartPrompt, websiteSignature: organization.smsWebsiteSignature }),
      messageType: "AUTOMATION",
    });
    await setNextFollowUp({
      organization,
      leadId: lead.id,
      stateId: state.id,
      stage: "ASKED_WORK",
      sentFollowUpCount: 0,
    });
    return { stage: "ASKED_WORK", action: "UNSTOPPED" };
  }

  if (state.stoppedAt) {
    return { stage: state.stage, action: "IGNORED" };
  }

  if (state.pausedUntil && state.pausedUntil.getTime() > now.getTime()) {
    return { stage: state.stage, action: "IGNORED" };
  }

  if (state.stage === "BOOKED" || state.stage === "CLOSED") {
    return { stage: state.stage, action: "IGNORED" };
  }

  if (shouldRouteInboundSmsToHuman(body)) {
    await activateHumanTakeover({
      organization,
      lead,
      stateId: state.id,
      currentStage: state.stage,
      reason: "Lead asked for human follow-up",
      inboundBody: body,
      workSummary: state.workSummary,
      addressText: state.addressText,
      addressCity: state.addressCity,
      timeframe: state.timeframe,
      sendAck: true,
      templates,
    });
    return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
  }

  let currentStage: ConversationStage = state.stage;
  let workSummary = state.workSummary || null;
  let addressText = state.addressText || null;
  let addressCity = state.addressCity || null;
  let timeframe = state.timeframe || null;
  let bookingOptions = (Array.isArray(state.bookingOptions) ? (state.bookingOptions as unknown as SlotOption[]) : null) || [];
  const llmDecisionCache = new Map<string, Promise<Awaited<ReturnType<typeof maybeInterpretConversationalSmsTurn>>>>();

  const getLlmDecision = async (
    overrides: Partial<
      Pick<ConversationalSmsLlmInput, "stage" | "workSummary" | "addressText" | "addressCity" | "timeframe" | "bookingOptions">
    > = {},
  ) => {
    const llmInput: ConversationalSmsLlmInput = {
      organization,
      lead,
      stage: overrides.stage ?? (currentStage === "NEW" ? "ASKED_WORK" : currentStage),
      inboundBody: body,
      workSummary: overrides.workSummary ?? workSummary,
      addressText: overrides.addressText ?? addressText,
      addressCity: overrides.addressCity ?? addressCity,
      timeframe: overrides.timeframe ?? timeframe,
      bookingOptions: overrides.bookingOptions ?? bookingOptions,
    };
    const cacheKey = buildConversationalSmsLlmCacheKey(llmInput);
    let decisionPromise = llmDecisionCache.get(cacheKey);
    if (!decisionPromise) {
      decisionPromise = maybeInterpretConversationalSmsTurn(llmInput);
      llmDecisionCache.set(cacheKey, decisionPromise);
    }

    return decisionPromise;
  };

  const maybeActivateLlmTakeover = async (reason: string) => {
    const llmDecision = await getLlmDecision();
    if (!llmDecision?.shouldHandoff || !hasConversationalSmsLlmHandoffConfidence(llmDecision)) {
      return false;
    }

    await activateHumanTakeover({
      organization,
      lead,
      stateId: state.id,
      currentStage,
      reason,
      inboundBody: body,
      workSummary,
      addressText,
      addressCity,
      timeframe,
      templates,
    });
    return true;
  };

  if (currentStage === "NEW") {
    currentStage = "ASKED_WORK";
  }

  if (currentStage === "ASKED_WORK") {
    const inferred = parseWorkAndLocation(body);
    if (inferred) {
      workSummary = inferred.workSummary;
      addressText = inferred.addressText;
      addressCity = inferred.addressCity;
    } else {
      const standaloneLocation = parseAddress(body);
      if (standaloneLocation.kind === "ADDRESS") {
        addressText = standaloneLocation.addressText || body;
      } else if (standaloneLocation.kind === "CITY") {
        addressCity = standaloneLocation.city || body;
      } else {
        workSummary = body;
      }
    }

    if (await maybeActivateLlmTakeover("Lead asked for help that needs a human follow-up")) {
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }
    const stageLlmDecision = await getLlmDecision();
    if (hasConversationalSmsLlmExtractionConfidence(stageLlmDecision)) {
      workSummary = workSummary || stageLlmDecision?.workSummary || null;
      addressText = addressText || stageLlmDecision?.addressText || null;
      addressCity = addressCity || stageLlmDecision?.addressCity || null;
    }

    if (!workSummary || (!addressText && !addressCity)) {
      if (stageLlmDecision?.shouldHandoff && hasConversationalSmsLlmHandoffConfidence(stageLlmDecision)) {
        await activateHumanTakeover({
          organization,
          lead,
          stateId: state.id,
          currentStage: currentStage,
          reason: "Lead asked for help that needs a human follow-up",
          inboundBody: body,
          workSummary,
          addressText,
          addressCity,
          timeframe,
          templates,
        });
        return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
      }

      if (hasConversationalSmsLlmExtractionConfidence(stageLlmDecision)) {
        workSummary = workSummary || stageLlmDecision?.workSummary || null;
        addressText = addressText || stageLlmDecision?.addressText || null;
        addressCity = addressCity || stageLlmDecision?.addressCity || null;
      }
    }

    if (workSummary && (addressText || addressCity)) {
      currentStage = "ASKED_TIMEFRAME";
      await setConversationStage({
        orgId: organization.id,
        leadId: lead.id,
        stateId: state.id,
        previousStage: state.stage,
        stage: "ASKED_TIMEFRAME",
        data: {
          workSummary,
          addressText,
          addressCity,
          timeframe: null,
          bookingOptions: Prisma.DbNull,
          followUpStep: 0,
        },
        leadData: {
          businessType: workSummary,
          intakeWorkTypeText: workSummary,
          city: addressCity,
          intakeLocationText: addressText || addressCity,
        },
      });
      const llmDecision = await getLlmDecision();
      const askTimeframe = renderSmsTemplate(templates.askTimeframe, {
        bizName: organization.name,
        workingHours: organization.smsWorkingHoursText || "",
      });
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: preferLlmReplyBody(askTimeframe, getTrustedConversationalSmsLlmReplyBody(llmDecision)),
          websiteSignature: organization.smsWebsiteSignature,
        }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
      await setNextFollowUp({
        organization,
        leadId: lead.id,
        stateId: state.id,
        stage: "ASKED_TIMEFRAME",
        sentFollowUpCount: 0,
      });
      return { stage: "ASKED_TIMEFRAME", action: "ADVANCED" };
    }

    if (!workSummary && (addressText || addressCity)) {
      const llmDecision = await getLlmDecision();
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: state.id },
          data: {
            addressText,
            addressCity,
            followUpStep: 0,
          },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: {
            city: addressCity,
            intakeLocationText: addressText || addressCity,
          },
        }),
      ]);

      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: preferLlmReplyBody(
            renderSmsTemplate(templates.clarification, {
              bizName: organization.name,
              missingField: formatMissingField("ASKED_WORK", templates.locale),
            }),
            getTrustedConversationalSmsLlmReplyBody(llmDecision),
          ),
          websiteSignature: organization.smsWebsiteSignature,
        }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
      await setNextFollowUp({
        organization,
        leadId: lead.id,
        stateId: state.id,
        stage: "ASKED_WORK",
        sentFollowUpCount: 0,
      });
      return { stage: "ASKED_WORK", action: "ADVANCED" };
    }

    currentStage = "ASKED_ADDRESS";
    await setConversationStage({
      orgId: organization.id,
      leadId: lead.id,
      stateId: state.id,
      previousStage: state.stage,
      stage: "ASKED_ADDRESS",
      data: {
        workSummary,
        addressText: null,
        addressCity: null,
        timeframe: null,
        bookingOptions: Prisma.DbNull,
        followUpStep: 0,
      },
      leadData: {
        businessType: workSummary,
        intakeWorkTypeText: workSummary,
      },
    });
    const llmDecision = await getLlmDecision();
    await queueConversationReply({
      organization,
      lead,
      stateId: state.id,
      body: withSignature({
        body: preferLlmReplyBody(
          renderSmsTemplate(templates.askAddress, { bizName: organization.name }),
          getTrustedConversationalSmsLlmReplyBody(llmDecision),
        ),
        websiteSignature: organization.smsWebsiteSignature,
      }),
      messageType: "AUTOMATION",
      fallbackFromNumberE164: input.toNumberE164,
    });
    await setNextFollowUp({
      organization,
      leadId: lead.id,
      stateId: state.id,
      stage: "ASKED_ADDRESS",
      sentFollowUpCount: 0,
    });
    return { stage: "ASKED_ADDRESS", action: "ADVANCED" };
  }

  if (currentStage === "ASKED_ADDRESS") {
    const inferred = parseWorkAndLocation(body);
    workSummary = inferred?.workSummary || workSummary;
    const parsed = inferred
      ? inferred.addressText
        ? { kind: "ADDRESS" as const, addressText: inferred.addressText }
        : inferred.addressCity
          ? { kind: "CITY" as const, city: inferred.addressCity }
          : parseAddress(body)
      : parseAddress(body);
    if (await maybeActivateLlmTakeover("Lead asked for help that needs a human follow-up")) {
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }
    const stageLlmDecision = await getLlmDecision();
    if (hasConversationalSmsLlmExtractionConfidence(stageLlmDecision)) {
      workSummary = workSummary || stageLlmDecision?.workSummary || null;
      addressText = addressText || stageLlmDecision?.addressText || null;
      addressCity = addressCity || stageLlmDecision?.addressCity || null;
    }
    if (parsed.kind !== "ADDRESS" && parsed.kind !== "CITY") {
      if (stageLlmDecision?.shouldHandoff && hasConversationalSmsLlmHandoffConfidence(stageLlmDecision)) {
        await activateHumanTakeover({
          organization,
          lead,
          stateId: state.id,
          currentStage: currentStage,
          reason: "Lead asked for help that needs a human follow-up",
          inboundBody: body,
          workSummary,
          addressText,
          addressCity,
          timeframe,
          templates,
        });
        return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
      }

      if (hasConversationalSmsLlmExtractionConfidence(stageLlmDecision)) {
        workSummary = workSummary || stageLlmDecision?.workSummary || null;
        addressText = addressText || stageLlmDecision?.addressText || null;
        addressCity = addressCity || stageLlmDecision?.addressCity || null;
      }
    }

    const resolvedParsed =
      addressText || addressCity
        ? addressText
          ? { kind: "ADDRESS" as const, addressText }
          : { kind: "CITY" as const, city: addressCity || body }
        : parsed;
    if (resolvedParsed.kind === "ADDRESS" || resolvedParsed.kind === "CITY") {
      addressText = resolvedParsed.kind === "ADDRESS" ? resolvedParsed.addressText || null : addressText;
      addressCity = resolvedParsed.kind === "CITY" ? resolvedParsed.city || body : addressCity;
      currentStage = "ASKED_TIMEFRAME";
      await setConversationStage({
        orgId: organization.id,
        leadId: lead.id,
        stateId: state.id,
        previousStage: state.stage,
        stage: "ASKED_TIMEFRAME",
        data: {
          workSummary,
          addressText,
          addressCity,
          timeframe: null,
          bookingOptions: Prisma.DbNull,
          followUpStep: 0,
        },
        leadData: {
          businessType: workSummary,
          intakeWorkTypeText: workSummary,
          city: addressCity,
          intakeLocationText: addressText || addressCity,
        },
      });
      const llmDecision = await getLlmDecision();
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: preferLlmReplyBody(
            renderSmsTemplate(templates.askTimeframe, {
              bizName: organization.name,
              workingHours: organization.smsWorkingHoursText || "",
            }),
            getTrustedConversationalSmsLlmReplyBody(llmDecision),
          ),
          websiteSignature: organization.smsWebsiteSignature,
        }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
      await setNextFollowUp({
        organization,
        leadId: lead.id,
        stateId: state.id,
        stage: "ASKED_TIMEFRAME",
        sentFollowUpCount: 0,
      });
      return { stage: "ASKED_TIMEFRAME", action: "ADVANCED" };
    }

    const replyLlmDecision = await getLlmDecision();
    const prompt = addressText || addressCity
      ? preferLlmReplyBody(
          renderSmsTemplate(templates.clarification, {
            bizName: organization.name,
            missingField: formatMissingField("ASKED_ADDRESS", templates.locale),
          }),
          getTrustedConversationalSmsLlmReplyBody(replyLlmDecision),
        )
      : preferLlmReplyBody(
          renderSmsTemplate(templates.askAddress, { bizName: organization.name }),
          getTrustedConversationalSmsLlmReplyBody(replyLlmDecision),
        );
    await queueConversationReply({
      organization,
      lead,
      stateId: state.id,
      body: withSignature({ body: prompt, websiteSignature: organization.smsWebsiteSignature }),
      messageType: "AUTOMATION",
      fallbackFromNumberE164: input.toNumberE164,
    });
    await setNextFollowUp({
      organization,
      leadId: lead.id,
      stateId: state.id,
      stage: "ASKED_ADDRESS",
      sentFollowUpCount: 0,
    });
    return { stage: "ASKED_ADDRESS", action: "ADVANCED" };
  }

  if (currentStage === "ASKED_TIMEFRAME") {
    timeframe = parseTimeframe(body);
    if (await maybeActivateLlmTakeover("Lead asked for help that needs a human follow-up")) {
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }
    if (!timeframe) {
      const llmDecision = await getLlmDecision();
      if (llmDecision?.shouldHandoff && hasConversationalSmsLlmHandoffConfidence(llmDecision)) {
        await activateHumanTakeover({
          organization,
          lead,
          stateId: state.id,
          currentStage: currentStage,
          reason: "Lead asked for help that needs a human follow-up",
          inboundBody: body,
          workSummary,
          addressText,
          addressCity,
          timeframe,
          templates,
        });
        return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
      }

      if (hasConversationalSmsLlmExtractionConfidence(llmDecision)) {
        timeframe = llmDecision?.timeframe || null;
      }
    }

    if (!timeframe) {
      const llmDecision = await getLlmDecision();
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: preferLlmReplyBody(
            renderSmsTemplate(templates.clarification, {
              bizName: organization.name,
              missingField: formatMissingField("ASKED_TIMEFRAME", templates.locale),
            }),
            getTrustedConversationalSmsLlmReplyBody(llmDecision),
          ),
          websiteSignature: organization.smsWebsiteSignature,
        }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
      await setNextFollowUp({
        organization,
        leadId: lead.id,
        stateId: state.id,
        stage: "ASKED_TIMEFRAME",
        sentFollowUpCount: 0,
      });
      return { stage: "ASKED_TIMEFRAME", action: "ADVANCED" };
    }

    await prisma.leadConversationState.update({
      where: { id: state.id },
      data: {
        timeframe,
        followUpStep: 0,
      },
    });

    if (!organization.autoBookingEnabled) {
      await activateHumanTakeover({
        organization,
        lead,
        stateId: state.id,
        currentStage: state.stage,
        reason: "Auto-booking disabled; lead answered timeframe",
        inboundBody: body,
        workSummary,
        addressText,
        addressCity,
        timeframe,
        templates,
      });
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }

    const options = await createBookingOptions({
      organization,
      lead,
      locale: templates.locale,
    });
    bookingOptions = options;

    currentStage = "OFFERED_BOOKING";
    await setConversationStage({
      orgId: organization.id,
      leadId: lead.id,
      stateId: state.id,
      previousStage: state.stage,
      stage: "OFFERED_BOOKING",
      data: {
        workSummary,
        addressText,
        addressCity,
        timeframe,
        bookingOptions: options as unknown as Prisma.InputJsonValue,
        followUpStep: 0,
      },
    });

    if (options.length === 0) {
      const llmDecision = await getLlmDecision();
      const fallback = templates.locale === "ES"
        ? "No vemos horarios abiertos ahora mismo. Te enviaremos nuevas opciones en breve."
        : "I don't have open slots right now. I'll send fresh options shortly.";
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: preferLlmReplyBody(fallback, getTrustedConversationalSmsLlmReplyBody(llmDecision)),
          websiteSignature: organization.smsWebsiteSignature,
        }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
    } else {
      const llmDecision = await getLlmDecision();
      const offer = renderSmsTemplate(templates.offerBooking, {
        bizName: organization.name,
        ...buildSlotTemplateContext(options),
        workingHours: organization.smsWorkingHoursText || "",
      });
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: preferLlmReplyBody(offer, getTrustedConversationalSmsLlmReplyBody(llmDecision)),
          websiteSignature: organization.smsWebsiteSignature,
        }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
    }

    await setNextFollowUp({
      organization,
      leadId: lead.id,
      stateId: state.id,
      stage: "OFFERED_BOOKING",
      sentFollowUpCount: 0,
    });
    return { stage: "OFFERED_BOOKING", action: "ADVANCED" };
  }

  if (currentStage === "OFFERED_BOOKING") {
    if (!Array.isArray(bookingOptions) || bookingOptions.length === 0) {
      const refreshed = await createBookingOptions({
        organization,
        lead,
        locale: templates.locale,
      });
      bookingOptions = refreshed;
      await prisma.leadConversationState.update({
        where: { id: state.id },
        data: {
          bookingOptions: refreshed as unknown as Prisma.InputJsonValue,
          followUpStep: 0,
        },
      });
    }

    const selected = parseBookingSelection({
      inboundBody: body,
      options: bookingOptions,
    });
    let selectedOption = selected;
    if (await maybeActivateLlmTakeover("Lead needs a custom scheduling follow-up")) {
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }
    if (!selectedOption) {
      const llmDecision = await getLlmDecision();
      if (llmDecision?.shouldHandoff && hasConversationalSmsLlmHandoffConfidence(llmDecision)) {
        await activateHumanTakeover({
          organization,
          lead,
          stateId: state.id,
          currentStage: currentStage,
          reason: "Lead needs a custom scheduling follow-up",
          inboundBody: body,
          workSummary,
          addressText,
          addressCity,
          timeframe,
          templates,
        });
        return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
      }

      if (hasConversationalSmsLlmExtractionConfidence(llmDecision) && llmDecision?.selectedSlotId) {
        selectedOption = bookingOptions.find((option) => option.id === llmDecision.selectedSlotId) || null;
      }
    }

    if (selectedOption) {
      const booked = await bookFromSelectedOption({
        organization,
        lead,
        stateId: state.id,
        option: selectedOption,
        templates,
        stateAddress: addressText || addressCity || null,
        workSummary,
        timeframe,
      });
      if (booked) {
        return { stage: "BOOKED", action: "BOOKED" };
      }
    }

    if (isAmbiguousTimeSelection(body)) {
      await activateHumanTakeover({
        organization,
        lead,
        stateId: state.id,
        currentStage: currentStage,
        reason: "Lead provided ambiguous booking time",
        inboundBody: body,
        workSummary,
        addressText,
        addressCity,
        timeframe,
        templates,
      });
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }

    const llmDecision = await getLlmDecision();
    const prompt = renderSmsTemplate(templates.clarification, {
      bizName: organization.name,
      missingField: formatMissingField("OFFERED_BOOKING", templates.locale),
    });
    const slotList = bookingOptions.length > 0 ? `\n\n${buildSlotList(bookingOptions)}` : "";
    await queueConversationReply({
      organization,
      lead,
      stateId: state.id,
      body: withSignature({
        body: preferLlmReplyBody(`${prompt}${slotList}`, getTrustedConversationalSmsLlmReplyBody(llmDecision)),
        websiteSignature: organization.smsWebsiteSignature,
      }),
      messageType: "AUTOMATION",
      fallbackFromNumberE164: input.toNumberE164,
    });
    await setNextFollowUp({
      organization,
      leadId: lead.id,
      stateId: state.id,
      stage: "OFFERED_BOOKING",
      sentFollowUpCount: 0,
    });
    return { stage: "OFFERED_BOOKING", action: "ADVANCED" };
  }

  return { stage: currentStage, action: "IGNORED" };
}

export async function processDueConversationalFollowUps(input?: { maxLeads?: number }) {
  const now = new Date();
  const limit = Math.max(1, Math.min(500, input?.maxLeads ?? 150));
  const dueStates = await prisma.leadConversationState.findMany({
    where: {
      nextFollowUpAt: { lte: now },
      stage: { in: [...ACTIVE_CONVERSATION_FOLLOW_UP_STAGES] },
      stoppedAt: null,
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
    select: {
      id: true,
      orgId: true,
      leadId: true,
      stage: true,
      followUpStep: true,
      lastInboundAt: true,
      nextFollowUpAt: true,
    },
  });

  const scanned = dueStates.length;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const orgCache = new Map<string, ConversationOrgConfig | null>();

  for (const item of dueStates) {
    if (!item.nextFollowUpAt) {
      skipped += 1;
      continue;
    }

    const claimed = await claimDueConversationFollowUp({
      stateId: item.id,
      stage: item.stage,
      followUpStep: item.followUpStep,
      nextFollowUpAt: item.nextFollowUpAt,
    });
    if (!claimed) {
      continue;
    }

    const liveState = await getLiveConversationFollowUpState(item.id);
    if (!liveState || !liveState.lead) {
      skipped += 1;
      continue;
    }

    if (
      shouldSkipQueuedFollowUp({
        loaded: {
          stage: item.stage,
          followUpStep: item.followUpStep,
          lastInboundAt: item.lastInboundAt,
        },
        current: {
          stage: liveState.stage,
          followUpStep: liveState.followUpStep,
          lastInboundAt: liveState.lastInboundAt,
          pausedUntil: liveState.pausedUntil,
          stoppedAt: liveState.stoppedAt,
        },
        now,
      })
    ) {
      skipped += 1;
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: null },
        }),
        prisma.lead.update({
          where: { id: liveState.lead.id },
          data: { nextFollowUpAt: null },
        }),
      ]);
      continue;
    }

    const lead = liveState.lead as ConversationLead;
    const throttledUntil = getAutomatedFollowUpThrottleUntil({
      lastOutboundAt: liveState.lead.lastOutboundAt,
      now,
    });
    if (throttledUntil) {
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: throttledUntil },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: throttledUntil },
        }),
      ]);
      skipped += 1;
      continue;
    }

    let org = orgCache.get(item.orgId) ?? null;
    if (!orgCache.has(item.orgId)) {
      org = await getConversationOrgConfig(item.orgId);
      orgCache.set(item.orgId, org);
    }
    if (!org) {
      skipped += 1;
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: null },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: null },
        }),
      ]);
      continue;
    }

    if (!org.followUpsEnabled || lead.status === "DNC") {
      skipped += 1;
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: null },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: null },
        }),
      ]);
      continue;
    }

    const calendarTimeZone = org.messagingTimezone || org.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
    const inAllowedWindow = isWithinSmsSendWindow({
      at: now,
      timeZone: calendarTimeZone,
      startMinute: org.smsQuietHoursStartMinute,
      endMinute: org.smsQuietHoursEndMinute,
    });
    if (!inAllowedWindow) {
      const nextWindowAt = nextSmsSendWindowStartUtc({
        at: now,
        timeZone: calendarTimeZone,
        startMinute: org.smsQuietHoursStartMinute,
        endMinute: org.smsQuietHoursEndMinute,
      });
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: nextWindowAt },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: nextWindowAt },
        }),
      ]);
      skipped += 1;
      continue;
    }

    const templates = buildTemplateBundle({
      organization: org,
      lead,
    });
    const cadence = getFollowUpCadenceMinutes(liveState.stage, ACTIVE_CONVERSATION_FOLLOW_UP_STAGES);
    if (cadence.length === 0 || liveState.followUpStep >= cadence.length) {
      skipped += 1;
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: null },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: null },
        }),
      ]);
      continue;
    }

    const missingField = formatMissingField(liveState.stage, templates.locale);
    const template =
      liveState.followUpStep >= 1
          ? templates.followUp2
          : templates.followUp1;

    let body = renderSmsTemplate(template, {
      bizName: org.name,
      missingField,
      websiteSignature: org.smsWebsiteSignature || "",
    });

    if (liveState.stage === "OFFERED_BOOKING") {
      const options = await createBookingOptions({
        organization: org,
        lead,
        locale: templates.locale,
      });
      await prisma.leadConversationState.update({
        where: { id: liveState.id },
        data: { bookingOptions: options as unknown as Prisma.InputJsonValue },
      });
      if (options.length > 0) {
        body = `${body}\n\n${renderSmsTemplate(templates.offerBooking, {
          bizName: org.name,
          ...buildSlotTemplateContext(options),
        })}`;
      } else {
        body =
          templates.locale === "ES"
            ? "Aún no hay horarios abiertos. Te mandaremos opciones nuevas pronto."
            : "I still don't have open slots. I'll send fresh options shortly.";
      }
    }

    const result = await sendConversationMessage({
      organization: org,
      lead,
      stateId: liveState.id,
      body: withSignature({ body, websiteSignature: org.smsWebsiteSignature }),
      messageType: "SYSTEM_NUDGE",
    });
    if (!result.ok) {
      failed += 1;
      const retryAt = addMinutes(now, 20);
      await prisma.$transaction([
        prisma.leadConversationState.update({
          where: { id: liveState.id },
          data: { nextFollowUpAt: retryAt },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: retryAt },
        }),
      ]);
      continue;
    }

    sent += 1;
    const postSendState = await prisma.leadConversationState.findUnique({
      where: { id: liveState.id },
      select: {
        stage: true,
        followUpStep: true,
        lastInboundAt: true,
        pausedUntil: true,
        stoppedAt: true,
      },
    });
    if (
      postSendState &&
      !shouldSkipQueuedFollowUp({
        loaded: {
          stage: liveState.stage,
          followUpStep: liveState.followUpStep,
          lastInboundAt: liveState.lastInboundAt,
        },
        current: postSendState,
        now: new Date(),
      })
    ) {
      await setNextFollowUp({
        organization: org,
        leadId: lead.id,
        stateId: liveState.id,
        stage: liveState.stage,
        sentFollowUpCount: liveState.followUpStep + 1,
      });
    }
  }

  return {
    scanned,
    sent,
    skipped,
    failed,
  };
}

export async function pauseConversationalAutomationForManualMessage(input: {
  orgId: string;
  leadId: string;
  reason?: string;
  hours?: number;
}) {
  const [organization, lead] = await Promise.all([
    getConversationOrgConfig(input.orgId),
    getConversationLead(input.leadId),
  ]);
  if (!organization || !lead) {
    return { ok: false as const };
  }

  const state = await getOrCreateConversationState(lead);
  const pausedUntil = addMinutes(new Date(), Math.max(1, Math.min(72, input.hours ?? 24)) * 60);
  await prisma.$transaction([
    prisma.leadConversationState.update({
      where: { id: state.id },
      data: {
        pausedUntil,
        nextFollowUpAt: null,
      },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        nextFollowUpAt: null,
      },
    }),
  ]);

  await cancelQueuedAutomation({
    orgId: organization.id,
    leadId: lead.id,
    reason: input.reason || "Paused after manual outbound message.",
  });

  return { ok: true as const, pausedUntil };
}
