import type { SmsTone } from "@prisma/client";
import type { ResolvedMessageLocale } from "@/lib/message-language";

export type SmsTemplatePack = {
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

export type SmsTemplateKey = keyof SmsTemplatePack;

export type SmsToneCustomTemplates = Partial<{
  greeting: string;
  askAddress: string;
  askTimeframe: string;
  offerBooking: string;
  bookingConfirmation: string;
  followUp1: string;
  followUp2: string;
  followUp3: string;
}>;

export type SmsTemplateContext = {
  bizName: string;
  slotList?: string;
  slotLabel?: string;
  address?: string;
  missingField?: string;
  workingHours?: string;
  websiteSignature?: string;
};

type LocalePack = {
  EN: SmsTemplatePack;
  ES: SmsTemplatePack;
};

const FRIENDLY_EN: SmsTemplatePack = {
  initial: "Hey this is {bizName} — sorry we missed you! What work are you looking to get done?",
  askAddress: "Got it 👍 What's the property address (or closest cross-street)?",
  askCity: "No worries — what city/area is the property in?",
  askTimeframe:
    "Perfect. When are you looking to get this done — ASAP, this week, next week, or just getting a quote?",
  offerBooking:
    "Great — want to lock in an estimate visit? I have: {slotList}. Reply with the one you want (or tell me a time that works).",
  followUp1:
    "Quick follow-up from {bizName}: still happy to help. Send {missingField} when you can. Reply STOP to opt out.",
  followUp2: "Just checking back — once you send {missingField}, we can lock this in.",
  followUp3: "Last check-in from {bizName}. Send {missingField} and we’ll keep this moving.",
  bookingConfirmation:
    "You're booked ✅ {bizName} estimate at {address} — {slotLabel}. Reply RESCHEDULE to change or STOP to opt out.",
  clarification:
    "Sorry — I didn't quite catch that. Could you reply with just the {missingField}? Example: '123 Oak St' or 'this week.'",
  optOutConfirmation:
    "Got it — you won't receive any more texts from {bizName}. If you need us later, just text us here.",
  humanAck: "Got it — we'll reach out shortly.",
};

const FRIENDLY_ES: SmsTemplatePack = {
  initial: "Hola, habla {bizName} — perdón que no contestamos. ¿Qué trabajo necesitas?",
  askAddress: "Perfecto 👍 ¿Cuál es la dirección de la propiedad (o calles cercanas)?",
  askCity: "No hay problema — ¿en qué ciudad/zona está la propiedad?",
  askTimeframe:
    "Excelente. ¿Cuándo quieres hacer esto — ASAP, esta semana, la próxima semana, o solo cotización?",
  offerBooking:
    "¿Quieres apartar una visita de estimado? Tengo: {slotList}. Responde con la opción que prefieras.",
  followUp1:
    "Seguimiento rápido de {bizName}: cuando puedas, comparte {missingField}. Responde STOP para dejar de recibir mensajes.",
  followUp2: "Solo confirmando — con {missingField} te apartamos horario.",
  followUp3: "Último recordatorio de {bizName}. Envíanos {missingField} y avanzamos.",
  bookingConfirmation:
    "Quedó agendado ✅ {bizName} en {address} — {slotLabel}. Responde REAGENDAR para cambiar o STOP para salir.",
  clarification:
    "Perdón, no lo entendí bien. ¿Me respondes solo con {missingField}? Ejemplo: '123 Oak St' o 'esta semana'.",
  optOutConfirmation:
    "Listo — ya no recibirás más mensajes de {bizName}. Si luego nos necesitas, escríbenos aquí.",
  humanAck: "Entendido — te contactamos en breve.",
};

const PROFESSIONAL_EN: SmsTemplatePack = {
  initial: "{bizName} here. We missed your call and can still help. What work do you need?",
  askAddress: "Thank you. Please share the service address.",
  askCity: "Please share the city/area for the property.",
  askTimeframe: "What timeline is best: ASAP, this week, next week, or quote only?",
  offerBooking: "We can schedule an estimate at: {slotList}. Reply with your preferred option.",
  followUp1: "{bizName} follow-up: please share {missingField} so we can continue. Reply STOP to opt out.",
  followUp2: "Friendly reminder from {bizName}: we still need {missingField}.",
  followUp3: "Final reminder from {bizName}: send {missingField} when ready.",
  bookingConfirmation:
    "Confirmed: {bizName} estimate at {address} on {slotLabel}. Reply RESCHEDULE to change or STOP to opt out.",
  clarification: "Could you send only {missingField}? Example: '123 Oak St' or 'this week'.",
  optOutConfirmation: "Understood. You are opted out from {bizName} texts. Reply START to resume.",
  humanAck: "Understood. We will contact you shortly.",
};

const PROFESSIONAL_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial: "{bizName}. Perdimos tu llamada pero sí podemos ayudarte. ¿Qué trabajo necesitas?",
  askAddress: "Gracias. Comparte la dirección del servicio.",
  askTimeframe: "¿Cuál es tu plazo ideal: ASAP, esta semana, próxima semana o solo cotización?",
};

