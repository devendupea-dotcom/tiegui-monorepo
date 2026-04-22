import OpenAI from "openai";
import type { ConversationStage, ConversationTimeframe } from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import { hasSmsAgentPlaybookDetails } from "@/lib/conversational-sms-agent-playbook";
import type { ConversationLead, ConversationOrgConfig, SlotOption } from "@/lib/conversational-sms-core";
import {
  normalizeConversationalSmsLlmDecision,
  type ConversationalSmsLlmDecision,
} from "@/lib/conversational-sms-llm-contract";
import { maybeSendAiQuotaAlerts } from "@/lib/usage-alerts";
import { prisma } from "@/lib/prisma";
import { startOfUtcMonth } from "@/lib/usage";
import { capturePortalError } from "@/lib/telemetry";

const DEFAULT_MODEL = "sms-agent";
const DEFAULT_ESTIMATED_COST_CENTS = 2;
const DEFAULT_AZURE_OPENAI_BASE_URL = "https://tiegui-ai.openai.azure.com/openai/v1/";

type OpenAiResponsesPayload =
  | {
      output_text?: unknown;
      output?: Array<{
        content?: Array<{
          type?: unknown;
          text?: unknown;
        }>;
      }>;
      error?: {
        message?: unknown;
      };
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
      };
    }
  | null;

export type ConversationalSmsLlmInput = {
  organization: ConversationOrgConfig;
  lead: ConversationLead;
  stage: ConversationStage;
  inboundBody: string;
  workSummary?: string | null;
  addressText?: string | null;
  addressCity?: string | null;
  timeframe?: ConversationTimeframe | null;
  bookingOptions?: SlotOption[] | null;
};

export type ConversationalSmsLlmRuntimeSummary = {
  enabled: boolean;
  configured: boolean;
  mode: "auto" | "explicit_on" | "explicit_off";
  model: string;
  baseUrl: string;
  endpointOrigin: string | null;
};

function normalizeAzureOpenAiBaseUrl(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }

  const withTrailingSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  if (/\/openai\/v1\/$/i.test(withTrailingSlash)) {
    return withTrailingSlash;
  }
  if (/\/openai\/$/i.test(withTrailingSlash)) {
    return `${withTrailingSlash}v1/`;
  }
  return `${withTrailingSlash}openai/v1/`;
}

function getConversationalSmsModel(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeEnvValue(env.OPENAI_CONVERSATIONAL_SMS_MODEL) || DEFAULT_MODEL;
}

export function getConversationalSmsLlmRuntimeSummary(
  env: NodeJS.ProcessEnv = process.env,
): ConversationalSmsLlmRuntimeSummary {
  const explicitMode = normalizeEnvValue(env.CONVERSATIONAL_SMS_LLM_ENABLED);
  const mode =
    explicitMode === "true"
      ? "explicit_on"
      : explicitMode === "false"
        ? "explicit_off"
        : "auto";
  const apiKey = normalizeEnvValue(env.AZURE_OPENAI_API_KEY);
  const configured = Boolean(apiKey);
  const baseUrl =
    normalizeAzureOpenAiBaseUrl(normalizeEnvValue(env.AZURE_OPENAI_ENDPOINT)) ||
    DEFAULT_AZURE_OPENAI_BASE_URL;
  let endpointOrigin: string | null = null;
  try {
    endpointOrigin = new URL(baseUrl).origin;
  } catch {
    endpointOrigin = null;
  }

  return {
    enabled: mode === "explicit_off" ? false : configured,
    configured,
    mode,
    model: getConversationalSmsModel(env),
    baseUrl,
    endpointOrigin,
  };
}

function resolveConversationalSmsLlmRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const summary = getConversationalSmsLlmRuntimeSummary(env);
  return {
    ...summary,
    apiKey: normalizeEnvValue(env.AZURE_OPENAI_API_KEY),
  };
}

export function buildConversationalSmsLlmCacheKey(input: ConversationalSmsLlmInput): string {
  return JSON.stringify({
    organizationId: input.organization.id,
    leadId: input.lead.id,
    locale: input.lead.preferredLanguage || input.organization.messageLanguage,
    tone: input.organization.smsTone,
    stage: input.stage,
    workingHoursStart: input.organization.workingHoursStart,
    workingHoursEnd: input.organization.workingHoursEnd,
    smsAgentPlaybook: input.organization.smsAgentPlaybook,
    inboundBody: input.inboundBody.trim(),
    workSummary: input.workSummary || null,
    addressText: input.addressText || null,
    addressCity: input.addressCity || null,
    timeframe: input.timeframe || null,
    bookingOptions:
      input.bookingOptions?.map((option) => ({
        id: option.id,
        label: option.label,
      })) || [],
  });
}

