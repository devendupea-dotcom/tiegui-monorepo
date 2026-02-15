import { prisma } from "./prisma";
import { pickLocalizedTemplate, resolveMessageLocale } from "./message-language";
import { sendOutboundSms } from "./sms";

export type IntakeOrganizationSettings = {
  id: string;
  smsFromNumberE164: string | null;
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
const DEFAULT_ASK_CALLBACK = "What day/time works best for a callback or estimate?";
const DEFAULT_COMPLETION =
  "Perfect, you're set for {{time}}. We'll follow up then.";
const CALLBACK_EVENT_TITLE = "SMS Callback Scheduled";
const CALLBACK_EVENT_DESCRIPTION = "Auto-scheduled from SMS intake flow.";

export const intakeAutomationDefaults = {
  intro: DEFAULT_INTRO,
  askLocation: DEFAULT_ASK_LOCATION,
  askWorkType: DEFAULT_ASK_WORK_TYPE,
  askCallback: DEFAULT_ASK_CALLBACK,
  completion: DEFAULT_COMPLETION,
} as const;

export const intakeCallbackEventTitle = CALLBACK_EVENT_TITLE;

type TimeParts = {
  hour: number;
  minute: number;
};

function formatCallbackTime(value: Date, locale: "EN" | "ES"): string {
  return new Intl.DateTimeFormat(locale === "ES" ? "es-US" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function renderCompletionTemplate(
  template: string,
  callbackAt: Date,
  locale: "EN" | "ES",
): string {
  const formatted = formatCallbackTime(callbackAt, locale);
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
  if (!organization.smsFromNumberE164) {
    return;
  }

  const smsResult = await sendOutboundSms({
    orgId: organization.id,
    fromNumberE164: organization.smsFromNumberE164,
    toNumberE164,
    body,
  });
  const now = new Date();

  await prisma.$transaction([
    prisma.message.create({
      data: {
        orgId: organization.id,
        leadId,
        direction: "OUTBOUND",
        type: "AUTOMATION",
        fromNumberE164: organization.smsFromNumberE164,
        toNumberE164,
        body,
        provider: "TWILIO",
        providerMessageSid: smsResult.providerMessageSid,
        status: smsResult.status,
      },
    }),
    prisma.lead.update({
      where: { id: leadId },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
      },
    }),
  ]);
}

function parseTimeParts(text: string): TimeParts {
  const match = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) {
    return { hour: 9, minute: 0 };
  }

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return { hour: 9, minute: 0 };
  }

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  if (!meridiem && hour >= 1 && hour <= 7) {
    hour += 12;
  }

  if (hour < 0 || hour > 23) {
    return { hour: 9, minute: 0 };
  }

  return { hour, minute };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function withTime(baseDate: Date, timeParts: TimeParts): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    timeParts.hour,
    timeParts.minute,
    0,
    0,
  );
}

function parseWeekdayBase(text: string, now: Date): Date | null {
  const weekMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  for (const [name, weekday] of Object.entries(weekMap)) {
    if (text.includes(name)) {
      const todayWeekday = now.getDay();
      let delta = (weekday - todayWeekday + 7) % 7;
      if (delta === 0) {
        delta = 7;
      }
      const result = startOfDay(now);
      result.setDate(result.getDate() + delta);
      return result;
    }
  }

  return null;
}

export function parsePreferredCallbackAt(text: string, now = new Date()): Date | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const timeParts = parseTimeParts(normalized);
  let baseDate: Date | null = null;

  const isoMatch = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    baseDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  if (!baseDate) {
    const usMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (usMatch) {
      const month = Number(usMatch[1]);
      const day = Number(usMatch[2]);
      let year = usMatch[3] ? Number(usMatch[3]) : now.getFullYear();
      if (year < 100) {
        year += 2000;
      }
      baseDate = new Date(year, month - 1, day);
      if (!usMatch[3] && baseDate < startOfDay(now)) {
        baseDate = new Date(year + 1, month - 1, day);
      }
    }
  }

  if (!baseDate) {
    if (normalized.includes("tomorrow")) {
      baseDate = startOfDay(now);
      baseDate.setDate(baseDate.getDate() + 1);
    } else if (normalized.includes("today")) {
      baseDate = startOfDay(now);
    } else {
      baseDate = parseWeekdayBase(normalized, now);
    }
  }

  if (!baseDate || Number.isNaN(baseDate.getTime())) {
    return null;
  }

  let result = withTime(baseDate, timeParts);
  if (result <= now) {
    if (normalized.includes("today")) {
      result = withTime(new Date(startOfDay(now).getTime() + 24 * 60 * 60 * 1000), timeParts);
    } else if (!normalized.includes("/") && !normalized.includes("-")) {
      result = withTime(new Date(startOfDay(baseDate).getTime() + 7 * 24 * 60 * 60 * 1000), timeParts);
    }
  }

  if (result <= now) {
    return null;
  }

  return result;
}

