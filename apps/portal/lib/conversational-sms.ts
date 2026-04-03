import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Prisma } from "@prisma/client";
import type { ConversationStage, ConversationTimeframe, LeadIntakeStage, MessageStatus } from "@prisma/client";
import { recordOutboundSmsCommunicationEvent } from "@/lib/communication-events";
import { buildMissedCallOpeningMessages } from "@/lib/missed-call-opening";
import { prisma } from "@/lib/prisma";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";
import { containsLikelyWorkSummaryText } from "@/lib/lead-display";
import { normalizeLeadCity } from "@/lib/lead-location";
import { resolveMessageLocale } from "@/lib/message-language";
import {
  ACTIVE_CONVERSATION_FOLLOW_UP_STAGES,
  shouldSkipQueuedFollowUp,
  shouldSuppressMissedCallKickoff,
} from "@/lib/sms-automation-guards";
import { ensureSmsOptOutHint } from "@/lib/sms-compliance";
import { sendOutboundSms } from "@/lib/sms";
import { queueSmsDispatch } from "@/lib/sms-dispatch-queue";
import {
  getSmsToneTemplates,
  normalizeCustomTemplates,
  renderSmsTemplate,
  resolveTemplate,
  type SmsToneCustomTemplates,
} from "@/lib/conversational-sms-templates";
import { isWithinSmsSendWindow, nextSmsSendWindowStartUtc } from "@/lib/sms-quiet-hours";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

const TAKEOVER_PATTERN =
  /\b(call me|can you call|talk to someone|i have questions|phone call|call back|ll[aá]mame|pueden llamar|quiero hablar)\b/i;

const ADDRESS_PATTERN =
  /\b\d{1,6}\s+[a-z0-9.\-'\s]{2,}\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|boulevard|ct|court|pl|place|pkwy|parkway)\b/i;
const CROSS_STREET_PATTERN = /\b[a-z]+(?:\s+[a-z]+)?\s+(?:and|&|y)\s+[a-z]+(?:\s+[a-z]+)?\b/i;
const ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/;
const CITY_PATTERN = /^[a-zA-ZÀ-ÿ.\-\s]{2,60}$/;
const AMBIGUOUS_TIME_PATTERN =
  /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|noon|afternoon|morning|\d{1,2}(?::\d{2})?\s?(am|pm)?)\b/i;
const COMMON_WORK_LOCATION_COLLISION_TERMS = new Set([
  "cleanup",
  "concrete",
  "deck",
  "driveway",
  "fence",
  "flooring",
  "gutter",
  "gutters",
  "hardscape",
  "irrigation",
  "landscape",
  "landscaping",
  "lawn",
  "mowing",
  "mulch",
  "paint",
  "painting",
  "patio",
  "paver",
  "paving",
  "roof",
  "roofing",
  "siding",
  "sod",
  "sprinkler",
  "sprinklers",
  "stump",
  "tree",
  "trees",
  "wall",
  "windows",
]);

const OFFERED_SLOT_COUNT = 3;
const OFFERED_SLOT_LOOKAHEAD_DAYS = 10;
const OFFER_HOLD_MINUTES = 10;
const TAKEOVER_PAUSE_HOURS = 24;
const HUMANIZED_REPLY_DELAY_MINUTES = 2;
const MAX_HUMANIZED_REPLY_DELAY_MINUTES = 3;
const MISSED_CALL_FOLLOW_UP_DELAY_MINUTES = 2;
const FOLLOW_UP_CLAIM_HOLD_MINUTES = 5;

type ConversationOrgConfig = {
  id: string;
  name: string;
  messageLanguage: "EN" | "ES" | "AUTO";
  smsTone: "FRIENDLY" | "PROFESSIONAL" | "DIRECT" | "SALES" | "PREMIUM" | "BILINGUAL" | "CUSTOM";
  autoReplyEnabled: boolean;
  followUpsEnabled: boolean;
  autoBookingEnabled: boolean;
  smsFromNumberE164: string | null;
  smsQuietHoursStartMinute: number;
  smsQuietHoursEndMinute: number;
  slotDurationMinutes: number;
  bufferMinutes: number;
  daysAhead: number;
  messagingTimezone: string;
  customTemplates: SmsToneCustomTemplates;
  smsGreetingLine: string | null;
  smsWorkingHoursText: string | null;
  smsWebsiteSignature: string | null;
  missedCallAutoReplyBody: string | null;
  missedCallAutoReplyBodyEn: string | null;
  missedCallAutoReplyBodyEs: string | null;
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
  dashboardConfig: {
    calendarTimezone: string;
    defaultSlotMinutes: number;
  } | null;
};

