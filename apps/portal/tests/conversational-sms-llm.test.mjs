import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationalSmsLlmCacheKey,
  getConversationalSmsLlmRuntimeSummary,
} from "../lib/conversational-sms-llm.ts";

test("runtime summary auto-enables conversational SMS when Azure credentials are present", () => {
  const summary = getConversationalSmsLlmRuntimeSummary({
    AZURE_OPENAI_API_KEY: "test-key",
    AZURE_OPENAI_ENDPOINT: "https://tiegui-ai.openai.azure.com/",
  });

  assert.equal(summary.configured, true);
  assert.equal(summary.enabled, true);
  assert.equal(summary.mode, "auto");
  assert.equal(summary.model, "sms-agent");
  assert.equal(summary.baseUrl, "https://tiegui-ai.openai.azure.com/openai/v1/");
  assert.equal(summary.endpointOrigin, "https://tiegui-ai.openai.azure.com");
});

test("runtime summary honors explicit off even when Azure credentials are present", () => {
  const summary = getConversationalSmsLlmRuntimeSummary({
    CONVERSATIONAL_SMS_LLM_ENABLED: "false",
    AZURE_OPENAI_API_KEY: "test-key",
    AZURE_OPENAI_ENDPOINT: "https://tiegui-ai.openai.azure.com/openai/v1/",
    OPENAI_CONVERSATIONAL_SMS_MODEL: "sms-agent",
  });

  assert.equal(summary.configured, true);
  assert.equal(summary.enabled, false);
  assert.equal(summary.mode, "explicit_off");
  assert.equal(summary.model, "sms-agent");
});

test("llm cache key changes when the reply stage or booking options change", () => {
  const baseInput = {
    organization: {
      id: "org_1",
      messageLanguage: "EN",
      smsTone: "FRIENDLY",
      workingHoursStart: "09:00",
      workingHoursEnd: "17:00",
      smsAgentPlaybook: {
        primaryGoal: "",
        businessContext: "",
        servicesSummary: "",
        serviceAreaSummary: "",
        requiredDetails: "",
        handoffTriggers: "",
        toneNotes: "",
        estimatorName: "",
        schedulingNotes: "",
        doNotPromise: "",
        useInboundPhoneAsCallback: true,
      },
    },
    lead: {
      id: "lead_1",
      preferredLanguage: null,
    },
    stage: "ASKED_TIMEFRAME",
    inboundBody: "Next week works for us",
    workSummary: "Retaining wall",
    addressText: "123 Main St",
    addressCity: "Tacoma",
    timeframe: "NEXT_WEEK",
    bookingOptions: [],
  };

  const timeframeKey = buildConversationalSmsLlmCacheKey(baseInput);
  const bookingKey = buildConversationalSmsLlmCacheKey({
    ...baseInput,
    stage: "OFFERED_BOOKING",
    bookingOptions: [{ id: "A", label: "A) Tue 9:00am" }],
  });

  assert.notEqual(timeframeKey, bookingKey);
});

test("llm cache key changes when the org playbook changes", () => {
  const baseInput = {
    organization: {
      id: "org_1",
      messageLanguage: "EN",
      smsTone: "FRIENDLY",
      workingHoursStart: "09:00",
      workingHoursEnd: "17:00",
      smsAgentPlaybook: {
        primaryGoal: "",
        businessContext: "",
        servicesSummary: "",
        serviceAreaSummary: "",
        requiredDetails: "",
        handoffTriggers: "",
        toneNotes: "",
        estimatorName: "",
        schedulingNotes: "",
        doNotPromise: "",
        useInboundPhoneAsCallback: true,
      },
    },
    lead: {
      id: "lead_1",
      preferredLanguage: null,
    },
    stage: "ASKED_TIMEFRAME",
    inboundBody: "Next week works for us",
    workSummary: "Retaining wall",
    addressText: "123 Main St",
    addressCity: "Tacoma",
    timeframe: "NEXT_WEEK",
    bookingOptions: [],
  };

  const defaultKey = buildConversationalSmsLlmCacheKey(baseInput);
  const customizedKey = buildConversationalSmsLlmCacheKey({
    ...baseInput,
    organization: {
      ...baseInput.organization,
      smsAgentPlaybook: {
        ...baseInput.organization.smsAgentPlaybook,
        estimatorName: "Cesar",
        primaryGoal: "Book estimate visits",
      },
    },
  });

  assert.notEqual(defaultKey, customizedKey);
});