const DIRECT_EN: SmsTemplatePack = {
  initial: "{bizName}: we missed your call. What job do you need done?",
  askAddress: "Address?",
  askCity: "City/area?",
  askTimeframe: "Timeline: ASAP, this week, next week, or quote only?",
  offerBooking: "Open estimate slots: {slotList}. Reply with one option.",
  followUp1: "{bizName}: send {missingField} to continue. Reply STOP to opt out.",
  followUp2: "Still need {missingField}.",
  followUp3: "Last reminder: send {missingField} when ready.",
  bookingConfirmation: "Booked: {address} — {slotLabel}. Reply RESCHEDULE to change or STOP to opt out.",
  clarification: "Please send only {missingField}.",
  optOutConfirmation: "Done. You are opted out from {bizName}.",
  humanAck: "Understood. We'll call you shortly.",
};

const DIRECT_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial: "{bizName}: perdimos tu llamada. ¿Qué trabajo necesitas?",
  askAddress: "¿Dirección?",
  askCity: "¿Ciudad/zona?",
};

const SALES_EN: SmsTemplatePack = {
  initial: "Thanks for calling {bizName}! We can get this moving fast. What work do you need?",
  askAddress: "Awesome — what’s the service address?",
  askCity: "What city/area is the property in?",
  askTimeframe: "Great. Are you looking for ASAP, this week, next week, or quote only?",
  offerBooking: "I can lock in an estimate at: {slotList}. Reply with your pick.",
  followUp1: "We can still help today. Send {missingField} and we’ll book next steps. Reply STOP to opt out.",
  followUp2: "Still interested? Send {missingField} and we’ll reserve your spot.",
  followUp3: "Last check-in from {bizName}. Send {missingField} if you want us to hold a time.",
  bookingConfirmation: "You're locked in ✅ {address} — {slotLabel}. Reply RESCHEDULE to change or STOP to opt out.",
  clarification: "Can you resend only {missingField}?",
  optOutConfirmation: "No problem — you’re opted out from {bizName}.",
  humanAck: "Perfect — we’ll call you shortly.",
};

const SALES_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial: "¡Gracias por llamar a {bizName}! ¿Qué trabajo necesitas?",
};

const PREMIUM_EN: SmsTemplatePack = {
  initial: "This is {bizName}. We missed your call and can assist right away. What project are you planning?",
  askAddress: "Please share the property address for the estimate.",
  askCity: "Please share the city/area for the property.",
  askTimeframe: "What timeline do you prefer: ASAP, this week, next week, or quote only?",
  offerBooking: "Available estimate windows: {slotList}. Reply with your preferred option.",
  followUp1:
    "{bizName} follow-up: share {missingField} and we’ll finalize your estimate details. Reply STOP to opt out.",
  followUp2: "We’re ready when you are. Send {missingField} to continue.",
  followUp3: "Final follow-up from {bizName}. Send {missingField} if you'd like to proceed.",
  bookingConfirmation:
    "Scheduled ✅ {bizName} estimate at {address} — {slotLabel}. Reply RESCHEDULE to adjust or STOP to opt out.",
  clarification: "Please reply with {missingField} only, so we can proceed quickly.",
  optOutConfirmation: "Acknowledged. You have been removed from {bizName} text updates.",
  humanAck: "Acknowledged. We’ll follow up shortly.",
};

const PREMIUM_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial: "{bizName}. Perdimos tu llamada y podemos ayudarte de inmediato. ¿Qué proyecto tienes?",
};

