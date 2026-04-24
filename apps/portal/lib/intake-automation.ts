import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Prisma } from "@prisma/client";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "./calendar/availability";
import { recordOutboundSmsCommunicationEvent } from "./communication-events";
import {
  resolveIntakeCallbackSelection,
  type IntakeCallbackHoldSelection,
} from "./intake-automation-core";
import { formatCallbackTime } from "./intake-time";
import { prisma } from "./prisma";
import { pickLocalizedTemplate, resolveMessageLocale } from "./message-language";
import { ensureSmsA2POpenerDisclosure } from "./sms-compliance";
import { sendOutboundSms } from "./sms";
import { queueSmsDispatch } from "./sms-dispatch-queue";
import { listWorkspaceUsers, sortWorkspaceUsersByCalendarRoleThenLabel } from "./workspace-users";

export type IntakeOrganizationSettings = {
  id: string;
  smsFromNumberE164: string | null;
  smsQuietHoursStartMinute: number | null;
  smsQuietHoursEndMinute: number | null;
  calendarTimezone: string | null;
  messageLanguage: "EN" | "ES" | "AUTO";
  missedCallAutoReplyBody: string | null;
  missedCallAutoReplyBodyEn: string | null;
  missedCallAutoReplyBodyEs: string | null;
  intakeAutomationEnabled: boolean;
  intakeAskLocationBody: string | null;
  intakeAskLocationBodyEn: string | null;
  intakeAskLocationBodyEs: string | null;
  intakeAskWorkTypeBody: string | null;
  intakeAskWorkTypeBodyEn: string | null;
  intakeAskWorkTypeBodyEs: string | null;
  intakeAskCallbackBody: string | null;
  intakeAskCallbackBodyEn: string | null;
  intakeAskCallbackBodyEs: string | null;
  intakeCompletionBody: string | null;
  intakeCompletionBodyEn: string | null;
  intakeCompletionBodyEs: string | null;
};

const DEFAULT_INTRO =
  "Hey, sorry we missed your call. We would still be happy to help.";
const DEFAULT_ASK_LOCATION = "What city are you located in?";
const DEFAULT_ASK_WORK_TYPE = "What type of work do you need done?";
const DEFAULT_ASK_CALLBACK = "Pick one of these available callback times:";
const DEFAULT_COMPLETION =
  "Perfect, you're set for {{time}}. We'll follow up then.";
const CALLBACK_EVENT_TITLE = "SMS Callback Scheduled";
const CALLBACK_EVENT_DESCRIPTION = "Auto-scheduled from SMS intake flow.";
const INTAKE_SLOT_OPTION_COUNT = 3;
const INTAKE_SLOT_LOOKAHEAD_DAYS = 10;
const INTAKE_SLOT_HOLD_MINUTES = 10;

type Tx = Prisma.TransactionClient;

export const intakeAutomationDefaults = {
  intro: DEFAULT_INTRO,
  askLocation: DEFAULT_ASK_LOCATION,
  askWorkType: DEFAULT_ASK_WORK_TYPE,
  askCallback: DEFAULT_ASK_CALLBACK,
  completion: DEFAULT_COMPLETION,
} as const;

export const intakeCallbackEventTitle = CALLBACK_EVENT_TITLE;
export { parsePreferredCallbackAt } from "./intake-time";

function buildIntakeCallbackLockKey(leadId: string): string {
  return `intake-callback:${leadId}`;
}