type ConversationLead = {
  id: string;
  orgId: string;
  customerId: string | null;
  phoneE164: string;
  status: "NEW" | "CALLED_NO_ANSWER" | "VOICEMAIL" | "INTERESTED" | "FOLLOW_UP" | "BOOKED" | "NOT_INTERESTED" | "DNC";
  preferredLanguage: "EN" | "ES" | null;
  businessName: string | null;
  contactName: string | null;
  nextFollowUpAt: Date | null;
};

type SlotOption = {
  id: "A" | "B" | "C";
  holdId: string;
  startAtIso: string;
  endAtIso: string;
  workerUserId: string;
  label: string;
  matchText: string;
};

type TemplateBundle = {
  locale: "EN" | "ES";
  initial: string;
  askAddress: string;
  askCity: string;
  askTimeframe: string;
  offerBooking: string;
  followUp1: string;
  followUp2: string;
  followUp3: string;
  bookingConfirmation: string;
  clarification: string;
  optOutConfirmation: string;
  humanAck: string;
};

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

function normalizeInboundKeyword(body: string): string {
  return body.trim().toUpperCase().split(/\s+/)[0] || "";
}

function hasStopKeyword(body: string): boolean {
  return STOP_KEYWORDS.has(normalizeInboundKeyword(body));
}

function hasStartKeyword(body: string): boolean {
  return START_KEYWORDS.has(normalizeInboundKeyword(body));
}

function mapStageToLeadIntake(stage: ConversationStage): LeadIntakeStage {
  switch (stage) {
    case "NEW":
      return "NONE";
    case "ASKED_WORK":
      return "INTRO_SENT";
    case "ASKED_ADDRESS":
      return "WAITING_LOCATION";
    case "ASKED_TIMEFRAME":
      return "WAITING_WORK_TYPE";
    case "OFFERED_BOOKING":
      return "WAITING_CALLBACK";
    case "BOOKED":
    case "HUMAN_TAKEOVER":
    case "CLOSED":
      return "COMPLETED";
    default:
      return "NONE";
  }
}

function getFollowUpCadenceMinutes(stage: ConversationStage): number[] {
  switch (stage) {
    case "ASKED_WORK":
    case "ASKED_ADDRESS":
      return [10, 24 * 60, 72 * 60];
    case "ASKED_TIMEFRAME":
      return [15, 24 * 60];
    case "OFFERED_BOOKING":
      return [30, 48 * 60];
    default:
      return [];
  }
}

function formatMissingField(stage: ConversationStage, locale: "EN" | "ES"): string {
  if (locale === "ES") {
    if (stage === "ASKED_WORK") return "el tipo de trabajo";
    if (stage === "ASKED_ADDRESS") return "la dirección";
    if (stage === "ASKED_TIMEFRAME") return "el plazo";
    if (stage === "OFFERED_BOOKING") return "la opción (A/B/C)";
    return "los datos";
  }

  if (stage === "ASKED_WORK") return "the work needed";
  if (stage === "ASKED_ADDRESS") return "the property address";
  if (stage === "ASKED_TIMEFRAME") return "your timeframe";
  if (stage === "OFFERED_BOOKING") return "the booking option (A/B/C)";
  return "the missing details";
}

function sanitizeMessageBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

function withSignature(input: { body: string; websiteSignature: string | null }): string {
  const body = sanitizeMessageBody(input.body);
  if (!input.websiteSignature) return body;
  const signature = sanitizeMessageBody(input.websiteSignature);
  if (!signature) return body;
  return `${body}\n\n${signature}`;
}

