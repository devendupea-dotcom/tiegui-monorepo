import assert from "node:assert/strict";
import test from "node:test";
import { sendTwilioMessageWithConfig } from "../lib/twilio-org.ts";

const config = {
  twilioSubaccountSid: "AC123",
  twilioAuthToken: "token",
  messagingServiceSid: "MG123",
};

test("Twilio outbound timeout is treated as unknown provider acceptance", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (_url, init = {}) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal;
      const rejectAbort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) {
        rejectAbort();
        return;
      }
      signal?.addEventListener("abort", rejectAbort, { once: true });
    });

  const result = await sendTwilioMessageWithConfig({
    config,
    toNumberE164: "+15551234567",
    body: "On my way.",
    requestTimeoutMs: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.requestTimedOut, true);
  assert.equal(result.providerAcceptedUnknown, true);
  assert.equal(result.providerErrorCode, "TIEGUI_TIMEOUT");
  assert.match(result.error, /may have been accepted/i);
  assert.equal(result.failure?.blocksAutomationRetry, true);
  assert.equal(result.failure?.retryRecommended, false);
});

test("Twilio permanent failure surfaces operator-readable retry blocking", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 21614,
        message: "To number is not a valid mobile number.",
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );

  const result = await sendTwilioMessageWithConfig({
    config,
    toNumberE164: "+15551234567",
    body: "On my way.",
  });

  assert.equal(result.ok, false);
  assert.equal(result.providerErrorCode, "21614");
  assert.equal(result.failure?.category, "BAD_NUMBER");
  assert.equal(result.failure?.blocksAutomationRetry, true);
  assert.match(result.failure?.operatorDetail || "", /Verify the customer phone number/i);
});

test("Twilio retryable failure is reported without blocking later automation", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 20429,
        message: "Too many requests.",
      }),
      {
        status: 429,
        headers: { "content-type": "application/json" },
      },
    );

  const result = await sendTwilioMessageWithConfig({
    config,
    toNumberE164: "+15551234567",
    body: "On my way.",
  });

  assert.equal(result.ok, false);
  assert.equal(result.providerErrorCode, "20429");
  assert.equal(result.failure?.category, "RATE_LIMIT");
  assert.equal(result.failure?.retryRecommended, true);
  assert.equal(result.failure?.blocksAutomationRetry, false);
});
