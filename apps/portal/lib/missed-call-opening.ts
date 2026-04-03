import { ensureSmsA2POpenerDisclosure } from "@/lib/sms-compliance";
import { renderSmsTemplate } from "@/lib/conversational-sms-templates";

const DEFAULT_MISSED_CALL_FAST_INTRO = {
  EN: "Hey! This is {bizName} — sorry we missed ya. What kind of work are you looking to get done?",
  ES: "Hola, habla {bizName} — perdón que no contestamos. ¿Qué trabajo necesitas?",
} as const;

type MissedCallOpeningOrg = {
  name: string;
  smsGreetingLine: string | null;
  smsWebsiteSignature: string | null;
  missedCallAutoReplyBody: string | null;
  missedCallAutoReplyBodyEn: string | null;
  missedCallAutoReplyBodyEs: string | null;
  smsTone?: string | null;
};

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

function resolveMissedCallIntroTemplate(input: {
  organization: MissedCallOpeningOrg;
  locale: "EN" | "ES";
  openerTemplate?: string | null;
}) {
  const customIntro =
    input.locale === "ES"
      ? input.organization.missedCallAutoReplyBodyEs ||
        input.organization.missedCallAutoReplyBodyEn ||
        input.organization.missedCallAutoReplyBody
      : input.organization.missedCallAutoReplyBodyEn ||
        input.organization.missedCallAutoReplyBodyEs ||
        input.organization.missedCallAutoReplyBody;

  return customIntro?.trim() || input.openerTemplate?.trim() || DEFAULT_MISSED_CALL_FAST_INTRO[input.locale];
}

export function buildMissedCallOpeningMessages(input: {
  organization: MissedCallOpeningOrg;
  locale: "EN" | "ES";
  openerTemplate?: string | null;
}) {
  const introTemplate = resolveMissedCallIntroTemplate(input);
  const introBody = renderSmsTemplate(introTemplate, { bizName: input.organization.name });
  const introWithGreeting = input.organization.smsGreetingLine
    ? `${input.organization.smsGreetingLine}\n\n${introBody}`
    : introBody;
  const disclosureVariant = input.organization.smsTone === "BILINGUAL" || input.locale === "ES" ? "BILINGUAL" : "EN";

  return {
    immediateBody: withSignature({
      body: ensureSmsA2POpenerDisclosure(introWithGreeting, disclosureVariant),
      websiteSignature: input.organization.smsWebsiteSignature,
    }),
    delayedPromptBody: null,
  };
}