async function lockIntakeCallbackMutation(
  tx: Tx,
  input: {
    orgId: string;
    leadId: string;
  },
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.orgId}), hashtext(${buildIntakeCallbackLockKey(input.leadId)}))
  `;
}

function renderCompletionTemplate(
  template: string,
  callbackAt: Date,
  locale: "EN" | "ES",
  timeZone?: string,
): string {
  const formatted = formatCallbackTime(callbackAt, locale, timeZone);
  return template
    .replaceAll("{{time}}", formatted)
    .replaceAll("{{datetime}}", formatted);
}

async function sendAutomationMessage({
  organization,
  leadId,
  toNumberE164,
  body,
}: {
  organization: IntakeOrganizationSettings;
  leadId: string;
  toNumberE164: string;
  body: string;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      status: true,
      customerId: true,
      conversationState: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!lead || lead.status === "DNC") {
    return;
  }

  const smsResult = await sendOutboundSms({
    orgId: organization.id,
    fromNumberE164: organization.smsFromNumberE164,
    toNumberE164,
    body,
  });
  if (smsResult.suppressed) {
    return;
  }
  const resolvedFromNumber = smsResult.resolvedFromNumberE164 || organization.smsFromNumberE164;
  if (!resolvedFromNumber) {
    return;
  }
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        orgId: organization.id,
        leadId,
        direction: "OUTBOUND",
        type: "AUTOMATION",
        fromNumberE164: resolvedFromNumber,
        toNumberE164,
        body,
        provider: "TWILIO",
        providerMessageSid: smsResult.providerMessageSid,
        status: smsResult.status,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    await recordOutboundSmsCommunicationEvent(tx, {
      orgId: organization.id,
      leadId,
      contactId: lead.customerId,
      conversationId: lead.conversationState?.id || null,
      messageId: message.id,
      body,
      fromNumberE164: resolvedFromNumber,
      toNumberE164,
      providerMessageSid: smsResult.providerMessageSid,
      status: smsResult.status,
      deliveryNotice: smsResult.notice || null,
      occurredAt: message.createdAt,
    });

    await tx.lead.update({
      where: { id: leadId },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
      },
    });
  });
}

async function ensureIntakeCallbackEventTx(
  tx: Tx,
  input: {
    orgId: string;
    leadId: string;
    callbackAt: Date;
    assignedToUserId?: string | null;
  },
): Promise<boolean> {
  const existing = await tx.event.findFirst({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      type: "FOLLOW_UP",
      title: CALLBACK_EVENT_TITLE,
    },
    select: { id: true },
  });

  if (existing) {
    return false;
  }

  await tx.event.create({
    data: {
      orgId: input.orgId,
      leadId: input.leadId,
      type: "FOLLOW_UP",
      title: CALLBACK_EVENT_TITLE,
      description: CALLBACK_EVENT_DESCRIPTION,
      startAt: input.callbackAt,
      assignedToUserId: input.assignedToUserId || null,
      workerAssignments: input.assignedToUserId
        ? {
            create: [{ orgId: input.orgId, workerUserId: input.assignedToUserId }],
          }
        : undefined,
    },
  });

  return true;
}

export async function ensureIntakeCallbackEvent({
  orgId,
  leadId,
  callbackAt,
  assignedToUserId,
}: {
  orgId: string;
  leadId: string;
  callbackAt: Date;
  assignedToUserId?: string | null;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockIntakeCallbackMutation(tx, {
      orgId,
      leadId,
    });

    return ensureIntakeCallbackEventTx(tx, {
      orgId,
      leadId,
      callbackAt,
      assignedToUserId,
    });
  });
}

function parseCallbackOptionSelection(text: string): number | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  if (/^[1-3]$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }

  const keywordMatch = normalized.match(/\b(?:option|opcion|choose|elige)\s*([1-3])\b/i);
  if (keywordMatch?.[1]) {
    return Number.parseInt(keywordMatch[1], 10);
  }

  return null;
}

function callbackOptionInstruction(locale: "EN" | "ES"): string {
  return locale === "ES"
    ? "Responde con 1, 2 o 3 para elegir horario."
    : "Reply with 1, 2, or 3 to choose a time.";
}

function callbackNoSlotsMessage(locale: "EN" | "ES"): string {
  return locale === "ES"
    ? "No vemos horarios disponibles ahora mismo. Te enviaremos nuevas opciones en breve."
    : "No open slots are available right now. We will send fresh options shortly.";
}

function callbackInvalidChoicePrefix(locale: "EN" | "ES"): string {
  return locale === "ES"
    ? "No pude validar esa opción."
    : "I couldn't match that option.";
}

async function getIntakeWorkerCandidates(orgId: string) {
  const workers = await listWorkspaceUsers({
    organizationId: orgId,
    excludeReadOnly: true,
  });

  return sortWorkspaceUsersByCalendarRoleThenLabel(workers).slice(0, 50);
}

async function createIntakeCallbackOptionHolds(input: {
  orgId: string;
  leadId: string;
  durationMinutes: number;
  lookaheadDays: number;
  calendarTimeZone: string;
}): Promise<
  Array<{
    id: string;
    startAt: Date;
    endAt: Date;
    workerUserId: string;
  }>
> {
  const now = new Date();
  await prisma.calendarHold.updateMany({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      source: "SMS_AGENT",
      status: "ACTIVE",
    },
    data: {
      status: "EXPIRED",
      expiresAt: now,
    },
  });

  const workers = await getIntakeWorkerCandidates(input.orgId);
  if (workers.length === 0) {
    return [];
  }

  const slotCandidates: Array<{ workerUserId: string; startAt: Date; endAt: Date }> = [];
  const seenSlots = new Set<string>();
  const nowMs = now.getTime();

  for (let dayOffset = 0; dayOffset < input.lookaheadDays; dayOffset += 1) {
    const dateKey = formatInTimeZone(addDays(now, dayOffset), input.calendarTimeZone, "yyyy-MM-dd");
    for (const worker of workers) {
      if (slotCandidates.length >= INTAKE_SLOT_OPTION_COUNT) {
        break;
      }

      const availability = await computeAvailabilityForWorker({
        orgId: input.orgId,
        workerUserId: worker.id,
        date: dateKey,
        durationMinutes: input.durationMinutes,
        stepMinutes: 30,
      });

      const nextSlot = availability.slotsUtc.find((slotUtc) => {
        const slotMs = new Date(slotUtc).getTime();
        if (!Number.isFinite(slotMs) || slotMs < nowMs) {
          return false;
        }
        if (seenSlots.has(slotUtc)) {
          return false;
        }
        return true;
      });

      if (!nextSlot) {
        continue;
      }

      seenSlots.add(nextSlot);
      const startAt = new Date(nextSlot);
      slotCandidates.push({
        workerUserId: worker.id,
        startAt,
        endAt: addMinutes(startAt, input.durationMinutes),
      });
    }

    if (slotCandidates.length >= INTAKE_SLOT_OPTION_COUNT) {
      break;
    }
  }

  if (slotCandidates.length === 0) {
    return [];
  }

  const expiresAt = new Date(now.getTime() + INTAKE_SLOT_HOLD_MINUTES * 60 * 1000);
  const createdHolds: Array<{ id: string; startAt: Date; endAt: Date; workerUserId: string }> = [];

  for (const candidate of slotCandidates.slice(0, INTAKE_SLOT_OPTION_COUNT)) {
    const hold = await prisma.calendarHold.create({
      data: {
        orgId: input.orgId,
        leadId: input.leadId,
        workerUserId: candidate.workerUserId,
        title: CALLBACK_EVENT_TITLE,
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
    createdHolds.push(hold);
  }

  return createdHolds;
}

async function sendCallbackOptionsMessage(input: {
  organization: IntakeOrganizationSettings;
  leadId: string;
  toNumberE164: string;
  locale: "EN" | "ES";
  invalidChoice?: boolean;
}): Promise<boolean> {
  const settings = await getOrgCalendarSettings(input.organization.id);
  const durationMinutes = Math.max(30, settings.defaultSlotMinutes);
  const holds = await createIntakeCallbackOptionHolds({
    orgId: input.organization.id,
    leadId: input.leadId,
    durationMinutes,
    lookaheadDays: INTAKE_SLOT_LOOKAHEAD_DAYS,
    calendarTimeZone: settings.calendarTimezone,
  });

  const callbackPrompt = pickLocalizedTemplate({
    locale: input.locale,
    englishTemplate: input.organization.intakeAskCallbackBodyEn,
    spanishTemplate: input.organization.intakeAskCallbackBodyEs,
    legacyTemplate: input.organization.intakeAskCallbackBody,
    fallbackTemplate: DEFAULT_ASK_CALLBACK,
  });

  if (holds.length === 0) {
    await sendAutomationMessage({
      organization: input.organization,
      leadId: input.leadId,
      toNumberE164: input.toNumberE164,
      body: `${callbackPrompt}\n\n${callbackNoSlotsMessage(input.locale)}`,
    });
    return false;
  }

  const optionsList = holds
    .map(
      (hold, index) =>
        `${index + 1}) ${formatCallbackTime(hold.startAt, input.locale, settings.calendarTimezone)}`,
    )
    .join("\n");

  const prefix = input.invalidChoice ? `${callbackInvalidChoicePrefix(input.locale)}\n\n` : "";
  const body = `${prefix}${callbackPrompt}\n\n${optionsList}\n\n${callbackOptionInstruction(input.locale)}`;

  await sendAutomationMessage({
    organization: input.organization,
    leadId: input.leadId,
    toNumberE164: input.toNumberE164,
    body,
  });

  return true;
}

export async function sendMissedCallIntroAndStartFlow({
  organization,
  leadId,
  toNumberE164,
}: {
  organization: IntakeOrganizationSettings;
  leadId: string;
  toNumberE164: string;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      preferredLanguage: true,
      status: true,
    },
  });

  if (!lead || lead.status === "DNC") {
    return;
  }

  const locale = resolveMessageLocale({
    organizationLanguage: organization.messageLanguage,
    leadPreferredLanguage: lead?.preferredLanguage,
  });

  const introBody = pickLocalizedTemplate({
    locale,
    englishTemplate: organization.missedCallAutoReplyBodyEn,
    spanishTemplate: organization.missedCallAutoReplyBodyEs,
    legacyTemplate: organization.missedCallAutoReplyBody,
    fallbackTemplate: DEFAULT_INTRO,
  });
  const askLocationBody = pickLocalizedTemplate({
    locale,
    englishTemplate: organization.intakeAskLocationBodyEn,
    spanishTemplate: organization.intakeAskLocationBodyEs,
    legacyTemplate: organization.intakeAskLocationBody,
    fallbackTemplate: DEFAULT_ASK_LOCATION,
  });

  const openingBody = ensureSmsA2POpenerDisclosure(
    organization.intakeAutomationEnabled ? `${introBody}\n\n${askLocationBody}` : introBody,
    locale === "ES" ? "BILINGUAL" : "EN",
  );

  await sendAutomationMessage({
    organization,
    leadId,
    toNumberE164,
    body: openingBody,
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      intakeStage: organization.intakeAutomationEnabled ? "WAITING_LOCATION" : "INTRO_SENT",
    },
  });
}

export async function queueMissedCallIntroForQuietHours({
  organization,
  leadId,
  toNumberE164,
  sendAfterAt,
}: {
  organization: IntakeOrganizationSettings;
  leadId: string;
  toNumberE164: string;
  sendAfterAt: Date;
}) {
  if (!organization.smsFromNumberE164) {
    return { queued: false as const };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      preferredLanguage: true,
      status: true,
    },
  });

  if (!lead || lead.status === "DNC") {
    return { queued: false as const };
  }

  const locale = resolveMessageLocale({
    organizationLanguage: organization.messageLanguage,
    leadPreferredLanguage: lead.preferredLanguage,
  });

  const introBody = pickLocalizedTemplate({
    locale,
    englishTemplate: organization.missedCallAutoReplyBodyEn,
    spanishTemplate: organization.missedCallAutoReplyBodyEs,
    legacyTemplate: organization.missedCallAutoReplyBody,
    fallbackTemplate: DEFAULT_INTRO,
  });
  const askLocationBody = pickLocalizedTemplate({
    locale,
    englishTemplate: organization.intakeAskLocationBodyEn,
    spanishTemplate: organization.intakeAskLocationBodyEs,
    legacyTemplate: organization.intakeAskLocationBody,
    fallbackTemplate: DEFAULT_ASK_LOCATION,
  });

  const openingBody = ensureSmsA2POpenerDisclosure(
    organization.intakeAutomationEnabled ? `${introBody}\n\n${askLocationBody}` : introBody,
    locale === "ES" ? "BILINGUAL" : "EN",
  );

  const queued = await queueSmsDispatch({
    orgId: organization.id,
    leadId,
    kind: "MISSED_CALL_INTRO",
    messageType: "AUTOMATION",
    fromNumberE164: organization.smsFromNumberE164 || toNumberE164,
    toNumberE164,
    body: openingBody,
    sendAfterAt,
  });

  return { queued: true as const, queueId: queued.id, created: queued.created };
}

export async function advanceLeadIntakeFromInbound({
  organization,
  leadId,
  inboundBody,
}: {
  organization: IntakeOrganizationSettings;
  leadId: string;
  inboundBody: string;
}) {
  if (!organization.intakeAutomationEnabled) {
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      orgId: true,
      phoneE164: true,
      intakeStage: true,
      preferredLanguage: true,
    },
  });

  if (!lead) {
    return;
  }

  const messageBody = inboundBody.trim();
  if (!messageBody) {
    return;
  }

  if (lead.intakeStage === "COMPLETED") {
    return;
  }

  const locale = resolveMessageLocale({
    organizationLanguage: organization.messageLanguage,
    leadPreferredLanguage: lead.preferredLanguage,
  });

  if (lead.intakeStage === "NONE" || lead.intakeStage === "INTRO_SENT") {
    await sendAutomationMessage({
      organization,
      leadId: lead.id,
      toNumberE164: lead.phoneE164,
      body: pickLocalizedTemplate({
        locale,
        englishTemplate: organization.intakeAskLocationBodyEn,
        spanishTemplate: organization.intakeAskLocationBodyEs,
        legacyTemplate: organization.intakeAskLocationBody,
        fallbackTemplate: DEFAULT_ASK_LOCATION,
      }),
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        intakeStage: "WAITING_LOCATION",
      },
    });
    return;
  }

  if (lead.intakeStage === "WAITING_LOCATION") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        city: messageBody,
        intakeLocationText: messageBody,
        intakeStage: "WAITING_WORK_TYPE",
      },
    });

    await sendAutomationMessage({
      organization,
      leadId: lead.id,
      toNumberE164: lead.phoneE164,
      body: pickLocalizedTemplate({
        locale,
        englishTemplate: organization.intakeAskWorkTypeBodyEn,
        spanishTemplate: organization.intakeAskWorkTypeBodyEs,
        legacyTemplate: organization.intakeAskWorkTypeBody,
        fallbackTemplate: DEFAULT_ASK_WORK_TYPE,
      }),
    });
    return;
  }

  if (lead.intakeStage === "WAITING_WORK_TYPE") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        businessType: messageBody,
        intakeWorkTypeText: messageBody,
        intakeStage: "WAITING_CALLBACK",
      },
    });

    await sendCallbackOptionsMessage({
      organization,
      leadId: lead.id,
      toNumberE164: lead.phoneE164,
      locale,
    });
    return;
  }

  if (lead.intakeStage === "WAITING_CALLBACK") {
    const selection = parseCallbackOptionSelection(messageBody);
    if (!selection) {
      await sendCallbackOptionsMessage({
        organization,
        leadId: lead.id,
        toNumberE164: lead.phoneE164,
        locale,
        invalidChoice: true,
      });
      return;
    }

    const confirmation = await prisma.$transaction(async (tx) => {
      await lockIntakeCallbackMutation(tx, {
        orgId: lead.orgId,
        leadId: lead.id,
      });

      const liveLead = await tx.lead.findUnique({
        where: { id: lead.id },
        select: {
          id: true,
          orgId: true,
          intakeStage: true,
        },
      });

      if (!liveLead) {
        return {
          status: "noop" as const,
        };
      }

      const now = new Date();
      const activeHolds = await tx.calendarHold.findMany({
        where: {
          orgId: liveLead.orgId,
          leadId: liveLead.id,
          source: "SMS_AGENT",
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          startAt: true,
          workerUserId: true,
        },
        take: INTAKE_SLOT_OPTION_COUNT,
      });

      const resolvedSelection = resolveIntakeCallbackSelection({
        intakeStage: liveLead.intakeStage,
        selection,
        holds: activeHolds,
      });

      if (resolvedSelection.status !== "confirmed") {
        return resolvedSelection;
      }

      const callbackAt = resolvedSelection.hold.startAt;

      await tx.lead.update({
        where: { id: liveLead.id },
        data: {
          nextFollowUpAt: callbackAt,
          intakePreferredCallbackAt: callbackAt,
          intakeStage: "COMPLETED",
        },
      });

      await ensureIntakeCallbackEventTx(tx, {
        orgId: liveLead.orgId,
        leadId: liveLead.id,
        callbackAt,
        assignedToUserId: resolvedSelection.hold.workerUserId,
      });

      await tx.calendarHold.updateMany({
        where: {
          orgId: liveLead.orgId,
          leadId: liveLead.id,
          source: "SMS_AGENT",
          status: "ACTIVE",
        },
        data: {
          status: "CANCELLED",
        },
      });
      await tx.calendarHold.update({
        where: { id: resolvedSelection.hold.id },
        data: { status: "CONFIRMED" },
      });

      return {
        status: "confirmed" as const,
        callbackAt,
      };
    });

    if (confirmation.status === "noop") {
      return;
    }

    if (confirmation.status !== "confirmed") {
      await sendCallbackOptionsMessage({
        organization,
        leadId: lead.id,
        toNumberE164: lead.phoneE164,
        locale,
        invalidChoice: true,
      });
      return;
    }

    const completionTemplate = pickLocalizedTemplate({
      locale,
      englishTemplate: organization.intakeCompletionBodyEn,
      spanishTemplate: organization.intakeCompletionBodyEs,
      legacyTemplate: organization.intakeCompletionBody,
      fallbackTemplate: DEFAULT_COMPLETION,
    });
    const settings = await getOrgCalendarSettings(lead.orgId);
    const completionBody = renderCompletionTemplate(
      completionTemplate,
      confirmation.callbackAt,
      locale,
      settings.calendarTimezone,
    );

    await sendAutomationMessage({
      organization,
      leadId: lead.id,
      toNumberE164: lead.phoneE164,
      body: completionBody,
    });
  }
}