export async function ensureIntakeCallbackEvent({
  orgId,
  leadId,
  callbackAt,
}: {
  orgId: string;
  leadId: string;
  callbackAt: Date;
}): Promise<boolean> {
  const existing = await prisma.event.findFirst({
    where: {
      orgId,
      leadId,
      type: "FOLLOW_UP",
      title: CALLBACK_EVENT_TITLE,
    },
    select: { id: true },
  });

  if (existing) {
    return false;
  }

  await prisma.event.create({
    data: {
      orgId,
      leadId,
      type: "FOLLOW_UP",
      title: CALLBACK_EVENT_TITLE,
      description: CALLBACK_EVENT_DESCRIPTION,
      startAt: callbackAt,
    },
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
    },
  });

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

  const openingBody = organization.intakeAutomationEnabled
    ? `${introBody}\n\n${askLocationBody}`
    : introBody;

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

export async function advanceLeadIntakeFromInbound({
  organization,
  leadId,
  inboundBody,
}: {
  organization: IntakeOrganizationSettings;
  leadId: string;
  inboundBody: string;
}) {
  if (!organization.intakeAutomationEnabled || !organization.smsFromNumberE164) {
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

    await sendAutomationMessage({
      organization,
      leadId: lead.id,
      toNumberE164: lead.phoneE164,
      body: pickLocalizedTemplate({
        locale,
        englishTemplate: organization.intakeAskCallbackBodyEn,
        spanishTemplate: organization.intakeAskCallbackBodyEs,
        legacyTemplate: organization.intakeAskCallbackBody,
        fallbackTemplate: DEFAULT_ASK_CALLBACK,
      }),
    });
    return;
  }

  if (lead.intakeStage === "WAITING_CALLBACK") {
    const callbackAt = parsePreferredCallbackAt(messageBody);
    if (!callbackAt) {
      const callbackPrompt = pickLocalizedTemplate({
        locale,
        englishTemplate: organization.intakeAskCallbackBodyEn,
        spanishTemplate: organization.intakeAskCallbackBodyEs,
        legacyTemplate: organization.intakeAskCallbackBody,
        fallbackTemplate: DEFAULT_ASK_CALLBACK,
      });
      const retrySuffix =
        locale === "ES" ? ' Ejemplo: "mañana a las 3pm".' : ' Example: "tomorrow at 3pm".';
      const retryBody = `${callbackPrompt}${retrySuffix}`;
      await sendAutomationMessage({
        organization,
        leadId: lead.id,
        toNumberE164: lead.phoneE164,
        body: retryBody,
      });
      return;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        nextFollowUpAt: callbackAt,
        intakePreferredCallbackAt: callbackAt,
        intakeStage: "COMPLETED",
      },
    });

    await ensureIntakeCallbackEvent({
      orgId: lead.orgId,
      leadId: lead.id,
      callbackAt,
    });

    const completionTemplate = pickLocalizedTemplate({
      locale,
      englishTemplate: organization.intakeCompletionBodyEn,
      spanishTemplate: organization.intakeCompletionBodyEs,
      legacyTemplate: organization.intakeCompletionBody,
      fallbackTemplate: DEFAULT_COMPLETION,
    });
    const completionBody = renderCompletionTemplate(completionTemplate, callbackAt, locale);

    await sendAutomationMessage({
      organization,
      leadId: lead.id,
      toNumberE164: lead.phoneE164,
      body: completionBody,
    });
  }
}