function parseTimeframe(value: string): ConversationTimeframe | null {
  const normalized = value.toLowerCase();
  if (/\b(asap|urgent|today|now|right away|de inmediato|urgente|hoy|ahora)\b/.test(normalized)) return "ASAP";
  if (/\b(this week|soon|few days|esta semana|pronto|estos dias|estos días)\b/.test(normalized)) return "THIS_WEEK";
  if (/\b(next week|weekend|la próxima semana|proxima semana|fin de semana)\b/.test(normalized)) return "NEXT_WEEK";
  if (/\b(quote|estimate|just looking|cotizaci[oó]n|presupuesto|solo cotizar)\b/.test(normalized)) return "QUOTE_ONLY";
  return null;
}

function parseAddress(value: string): { kind: "ADDRESS" | "CITY" | "UNKNOWN"; addressText?: string; city?: string } {
  const trimmed = sanitizeMessageBody(value);
  if (!trimmed) return { kind: "UNKNOWN" };
  const lower = trimmed.toLowerCase();

  if (ADDRESS_PATTERN.test(lower) || CROSS_STREET_PATTERN.test(lower) || ZIP_PATTERN.test(lower)) {
    return { kind: "ADDRESS", addressText: trimmed };
  }

  const words = trimmed.split(/\s+/);
  const normalizedCity = normalizeLeadCity(trimmed);
  if (
    !/\d/.test(trimmed) &&
    normalizedCity &&
    !containsLikelyWorkSummaryText(normalizedCity) &&
    normalizedCity.split(/\s+/).length <= 5 &&
    CITY_PATTERN.test(normalizedCity)
  ) {
    return { kind: "CITY", city: normalizedCity };
  }

  if (/\d/.test(trimmed) && words.length >= 3) {
    return { kind: "ADDRESS", addressText: trimmed };
  }

  return { kind: "UNKNOWN" };
}

function looksLikeWorkSummary(value: string): boolean {
  const normalized = sanitizeMessageBody(value);
  if (!normalized) return false;
  if (hasStopKeyword(normalized) || hasStartKeyword(normalized)) return false;
  if (TAKEOVER_PATTERN.test(normalized)) return false;
  if (parseTimeframe(normalized)) return false;
  return /[a-zA-ZÀ-ÿ]/.test(normalized);
}

function looksLikeLocationPhrase(value: string): boolean {
  const normalized = sanitizeMessageBody(value);
  if (!normalized) return false;
  const words = normalized
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.some((word) => COMMON_WORK_LOCATION_COLLISION_TERMS.has(word))) {
    return false;
  }
  if (containsLikelyWorkSummaryText(normalized)) {
    return false;
  }
  const parsed = parseAddress(normalized);
  return parsed.kind === "CITY" || parsed.kind === "ADDRESS";
}

function parseWorkAndLocation(value: string): {
  workSummary: string;
  addressText: string | null;
  addressCity: string | null;
} | null {
  const trimmed = sanitizeMessageBody(value);
  if (!trimmed) return null;

  const explicitSplit = trimmed.match(/^(.*?)(?:\s+|,\s*)(?:in|at|near|around)\s+(.+)$/i);
  if (explicitSplit) {
    const workSummary = sanitizeMessageBody(explicitSplit[1] || "");
    const locationSummary = sanitizeMessageBody(explicitSplit[2] || "");
    const parsedLocation = parseAddress(locationSummary);
    if (
      looksLikeWorkSummary(workSummary) &&
      (parsedLocation.kind === "ADDRESS" || parsedLocation.kind === "CITY")
    ) {
      return {
        workSummary,
        addressText: parsedLocation.kind === "ADDRESS" ? parsedLocation.addressText || locationSummary : null,
        addressCity: parsedLocation.kind === "CITY" ? parsedLocation.city || locationSummary : null,
      };
    }
  }

  const words = trimmed.split(/\s+/);
  if (words.length < 3 || /\d/.test(trimmed)) {
    const parsedWhole = parseAddress(trimmed);
    if (parsedWhole.kind === "ADDRESS" || parsedWhole.kind === "CITY") {
      return null;
    }
    return null;
  }

  for (let cityWordCount = Math.min(2, words.length - 1); cityWordCount >= 1; cityWordCount -= 1) {
    const workCandidate = sanitizeMessageBody(words.slice(0, -cityWordCount).join(" "));
    const cityCandidate = sanitizeMessageBody(words.slice(-cityWordCount).join(" "));
    if (!looksLikeWorkSummary(workCandidate)) {
      continue;
    }
    if (looksLikeLocationPhrase(cityCandidate)) {
      return {
        workSummary: workCandidate,
        addressText: null,
        addressCity: cityCandidate,
      };
    }
  }

  const parsedWhole = parseAddress(trimmed);
  if (parsedWhole.kind === "ADDRESS" || parsedWhole.kind === "CITY") {
    return null;
  }

  return null;
}