function getConversationalSmsEstimatedCostCents(): number {
  return Math.max(
    1,
    Math.round(
      Number(normalizeEnvValue(process.env.OPENAI_CONVERSATIONAL_SMS_COST_ESTIMATE_CENTS)) ||
        DEFAULT_ESTIMATED_COST_CENTS,
    ),
  );
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return trimmed.replace(/```/g, "").trim();
  }

  const lastFence = trimmed.lastIndexOf("```");
  const body = lastFence > firstNewline ? trimmed.slice(firstNewline + 1, lastFence) : trimmed.slice(firstNewline + 1);
  return body.trim();
}

function extractJsonBody(value: string): string {
  const withoutFence = stripCodeFence(value);
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return withoutFence.slice(start, end + 1);
  }
  return withoutFence;
}

function extractOpenAiText(payload: OpenAiResponsesPayload): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks =
    payload?.output
      ?.flatMap((message) => message.content || [])
      .map((item) => (item?.type === "output_text" && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean) || [];

  return chunks.join("\n").trim();
}

async function reserveConversationalSmsAiQuota(input: { orgId: string; estimatedCostCents: number }) {
  const organization = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      aiMonthlyBudgetCents: true,
      aiHardStop: true,
    },
  });

  if (!organization) {
    return false;
  }

  const periodStart = startOfUtcMonth(new Date());

  await prisma.aiUsage.upsert({
    where: { orgId_periodStart: { orgId: input.orgId, periodStart } },
    create: { orgId: input.orgId, periodStart },
    update: {},
  });

  const monthlyBudget = organization.aiMonthlyBudgetCents || 0;
  const hardStop = organization.aiHardStop ?? true;

  if (monthlyBudget > 0 && hardStop) {
    const updatedMonthly = await prisma.$executeRaw`
      UPDATE "AiUsage"
      SET "requestsCount" = "requestsCount" + 1,
          "estimatedCostCents" = "estimatedCostCents" + ${input.estimatedCostCents},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "orgId" = ${input.orgId}
        AND "periodStart" = ${periodStart}
        AND ("estimatedCostCents" + ${input.estimatedCostCents}) <= ${monthlyBudget};
    `;

    if (Number(updatedMonthly) === 0) {
      return false;
    }
  } else {
    await prisma.aiUsage.updateMany({
      where: { orgId: input.orgId, periodStart },
      data: {
        requestsCount: { increment: 1 },
        estimatedCostCents: { increment: input.estimatedCostCents },
      },
    });
  }

  const usage = await prisma.aiUsage.findUnique({
    where: { orgId_periodStart: { orgId: input.orgId, periodStart } },
    select: { estimatedCostCents: true },
  });

  if (usage && monthlyBudget > 0) {
    try {
      await maybeSendAiQuotaAlerts({
        orgId: input.orgId,
        periodStart,
        usedCents: usage.estimatedCostCents,
        limitCents: monthlyBudget,
      });
    } catch (error) {
      console.warn("Failed to send conversational SMS AI quota alert email.", error);
    }
  }

  return true;
}

function buildStageInstruction(stage: ConversationStage): string {
  switch (stage) {
    case "ASKED_WORK":
      return "Extract the job type and any address or city if the customer included them. If details are incomplete, ask for the single next missing detail.";
    case "ASKED_ADDRESS":
      return "Extract the service address or city. If the customer is asking something else or refuses to text the address, prefer handoff.";
    case "ASKED_TIMEFRAME":
      return "Extract the timeframe into ASAP, THIS_WEEK, NEXT_WEEK, or QUOTE_ONLY. If unclear, ask one short timeframe question.";
    case "OFFERED_BOOKING":
      return "Choose slot A, B, or C only if clearly implied by the message or the offered labels. If the customer gives a custom time or needs discussion, prefer handoff.";
    default:
      return "Extract any useful intake details and keep the reply calm, short, and professional.";
  }
}

