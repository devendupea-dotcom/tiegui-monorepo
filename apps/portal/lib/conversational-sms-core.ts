import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { ConversationStage, ConversationTimeframe, LeadIntakeStage } from "@prisma/client";
import { containsLikelyWorkSummaryText } from "@/lib/lead-display";
import { normalizeLeadCity } from "@/lib/lead-location";
import { resolveMessageLocale } from "@/lib/message-language";
import { getConversationFollowUpCadenceMinutes } from "@/lib/conversational-sms-policy";
import {
  getSmsToneTemplates,
  resolveTemplate,
  type SmsToneCustomTemplates,
} from "@/lib/conversational-sms-templates";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

export const TAKEOVER_PATTERN =
  /\b(call me|can you call|talk to someone|i have questions|phone call|call back|ll[aá]mame|pueden llamar|quiero hablar)\b/i;

const ADDRESS_PATTERN =
  /\b\d{1,6}\s+[a-z0-9.\-'\s]{2,}\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|boulevard|ct|court|pl|place|pkwy|parkway)\b/i;
const CROSS_STREET_PATTERN = /\b[a-z]+(?:\s+[a-z]+)?\s+(?:and|&|y)\s+[a-z]+(?:\s+[a-z]+)?\b/i;
const ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/;
const CITY_PATTERN = /^[a-zA-ZÀ-ÿ.\-\s]{2,60}$/;
export const AMBIGUOUS_TIME_PATTERN =
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

export type ConversationOrgConfig = {
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

export type ConversationLead = {
  id: string;
  orgId: string;
  customerId: string | null;
  phoneE164: string;
  status: "NEW" | "CALLED_NO_ANSWER" | "VOICEMAIL" | "INTERESTED" | "FOLLOW_UP" | "BOOKED" | "NOT_INTERESTED" | "DNC";
  preferredLanguage: "EN" | "ES" | null;
  businessName: string | null;
  contactName: string | null;
  lastOutboundAt: Date | null;
  nextFollowUpAt: Date | null;
};

export type SlotOption = {
  id: "A" | "B" | "C";
  holdId: string;
  startAtIso: string;
  endAtIso: string;
  workerUserId: string;
  label: string;
  matchText: string;
};

export type TemplateBundle = {
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

export function normalizeInboundKeyword(body: string): string {
  return body.trim().toUpperCase().split(/\s+/)[0] || "";
}

export function hasStopKeyword(body: string): boolean {
  return STOP_KEYWORDS.has(normalizeInboundKeyword(body));
}

export function hasStartKeyword(body: string): boolean {
  return START_KEYWORDS.has(normalizeInboundKeyword(body));
}

export function mapStageToLeadIntake(stage: ConversationStage): LeadIntakeStage {
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

export function getFollowUpCadenceMinutes(
  stage: ConversationStage,
  activeFollowUpStages: readonly ConversationStage[],
): number[] {
  return getConversationFollowUpCadenceMinutes(stage, activeFollowUpStages);
}

export function formatMissingField(stage: ConversationStage, locale: "EN" | "ES"): string {
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

export function sanitizeMessageBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

export function withSignature(input: { body: string; websiteSignature: string | null }): string {
  const body = sanitizeMessageBody(input.body);
  if (!input.websiteSignature) return body;
  const signature = sanitizeMessageBody(input.websiteSignature);
  if (!signature) return body;
  return `${body}\n\n${signature}`;
}

export function parseTimeframe(value: string): ConversationTimeframe | null {
  const normalized = value.toLowerCase();
  if (/\b(asap|urgent|today|now|right away|de inmediato|urgente|hoy|ahora)\b/.test(normalized)) return "ASAP";
  if (/\b(this week|soon|few days|esta semana|pronto|estos dias|estos días)\b/.test(normalized)) return "THIS_WEEK";
  if (/\b(next week|weekend|la próxima semana|proxima semana|fin de semana)\b/.test(normalized)) return "NEXT_WEEK";
  if (/\b(quote|estimate|just looking|cotizaci[oó]n|presupuesto|solo cotizar)\b/.test(normalized)) return "QUOTE_ONLY";
  return null;
}

export function parseAddress(value: string): { kind: "ADDRESS" | "CITY" | "UNKNOWN"; addressText?: string; city?: string } {
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

export function parseWorkAndLocation(value: string): {
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

export function parseBookingSelection(input: { inboundBody: string; options: SlotOption[] }): SlotOption | null {
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

export function isAmbiguousTimeSelection(text: string): boolean {
  return AMBIGUOUS_TIME_PATTERN.test(text.toLowerCase());
}

export function buildTemplateBundle(input: {
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

export function formatSlotLabel(input: { startAt: Date; timeZone: string; locale: "EN" | "ES" }): string {
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

export function buildSlotList(options: SlotOption[]): string {
  return options.map((option) => `${option.id}) ${option.label}`).join("  ");
}

export function buildSlotTemplateContext(options: SlotOption[]) {
  const [slot1 = "", slot2 = "", slot3 = ""] = options.map((option) => `${option.id}) ${option.label}`);
  return {
    slotList: buildSlotList(options),
    slot1,
    slot2,
    slot3,
  };
}
