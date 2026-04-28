import assert from "node:assert/strict";
import test from "node:test";
import { resolveTwilioMessagingReadiness } from "../lib/twilio-readiness.ts";

test("twilio readiness requires an active config plus live send env", () => {
  assert.deepEqual(
    resolveTwilioMessagingReadiness({
      twilioConfig: {
        phoneNumber: "+12065550100",
        status: "ACTIVE",
      },
      env: {
        sendEnabled: true,
        tokenEncryptionKeyPresent: true,
      },
    }),
    {
      code: "ACTIVE",
      canSend: true,
      hasConfig: true,
      sendEnabled: true,
      tokenEncryptionKeyPresent: true,
    },
  );
});

test("twilio readiness stays blocked when the workspace is pending A2P", () => {
  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: {
      phoneNumber: "+12065550100",
      status: "PENDING_A2P",
    },
    env: {
      sendEnabled: true,
      tokenEncryptionKeyPresent: true,
    },
  });

  assert.equal(readiness.code, "PENDING_A2P");
  assert.equal(readiness.canSend, false);
});

test("twilio readiness stays blocked when sending is disabled in the deployment", () => {
  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: {
      phoneNumber: "+12065550100",
      status: "ACTIVE",
    },
    env: {
      sendEnabled: false,
      tokenEncryptionKeyPresent: true,
    },
  });

  assert.equal(readiness.code, "SEND_DISABLED");
  assert.equal(readiness.canSend, false);
});

test("twilio readiness stays blocked when the token encryption key is missing", () => {
  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: {
      phoneNumber: "+12065550100",
      status: "ACTIVE",
    },
    env: {
      sendEnabled: true,
      tokenEncryptionKeyPresent: false,
    },
  });

  assert.equal(readiness.code, "TOKEN_KEY_MISSING");
  assert.equal(readiness.canSend, false);
});

test("twilio readiness reports setup missing when the workspace has no phone config", () => {
  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: null,
    env: {
      sendEnabled: true,
      tokenEncryptionKeyPresent: true,
    },
  });

  assert.equal(readiness.code, "NOT_CONFIGURED");
  assert.equal(readiness.hasConfig, false);
  assert.equal(readiness.canSend, false);
});
