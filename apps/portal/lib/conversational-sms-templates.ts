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
  slot1?: string;
  slot2?: string;
  slot3?: string;
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

type SmsFunnelTemplatePack = {
  opener: string;
  afterJob: string;
  afterAddress: string;
  afterTimeline: string;
};

export const SMS_TEMPLATES = {
  friendly: {
    opener:
      "Hi, this is {bizName}. Sorry we missed your call. What kind of work do you need help with? Reply STOP to unsubscribe.",
    afterJob: "Thanks. What is the property address? A nearby cross street works too.",
    afterAddress: "Thanks. Are you looking for ASAP, this week, next week, or just a quote?",
    afterTimeline: "Available estimate times: {slot1}, {slot2}, {slot3}. Which works best for you?",
  },
  professional: {
    opener:
      "{bizName} here — we missed your call but we're ready to help. What work can we assist you with? Reply STOP to unsubscribe.",
    afterJob: "Thank you. What's the service address?",
    afterAddress: "Got it. Are you looking to schedule soon, or would you prefer a quote first?",
    afterTimeline: "We can arrange an on-site estimate. Available: {slot1}, {slot2}, {slot3}. Which works best?",
  },
  direct: {
    opener: "{bizName}: missed your call. What job do you need? Reply STOP to unsubscribe.",
    afterJob: "What is the address?",
    afterAddress: "When do you need it: ASAP, this week, next week, or quote only?",
    afterTimeline: "Available times: {slot1} / {slot2} / {slot3}. Which one works?",
  },
  highEnergy: {
    opener: "Thanks for calling {bizName}. What kind of work do you need help with? Reply STOP to unsubscribe.",
    afterJob: "Thanks. What is the property address?",
    afterAddress: "Are you looking to do this ASAP, this week, next week, or just get a quote?",
    afterTimeline: "I can offer {slot1}, {slot2}, or {slot3}. Which works best?",
  },
  luxury: {
    opener:
      "This is {bizName}. We missed your call and want to make sure you're taken care of. What project are you considering? Reply STOP to unsubscribe.",
    afterJob: "Understood. What's the property address?",
    afterAddress: "What's your preferred timeline — planning ahead or looking to move quickly?",
    afterTimeline:
      "I'd like to arrange a complimentary on-site consultation. Available: {slot1}, {slot2}, {slot3}. What suits you?",
  },
  bilingual: {
    opener:
      "Hi from {bizName}! What work do you need? / Hola de {bizName}. ¿Qué trabajo necesitas? Reply STOP to unsubscribe / Responde STOP para cancelar.",
    afterJob: "What's the address? / ¿Cuál es la dirección?",
    afterAddress: "When do you need it done? / ¿Para cuándo lo necesitas?",
    afterTimeline:
      "Available times: {slot1}, {slot2}, {slot3}. Which works? / ¿Cuál hora te funciona?",
  },
} as const satisfies Record<string, SmsFunnelTemplatePack>;

const FRIENDLY_EN: SmsTemplatePack = {
  initial: SMS_TEMPLATES.friendly.opener,
  askAddress: SMS_TEMPLATES.friendly.afterJob,
  askCity: "No worries — what city/area is the property in?",
  askTimeframe: SMS_TEMPLATES.friendly.afterAddress,
  offerBooking: SMS_TEMPLATES.friendly.afterTimeline,
  followUp1: "Following up from {bizName}. When you have a moment, send {missingField}.",
  followUp2: "Last follow-up from {bizName}. Send {missingField} if you'd like us to keep this moving.",
  followUp3: "Last follow-up from {bizName}. Send {missingField} if you'd like us to keep this moving.",
  bookingConfirmation: "You're booked ✅ {bizName} estimate at {address} — {slotLabel}. Reply RESCHEDULE to change.",
  clarification:
    "Sorry, I didn't catch that. Could you reply with just {missingField}? Example: '123 Oak St' or 'this week'.",
  optOutConfirmation: "You've been unsubscribed from {bizName} messages. Reply START to re-subscribe.",
  humanAck: "Thanks. Someone from {bizName} will follow up shortly.",
};

