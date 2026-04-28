import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  resolveTwilioWebhookValidationMode,
  validateTwilioWebhook,
} from "../lib/twilio.ts";

async function withEnv(overrides, callback) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildSignedTwilioRequest(input) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input.params)) {
    formData.append(key, value);
  }

  let payload = input.url;
  for (const key of Object.keys(input.params).sort()) {
    payload += key + input.params[key];
  }

  const signature = createHmac("sha1", input.authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  const request = new Request(input.url, {
    method: "POST",
    headers: {
      "x-twilio-signature": signature,
    },
  });

  return { request, formData };
}

test("Twilio webhooks fail closed in production when signature validation is missing", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      VERCEL_ENV: undefined,
      TWILIO_VALIDATE_SIGNATURE: undefined,
      TWILIO_ALLOW_UNSIGNED_WEBHOOKS: undefined,
    },
    async () => {
      assert.equal(resolveTwilioWebhookValidationMode(), "reject");
      const result = validateTwilioWebhook(
        new Request("https://app.example.com/api/webhooks/twilio/sms", { method: "POST" }),
        new FormData(),
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, 500);
    },
  );
});

test("Twilio webhooks fail closed in production when signature validation is false", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      VERCEL_ENV: undefined,
      TWILIO_VALIDATE_SIGNATURE: "false",
      TWILIO_ALLOW_UNSIGNED_WEBHOOKS: "true",
    },
    async () => {
      assert.equal(resolveTwilioWebhookValidationMode(), "reject");
      const result = validateTwilioWebhook(
        new Request("https://app.example.com/api/webhooks/twilio/sms", { method: "POST" }),
        new FormData(),
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, 500);
    },
  );
});

test("Twilio webhooks validate normally in production with a valid signature", async () => {
  const authToken = "test-auth-token";
  const url = "https://app.example.com/api/webhooks/twilio/sms";
  const { request, formData } = buildSignedTwilioRequest({
    url,
    authToken,
    params: {
      AccountSid: "AC123",
      Body: "hello",
      From: "+12065550199",
      MessageSid: "SM123",
      To: "+12065550100",
    },
  });

  await withEnv(
    {
      NODE_ENV: "production",
      VERCEL_ENV: undefined,
      TWILIO_VALIDATE_SIGNATURE: "true",
      TWILIO_ALLOW_UNSIGNED_WEBHOOKS: undefined,
    },
    async () => {
      assert.equal(resolveTwilioWebhookValidationMode(), "validate");
      assert.deepEqual(validateTwilioWebhook(request, formData, { authToken }), { ok: true });
    },
  );
});

test("Twilio unsigned webhook bypass is explicit and non-production only", async () => {
  await withEnv(
    {
      NODE_ENV: "test",
      VERCEL_ENV: undefined,
      TWILIO_VALIDATE_SIGNATURE: "false",
      TWILIO_ALLOW_UNSIGNED_WEBHOOKS: undefined,
    },
    async () => {
      assert.equal(resolveTwilioWebhookValidationMode(), "reject");
    },
  );

  await withEnv(
    {
      NODE_ENV: "test",
      VERCEL_ENV: undefined,
      TWILIO_VALIDATE_SIGNATURE: "false",
      TWILIO_ALLOW_UNSIGNED_WEBHOOKS: "true",
    },
    async () => {
      assert.equal(resolveTwilioWebhookValidationMode(), "bypass");
      const result = validateTwilioWebhook(
        new Request("https://app.example.com/api/webhooks/twilio/sms", { method: "POST" }),
        new FormData(),
      );
      assert.deepEqual(result, { ok: true });
    },
  );
});