const BILINGUAL_EN: SmsTemplatePack = {
  ...FRIENDLY_EN,
  initial:
    "Hi from {bizName}. What work do you need? / Hola de {bizName}. ¿Qué trabajo necesitas?",
  askAddress:
    "What’s the property address? / ¿Cuál es la dirección de la propiedad?",
  askTimeframe:
    "Timeline: ASAP, this week, next week, or quote only? / ¿ASAP, esta semana, próxima semana o solo cotización?",
};

const BILINGUAL_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial:
    "Hola de {bizName}. ¿Qué trabajo necesitas? / Hi from {bizName}. What work do you need?",
  askAddress:
    "¿Cuál es la dirección de la propiedad? / What’s the property address?",
};

const PACKS: Record<SmsTone, LocalePack> = {
  FRIENDLY: { EN: FRIENDLY_EN, ES: FRIENDLY_ES },
  PROFESSIONAL: { EN: PROFESSIONAL_EN, ES: PROFESSIONAL_ES },
  DIRECT: { EN: DIRECT_EN, ES: DIRECT_ES },
  SALES: { EN: SALES_EN, ES: SALES_ES },
  PREMIUM: { EN: PREMIUM_EN, ES: PREMIUM_ES },
  BILINGUAL: { EN: BILINGUAL_EN, ES: BILINGUAL_ES },
  CUSTOM: { EN: FRIENDLY_EN, ES: FRIENDLY_ES },
};

const CUSTOM_TEMPLATE_KEY_MAP: Record<Exclude<keyof SmsToneCustomTemplates, undefined>, SmsTemplateKey> = {
  greeting: "initial",
  askAddress: "askAddress",
  askTimeframe: "askTimeframe",
  offerBooking: "offerBooking",
  bookingConfirmation: "bookingConfirmation",
  followUp1: "followUp1",
  followUp2: "followUp2",
  followUp3: "followUp3",
};

const FORBIDDEN_AUTOMATION_LANGUAGE = /\b(bot|a\.?i\.?|automated|agent|handoff|human|type\s+human)\b/i;

function cleanTemplateValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function containsAutomationRevealLanguage(value: string): boolean {
  return FORBIDDEN_AUTOMATION_LANGUAGE.test(value);
}

export function normalizeCustomTemplates(input: unknown): SmsToneCustomTemplates {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const record = input as Record<string, unknown>;
  const output: SmsToneCustomTemplates = {};

  for (const key of Object.keys(CUSTOM_TEMPLATE_KEY_MAP) as Array<keyof SmsToneCustomTemplates>) {
    const maybe = cleanTemplateValue(record[key as string]);
    if (maybe) {
      output[key] = maybe;
    }
  }

  return output;
}

function getCustomTemplateOverride(input: {
  templates: SmsToneCustomTemplates | null | undefined;
  key: SmsTemplateKey;
}): string | null {
  if (!input.templates) return null;
  for (const [customKey, mappedKey] of Object.entries(CUSTOM_TEMPLATE_KEY_MAP) as Array<
    [keyof SmsToneCustomTemplates, SmsTemplateKey]
  >) {
    if (mappedKey !== input.key) continue;
    const maybe = cleanTemplateValue(input.templates[customKey]);
    if (maybe) return maybe;
  }
  return null;
}

export function getSmsToneTemplates(input: {
  tone: SmsTone | null | undefined;
  locale: ResolvedMessageLocale;
}): SmsTemplatePack {
  const tone = input.tone || "FRIENDLY";
  const tonePack = PACKS[tone] ?? PACKS.FRIENDLY;
  return tonePack[input.locale] ?? tonePack.EN;
}

export function resolveTemplate(input: {
  tone: SmsTone | null | undefined;
  locale: ResolvedMessageLocale;
  key: SmsTemplateKey;
  customTemplates?: SmsToneCustomTemplates | null;
}): string {
  const base = getSmsToneTemplates({
    tone: input.tone,
    locale: input.locale,
  });
  if (input.tone !== "CUSTOM") {
    return base[input.key];
  }

  const custom = getCustomTemplateOverride({
    templates: input.customTemplates,
    key: input.key,
  });
  return custom || base[input.key];
}

export function renderSmsTemplate(template: string, context: SmsTemplateContext): string {
  const values: Record<string, string> = {
    bizName: context.bizName || "our office",
    slotList: context.slotList || "",
    slotLabel: context.slotLabel || "",
    address: context.address || "your property",
    missingField: context.missingField || "details",
    workingHours: context.workingHours || "",
    websiteSignature: context.websiteSignature || "",
  };

  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] || "");
}