const FRIENDLY_ES: SmsTemplatePack = {
  initial:
    "Hola, habla {bizName} — perdón que no contestamos. ¿Qué trabajo necesitas? Reply STOP to unsubscribe / Responde STOP para cancelar.",
  askAddress: "Perfecto 👍 ¿Cuál es la dirección de la propiedad (o calles cercanas)?",
  askCity: "No hay problema — ¿en qué ciudad/zona está la propiedad?",
  askTimeframe: "Perfecto. ¿Lo quieres ASAP, esta semana, la próxima semana, o solo una cotización?",
  offerBooking: "Perfecto — tengo: {slot1}, {slot2}, {slot3}. ¿Cuál te funciona? O dime otro horario.",
  followUp1: "Seguimiento de {bizName}. Cuando puedas, comparte {missingField}.",
  followUp2: "Último seguimiento de {bizName}. Envíanos {missingField} si quieres que sigamos con esto.",
  followUp3: "Último seguimiento de {bizName}. Envíanos {missingField} si quieres que sigamos con esto.",
  bookingConfirmation: "Quedó agendado ✅ {bizName} en {address} — {slotLabel}. Responde REAGENDAR para cambiar.",
  clarification:
    "Perdón, no lo entendí bien. ¿Me respondes solo con {missingField}? Ejemplo: '123 Oak St' o 'esta semana'.",
  optOutConfirmation: "Ya no recibirás mensajes de {bizName}. Responde START para volver a suscribirte.",
  humanAck: "Gracias. Alguien de {bizName} te contactará pronto.",
};

const PROFESSIONAL_EN: SmsTemplatePack = {
  initial: SMS_TEMPLATES.professional.opener,
  askAddress: SMS_TEMPLATES.professional.afterJob,
  askCity: "Please share the city/area for the property.",
  askTimeframe: SMS_TEMPLATES.professional.afterAddress,
  offerBooking: SMS_TEMPLATES.professional.afterTimeline,
  followUp1: "{bizName} follow-up: please share {missingField} when convenient.",
  followUp2: "Final follow-up from {bizName}: send {missingField} if you would like us to continue.",
  followUp3: "Final follow-up from {bizName}: send {missingField} if you would like us to continue.",
  bookingConfirmation: "Confirmed: {bizName} estimate at {address} on {slotLabel}. Reply RESCHEDULE to change.",
  clarification: "Could you send only {missingField}? Example: '123 Oak St' or 'this week'.",
  optOutConfirmation: "You've been unsubscribed from {bizName} messages. Reply START to re-subscribe.",
  humanAck: "Understood. Someone from {bizName} will contact you shortly.",
};

const PROFESSIONAL_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial:
    "{bizName} aquí — perdimos tu llamada pero estamos listos para ayudarte. ¿En qué trabajo te podemos ayudar? Reply STOP to unsubscribe / Responde STOP para cancelar.",
  askAddress: "Gracias. Comparte la dirección del servicio.",
  askTimeframe: "Entendido. ¿Buscas agendar pronto o prefieres una cotización primero?",
};

const DIRECT_EN: SmsTemplatePack = {
  initial: SMS_TEMPLATES.direct.opener,
  askAddress: SMS_TEMPLATES.direct.afterJob,
  askCity: "City/area?",
  askTimeframe: SMS_TEMPLATES.direct.afterAddress,
  offerBooking: SMS_TEMPLATES.direct.afterTimeline,
  followUp1: "{bizName}: please send {missingField} when ready.",
  followUp2: "{bizName}: final follow-up. Send {missingField} if you'd like to continue.",
  followUp3: "{bizName}: final follow-up. Send {missingField} if you'd like to continue.",
  bookingConfirmation: "Booked: {address} — {slotLabel}. Reply RESCHEDULE to change.",
  clarification: "Please send only {missingField}.",
  optOutConfirmation: "You've been unsubscribed from {bizName} messages. Reply START to re-subscribe.",
  humanAck: "Understood. Someone from {bizName} will call you shortly.",
};

const DIRECT_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial:
    "{bizName}: perdimos tu llamada. ¿Qué trabajo necesitas? Reply STOP to unsubscribe / Responde STOP para cancelar.",
  askAddress: "¿Dirección?",
  askCity: "¿Ciudad/zona?",
  askTimeframe: "¿Cuándo: ASAP, esta semana o la próxima?",
  offerBooking: "Horarios abiertos: {slot1} / {slot2} / {slot3}. Elige uno.",
};