function parseBookingSelection(input: { inboundBody: string; options: SlotOption[] }): SlotOption | null {
  const text = input.inboundBody.trim().toLowerCase();
  if (!text) return null;

  const directMatch = text.match(/\b([abc]|[123])\b/);
  if (directMatch?.[1]) {
    const key = directMatch[1];
    const normalizedId = key === "1" ? "A" : key === "2" ? "B" : key === "3" ? "C" : key.toUpperCase();
    return input.options.find((option) => option.id === normalizedId) || null;
  }

  for (const option of input.options) {
    if (text.includes(option.matchText)) {
      return option;
    }
  }

  return null;
}

function isAmbiguousTimeSelection(text: string): boolean {
  return AMBIGUOUS_TIME_PATTERN.test(text.toLowerCase());
}

async function getConversationOrgConfig(orgId: string): Promise<ConversationOrgConfig | null> {
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
    slotDurationMinutes: Math.max(15, Math.min(180, messaging?.slotDurationMinutes || org.dashboardConfig?.defaultSlotMinutes || 60)),
    bufferMinutes: Math.max(0, Math.min(120, messaging?.bufferMinutes || 15)),
    daysAhead: Math.max(1, Math.min(14, messaging?.daysAhead || 3)),
    messagingTimezone: messaging?.timezone || org.dashboardConfig?.calendarTimezone || "America/Los_Angeles",
    customTemplates,
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

async function getConversationLead(leadId: string): Promise<ConversationLead | null> {
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
      nextFollowUpAt: true,
    },
  });
}

async function getOrCreateConversationState(lead: ConversationLead) {
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

async function auditConversation(input: {
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

async function cancelQueuedAutomation(input: { orgId: string; leadId: string; reason: string }) {
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

function buildTemplateBundle(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
}): TemplateBundle {
  const locale = resolveMessageLocale({
    organizationLanguage: input.organization.messageLanguage,
    leadPreferredLanguage: input.lead.preferredLanguage,
  });

  const base = getSmsToneTemplates({
    tone: input.organization.smsTone,
    locale,
  });

  const customInitial =
    locale === "ES"
      ? input.organization.missedCallAutoReplyBodyEs || input.organization.missedCallAutoReplyBodyEn || input.organization.missedCallAutoReplyBody
      : input.organization.missedCallAutoReplyBodyEn || input.organization.missedCallAutoReplyBodyEs || input.organization.missedCallAutoReplyBody;
  const customAskAddress =
    locale === "ES"
      ? input.organization.intakeAskLocationBodyEs || input.organization.intakeAskLocationBodyEn || input.organization.intakeAskLocationBody
      : input.organization.intakeAskLocationBodyEn || input.organization.intakeAskLocationBodyEs || input.organization.intakeAskLocationBody;
  const customAskTimeframe =
    locale === "ES"
      ? input.organization.intakeAskWorkTypeBodyEs ||
        input.organization.intakeAskWorkTypeBodyEn ||
        input.organization.intakeAskWorkTypeBody
      : input.organization.intakeAskWorkTypeBodyEn ||
        input.organization.intakeAskWorkTypeBodyEs ||
        input.organization.intakeAskWorkTypeBody;
  const customOffer =
    locale === "ES"
      ? input.organization.intakeAskCallbackBodyEs || input.organization.intakeAskCallbackBodyEn || input.organization.intakeAskCallbackBody
      : input.organization.intakeAskCallbackBodyEn || input.organization.intakeAskCallbackBodyEs || input.organization.intakeAskCallbackBody;
  const customBooked =
    locale === "ES"
      ? input.organization.intakeCompletionBodyEs || input.organization.intakeCompletionBodyEn || input.organization.intakeCompletionBody
      : input.organization.intakeCompletionBodyEn || input.organization.intakeCompletionBodyEs || input.organization.intakeCompletionBody;

  const resolved = {
    initial: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "initial",
      customTemplates: input.organization.customTemplates,
    }),
    askAddress: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "askAddress",
      customTemplates: input.organization.customTemplates,
    }),
    askTimeframe: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "askTimeframe",
      customTemplates: input.organization.customTemplates,
    }),
    offerBooking: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "offerBooking",
      customTemplates: input.organization.customTemplates,
    }),
    bookingConfirmation: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "bookingConfirmation",
      customTemplates: input.organization.customTemplates,
    }),
    followUp1: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "followUp1",
      customTemplates: input.organization.customTemplates,
    }),
    followUp2: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "followUp2",
      customTemplates: input.organization.customTemplates,
    }),
    followUp3: resolveTemplate({
      tone: input.organization.smsTone,
      locale,
      key: "followUp3",
      customTemplates: input.organization.customTemplates,
    }),
  };

  return {
    locale,
    ...base,
    initial: customInitial?.trim() || resolved.initial || base.initial,
    askAddress: customAskAddress?.trim() || resolved.askAddress || base.askAddress,
    askTimeframe: customAskTimeframe?.trim() || resolved.askTimeframe || base.askTimeframe,
    offerBooking: customOffer?.trim() || resolved.offerBooking || base.offerBooking,
    bookingConfirmation: customBooked?.trim() || resolved.bookingConfirmation || base.bookingConfirmation,
    followUp1: resolved.followUp1 || base.followUp1,
    followUp2: resolved.followUp2 || base.followUp2,
    followUp3: resolved.followUp3 || base.followUp3,
  };
}