function buildPrompt(input: ConversationalSmsLlmInput): string {
  const playbook = input.organization.smsAgentPlaybook;
  const estimatorLabel = playbook.estimatorName || "the estimator";
  const callbackRule = playbook.useInboundPhoneAsCallback
    ? "The lead's SMS number is already the callback number on file unless the customer says to use a different number."
    : "If the org needs a better callback number than the SMS line, ask for it only when necessary.";
  return JSON.stringify(
    {
      goal:
        "Collect only the details needed to either book an estimate or leave a clean callback summary for a contractor. Be calm, sparse, professional, and capture structured CRM intake details accurately.",
      rules: [
        "Sound like a real office coordinator for a contractor, not a bot or a sales rep.",
        "Never be salesy, pushy, or repetitive.",
        "Use natural, plain-spoken wording and contractions when they fit.",
        "Ask at most one short question.",
        "If the customer already gave the needed detail, acknowledge it and move to the next step instead of asking again.",
        "Do not invent details.",
        callbackRule,
        "Before booking, make sure the CRM has the work needed and the service address or city.",
        "Set shouldHandoff=true when the customer wants a person, asks a question that needs a human, gives ambiguous scheduling, or needs custom discussion.",
        "Use selectedSlotId only when the customer clearly chose A, B, or C.",
        "replyBody should be a short, professional SMS and may be null.",
        "Return strict JSON only.",
      ],
      stageInstruction: buildStageInstruction(input.stage),
      context: {
        organizationName: input.organization.name,
        locale: input.lead.preferredLanguage || input.organization.messageLanguage,
        smsTone: input.organization.smsTone,
        stage: input.stage,
        known: {
          callbackNumberOnFile: input.lead.phoneE164,
          workSummary: input.workSummary || null,
          addressText: input.addressText || null,
          addressCity: input.addressCity || null,
          timeframe: input.timeframe || null,
        },
        bookingPreference: {
          preferredWindowStart: input.organization.workingHoursStart,
          preferredWindowEnd: input.organization.workingHoursEnd,
          estimatorName: playbook.estimatorName || null,
        },
        bookingOptions:
          input.bookingOptions?.map((option) => ({
            id: option.id,
            label: option.label,
          })) || [],
        replyStyle: {
          voice: "helpful front-desk teammate",
          workingHours: input.organization.smsWorkingHoursText || null,
          websiteSignature: input.organization.smsWebsiteSignature || null,
        },
        playbook: hasSmsAgentPlaybookDetails(playbook)
          ? {
              primaryGoal: playbook.primaryGoal || `Book estimate visits with ${estimatorLabel}.`,
              businessContext: playbook.businessContext || null,
              servicesSummary: playbook.servicesSummary || null,
              serviceAreaSummary: playbook.serviceAreaSummary || null,
              requiredDetails: playbook.requiredDetails || null,
              handoffTriggers: playbook.handoffTriggers || null,
              toneNotes: playbook.toneNotes || null,
              estimatorName: playbook.estimatorName || null,
              schedulingNotes: playbook.schedulingNotes || null,
              doNotPromise: playbook.doNotPromise || null,
              useInboundPhoneAsCallback: playbook.useInboundPhoneAsCallback,
            }
          : null,
        inboundBody: input.inboundBody,
      },
      outputSchema: {
        confidence: "number 0..1",
        workSummary: "string|null",
        addressText: "string|null",
        addressCity: "string|null",
        timeframe: "ASAP|THIS_WEEK|NEXT_WEEK|QUOTE_ONLY|null",
        selectedSlotId: "A|B|C|null",
        shouldHandoff: "boolean",
        replyBody: "string|null",
      },
    },
    null,
    2,
  );
}

export async function maybeInterpretConversationalSmsTurn(
  input: ConversationalSmsLlmInput,
): Promise<ConversationalSmsLlmDecision | null> {
  const runtime = resolveConversationalSmsLlmRuntimeConfig();
  if (!runtime.enabled || !runtime.apiKey) {
    return null;
  }

  const estimatedCostCents = getConversationalSmsEstimatedCostCents();
  const reserved = await reserveConversationalSmsAiQuota({
    orgId: input.organization.id,
    estimatedCostCents,
  });

  if (!reserved) {
    return null;
  }

  try {
    const client = new OpenAI({
      baseURL: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });

    const response = await client.responses.create({
      model: runtime.model,
      max_output_tokens: 400,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You help a home-service contractor qualify SMS leads. Keep replies calm, brief, professional, and non-pushy. Return strict JSON only.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPrompt(input),
            },
          ],
        },
      ],
    });

    const rawText = extractOpenAiText(response as OpenAiResponsesPayload);
    if (!rawText) {
      return null;
    }

    const parsed = JSON.parse(extractJsonBody(rawText));
    return normalizeConversationalSmsLlmDecision(parsed);
  } catch (error) {
    await capturePortalError(error, {
      feature: "conversational-sms-llm",
      orgId: input.organization.id,
      leadId: input.lead.id,
      stage: input.stage,
    });
    return null;
  }
}