const SALES_EN: SmsTemplatePack = {
  initial: SMS_TEMPLATES.highEnergy.opener,
  askAddress: SMS_TEMPLATES.highEnergy.afterJob,
  askCity: "What city/area is the property in?",
  askTimeframe: SMS_TEMPLATES.highEnergy.afterAddress,
  offerBooking: SMS_TEMPLATES.highEnergy.afterTimeline,
  followUp1: "{bizName} follow-up: send {missingField} when you're ready.",
  followUp2: "Final follow-up from {bizName}: send {missingField} if you'd like us to continue.",
  followUp3: "Final follow-up from {bizName}: send {missingField} if you'd like us to continue.",
  bookingConfirmation: "Estimate scheduled ✅ {address} — {slotLabel}. Reply RESCHEDULE to change.",
  clarification: "Could you resend only {missingField}?",
  optOutConfirmation: "You've been unsubscribed from {bizName} messages. Reply START to re-subscribe.",
  humanAck: "Thanks. Someone from {bizName} will call you shortly.",
};

const SALES_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial:
    "¡Gracias por llamar a {bizName}! ¿Qué trabajo necesitas? Reply STOP to unsubscribe / Responde STOP para cancelar.",
  askAddress: "Me encanta — vamos a dejar esto encaminado. ¿Cuál es la dirección de la propiedad?",
  askTimeframe: "¿Quieres hacerlo ASAP o solo estás explorando opciones?",
  offerBooking: "Vamos a agendar tu estimado gratis. Tengo {slot1}, {slot2} o {slot3}.",
};

const PREMIUM_EN: SmsTemplatePack = {
  initial: SMS_TEMPLATES.luxury.opener,
  askAddress: SMS_TEMPLATES.luxury.afterJob,
  askCity: "Please share the city/area for the property.",
  askTimeframe: SMS_TEMPLATES.luxury.afterAddress,
  offerBooking: SMS_TEMPLATES.luxury.afterTimeline,
  followUp1: "{bizName} follow-up: share {missingField} when convenient.",
  followUp2: "Final follow-up from {bizName}: send {missingField} if you'd like to proceed.",
  followUp3: "Final follow-up from {bizName}: send {missingField} if you'd like to proceed.",
  bookingConfirmation: "Scheduled ✅ {bizName} estimate at {address} — {slotLabel}. Reply RESCHEDULE to adjust.",
  clarification: "Please reply with {missingField} only, so we can proceed quickly.",
  optOutConfirmation: "You've been unsubscribed from {bizName} messages. Reply START to re-subscribe.",
  humanAck: "Acknowledged. Someone from {bizName} will follow up shortly.",
};

const PREMIUM_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial:
    "Habla {bizName}. Perdimos tu llamada y queremos atenderte bien. ¿Qué proyecto estás considerando? Reply STOP to unsubscribe / Responde STOP para cancelar.",
  askAddress: "Entendido. ¿Cuál es la dirección de la propiedad?",
  askTimeframe: "¿Cuál es tu plazo preferido: planeando con tiempo o quieres moverte rápido?",
  offerBooking:
    "Quiero agendar una consulta en sitio sin costo. Disponible: {slot1}, {slot2}, {slot3}. ¿Cuál te acomoda?",
};

const BILINGUAL_EN: SmsTemplatePack = {
  ...FRIENDLY_EN,
  initial: SMS_TEMPLATES.bilingual.opener,
  askAddress: SMS_TEMPLATES.bilingual.afterJob,
  askTimeframe: SMS_TEMPLATES.bilingual.afterAddress,
  offerBooking: SMS_TEMPLATES.bilingual.afterTimeline,
};

const BILINGUAL_ES: SmsTemplatePack = {
  ...FRIENDLY_ES,
  initial: SMS_TEMPLATES.bilingual.opener,
  askAddress: SMS_TEMPLATES.bilingual.afterJob,
  askTimeframe: SMS_TEMPLATES.bilingual.afterAddress,
  offerBooking: SMS_TEMPLATES.bilingual.afterTimeline,
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
    slot1: context.slot1 || "",
    slot2: context.slot2 || "",
    slot3: context.slot3 || "",
    slotLabel: context.slotLabel || "",
    address: context.address || "your property",
    missingField: context.missingField || "details",
    workingHours: context.workingHours || "",
    websiteSignature: context.websiteSignature || "",
  };

  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (_, key) => values[key] || "");
}