async function sendConversationMessage(input: {
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

  const text = sanitizeMessageBody(input.body);
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

async function queueConversationReply(input: {
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

  const text = sanitizeMessageBody(input.body);
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

async function setConversationStage(input: {
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

async function setNextFollowUp(input: {
  organization: ConversationOrgConfig;
  leadId: string;
  stateId: string;
  stage: ConversationStage;
  sentFollowUpCount: number;
  fromAt?: Date;
}) {
  const cadence = getFollowUpCadenceMinutes(input.stage);
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

function formatSlotLabel(input: { startAt: Date; timeZone: string; locale: "EN" | "ES" }): string {
  const todayKey = formatInTimeZone(new Date(), input.timeZone, "yyyy-MM-dd");
  const tomorrowKey = formatInTimeZone(addDays(new Date(), 1), input.timeZone, "yyyy-MM-dd");
  const slotKey = formatInTimeZone(input.startAt, input.timeZone, "yyyy-MM-dd");
  const timeLabel = formatInTimeZone(input.startAt, input.timeZone, "h:mmaaa").toLowerCase();

  if (slotKey === todayKey) {
    return input.locale === "ES" ? `Hoy ${timeLabel}` : `Today ${timeLabel}`;
  }
  if (slotKey === tomorrowKey) {
    return input.locale === "ES" ? `Mañana ${timeLabel}` : `Tomorrow ${timeLabel}`;
  }
  const dayLabel = formatInTimeZone(input.startAt, input.timeZone, "EEE");
  return `${dayLabel} ${timeLabel}`;
}

async function getWorkerCandidates(orgId: string) {
  const workers = await prisma.user.findMany({
    where: {
      orgId,
      calendarAccessRole: { not: "READ_ONLY" },
    },
    select: {
      id: true,
      calendarAccessRole: true,
      name: true,
      email: true,
    },
    take: 60,
  });

  const rank: Record<string, number> = {
    OWNER: 0,
    ADMIN: 1,
    WORKER: 2,
    READ_ONLY: 3,
  };

  return workers.sort((a, b) => {
    const diff = (rank[a.calendarAccessRole] ?? 99) - (rank[b.calendarAccessRole] ?? 99);
    if (diff !== 0) return diff;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });
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

  for (let offset = 0; offset < lookaheadDays; offset += 1) {
    const date = formatInTimeZone(addDays(now, offset), timezone, "yyyy-MM-dd");

    for (const worker of workers) {
      if (candidates.length >= OFFERED_SLOT_COUNT) break;
      const availability = await computeAvailabilityForWorker({
        orgId: input.organization.id,
        workerUserId: worker.id,
        date,
        durationMinutes: blockMinutes,
      });
      const found = availability.slotsUtc.find((slotUtc) => {
        if (usedSlotUtc.has(slotUtc)) return false;
        const slotDate = new Date(slotUtc);
        return slotDate.getTime() > now.getTime();
      });
      if (!found) continue;

      usedSlotUtc.add(found);
      const startAt = new Date(found);
      candidates.push({
        workerUserId: worker.id,
        startAt,
        endAt: addMinutes(startAt, blockMinutes),
      });
    }

    if (candidates.length >= OFFERED_SLOT_COUNT) {
      break;
    }
  }

  const expiresAt = addMinutes(now, OFFER_HOLD_MINUTES);
  const labels = ["A", "B", "C"] as const;
  const options: SlotOption[] = [];
  for (let index = 0; index < candidates.length && index < OFFERED_SLOT_COUNT; index += 1) {
    const candidate = candidates[index]!;
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

function buildSlotList(options: SlotOption[]): string {
  return options.map((option) => `${option.id}) ${option.label}`).join("  ");
}

function buildSlotTemplateContext(options: SlotOption[]) {
  const [slot1 = "", slot2 = "", slot3 = ""] = options.map((option) => `${option.id}) ${option.label}`);
  return {
    slotList: buildSlotList(options),
    slot1,
    slot2,
    slot3,
  };
}

async function bookFromSelectedOption(input: {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  stateId: string;
  option: SlotOption;
  templates: TemplateBundle;
  stateAddress: string | null;
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

  const event = await prisma.event.create({
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

  if (event.assignedToUserId) {
    void enqueueGoogleSyncJob({
      orgId: input.organization.id,
      userId: event.assignedToUserId,
      eventId: event.id,
      action: "UPSERT_EVENT",
    });
  }

  await prisma.$transaction(async (tx) => {
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
        bookedCalendarEventId: event.id,
      },
    });

    await tx.lead.update({
      where: { id: input.lead.id },
      data: {
        status: "BOOKED",
        nextFollowUpAt: null,
        intakeStage: "COMPLETED",
      },
    });
  });

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
        body: `[SMS Takeover] ${input.reason}. Message: "${sanitizeMessageBody(input.inboundBody)}"`,
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
}) {
  const now = new Date();
  const [organization, lead] = await Promise.all([
    getConversationOrgConfig(input.orgId),
    getConversationLead(input.leadId),
  ]);
  if (!organization || !lead || lead.status === "DNC" || !organization.autoReplyEnabled) return;

  const state = await getOrCreateConversationState(lead);
  if (shouldSuppressMissedCallKickoff({ state, now })) return;

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

  if (initialSend.status !== "FAILED" && kickoff.delayedPromptBody) {
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
    fromAt: initialSend.status === "FAILED" ? undefined : new Date(),
  });
}

export async function queueConversationalIntroForQuietHours(input: {
  orgId: string;
  leadId: string;
  toNumberE164: string;
  sendAfterAt: Date;
}) {
  const now = new Date();
  const [organization, lead] = await Promise.all([
    getConversationOrgConfig(input.orgId),
    getConversationLead(input.leadId),
  ]);
  if (!organization || !lead || lead.status === "DNC" || !organization.autoReplyEnabled) {
    return { queued: false as const };
  }

  const state = await getOrCreateConversationState(lead);
  if (shouldSuppressMissedCallKickoff({ state, now })) {
    return { queued: false as const };
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
      (getFollowUpCadenceMinutes("ASKED_WORK")[0] || 10),
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

  return { queued: true as const, queueId: queued.id, created: queued.created };
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

  if (TAKEOVER_PATTERN.test(body)) {
    await activateHumanTakeover({
      organization,
      lead,
      stateId: state.id,
      currentStage: state.stage,
      reason: "Lead requested phone follow-up",
      inboundBody: body,
      sendAck: false,
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
      const askTimeframe = renderSmsTemplate(templates.askTimeframe, {
        bizName: organization.name,
        workingHours: organization.smsWorkingHoursText || "",
      });
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({ body: askTimeframe, websiteSignature: organization.smsWebsiteSignature }),
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
          body: renderSmsTemplate(templates.clarification, {
            bizName: organization.name,
            missingField: formatMissingField("ASKED_WORK", templates.locale),
          }),
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
    await queueConversationReply({
      organization,
      lead,
      stateId: state.id,
      body: withSignature({
        body: renderSmsTemplate(templates.askAddress, { bizName: organization.name }),
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
    if (parsed.kind === "ADDRESS" || parsed.kind === "CITY") {
      addressText = parsed.kind === "ADDRESS" ? parsed.addressText || null : null;
      addressCity = parsed.kind === "CITY" ? parsed.city || body : addressCity;
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
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: renderSmsTemplate(templates.askTimeframe, {
            bizName: organization.name,
            workingHours: organization.smsWorkingHoursText || "",
          }),
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

    const prompt = addressText || addressCity
      ? renderSmsTemplate(templates.clarification, {
          bizName: organization.name,
          missingField: formatMissingField("ASKED_ADDRESS", templates.locale),
        })
      : renderSmsTemplate(templates.askAddress, { bizName: organization.name });
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
    if (!timeframe) {
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({
          body: renderSmsTemplate(templates.clarification, {
            bizName: organization.name,
            missingField: formatMissingField("ASKED_TIMEFRAME", templates.locale),
          }),
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
        templates,
      });
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }

    const options = await createBookingOptions({
      organization,
      lead,
      locale: templates.locale,
    });

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
      const fallback = templates.locale === "ES"
        ? "No vemos horarios abiertos ahora mismo. Te enviaremos nuevas opciones en breve."
        : "I don't have open slots right now. I'll send fresh options shortly.";
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({ body: fallback, websiteSignature: organization.smsWebsiteSignature }),
        messageType: "AUTOMATION",
        fallbackFromNumberE164: input.toNumberE164,
      });
    } else {
      const offer = renderSmsTemplate(templates.offerBooking, {
        bizName: organization.name,
        ...buildSlotTemplateContext(options),
        workingHours: organization.smsWorkingHoursText || "",
      });
      await queueConversationReply({
        organization,
        lead,
        stateId: state.id,
        body: withSignature({ body: offer, websiteSignature: organization.smsWebsiteSignature }),
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
    if (selected) {
      const booked = await bookFromSelectedOption({
        organization,
        lead,
        stateId: state.id,
        option: selected,
        templates,
        stateAddress: addressText || addressCity || null,
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
        templates,
      });
      return { stage: "HUMAN_TAKEOVER", action: "TAKEOVER" };
    }

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
        body: `${prompt}${slotList}`,
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

async function claimDueConversationFollowUp(input: {
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

async function getLiveConversationFollowUpState(stateId: string) {
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
          phoneE164: true,
          status: true,
          preferredLanguage: true,
          businessName: true,
          contactName: true,
          nextFollowUpAt: true,
        },
      },
    },
  });
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

  let scanned = dueStates.length;
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
    const missingField = formatMissingField(liveState.stage, templates.locale);
    const template =
      liveState.followUpStep >= 2
        ? templates.followUp3
        : liveState.followUpStep >= 1
          ? templates.followUp2
          : templates.followUp1;

    let body = renderSmsTemplate(template, {
      bizName: org.name,
      missingField,
      websiteSignature: org.smsWebsiteSignature || "",
    });

    if (liveState.stage === "ASKED_WORK") {
      body = `${body}\n\n${renderSmsTemplate(templates.initial, { bizName: org.name })}`;
    } else if (liveState.stage === "ASKED_ADDRESS") {
      body = `${body}\n\n${renderSmsTemplate(templates.askAddress, { bizName: org.name })}`;
    } else if (liveState.stage === "ASKED_TIMEFRAME") {
      body = `${body}\n\n${renderSmsTemplate(templates.askTimeframe, { bizName: org.name })}`;
    } else if (liveState.stage === "OFFERED_BOOKING") {
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
        body = renderSmsTemplate(templates.offerBooking, {
          bizName: org.name,
          ...buildSlotTemplateContext(options),
        });
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
