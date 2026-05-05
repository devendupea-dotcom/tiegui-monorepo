import assert from "node:assert/strict";
import test from "node:test";
import {
  containsLegacyTemplatePollution,
  sanitizeConversationMessageBody,
  sanitizeConversationSnippet,
} from "../lib/inbox-message-display.ts";

test("detects legacy placeholder and imported template pollution", () => {
  assert.equal(
    containsLegacyTemplatePollution("[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale."),
    true,
  );
  assert.equal(containsLegacyTemplatePollution("settings.ghostTemplateDefault"), true);
  assert.equal(containsLegacyTemplatePollution("Hey, can you quote my backyard cleanup?"), false);
});

test("sanitizes legacy imported bodies before they render in inbox threads", () => {
  assert.equal(
    sanitizeConversationMessageBody({
      body: "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale.",
      direction: "outbound",
      status: "SENT",
    }),
    "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale.",
  );

  assert.equal(
    sanitizeConversationMessageBody({
      body: "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale.",
      direction: "outbound",
      status: "FAILED",
    }),
    "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale.",
  );

  assert.equal(
    sanitizeConversationMessageBody({
      body: "settings.ghostTemplateDefault",
    }),
    "Legacy imported message hidden for clarity.",
  );
});

test("sanitizes list previews without changing normal customer messages", () => {
  assert.equal(
    sanitizeConversationSnippet({
      body: "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale.",
      status: "SENT",
      direction: "outbound",
    }),
    "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale.",
  );

  assert.equal(
    sanitizeConversationSnippet({
      body: "  Hey there, can you come by tomorrow morning for an estimate?  ",
      status: "DELIVERED",
    }),
    "Hey there, can you come by tomorrow morning for an estimate?",
  );

  assert.equal(
    sanitizeConversationSnippet({
      body: "Hey this is Velocity Landscapes LLC — sorry we missed you!",
      status: "FAILED",
    }),
    "Failed: Hey this is Velocity Landscapes LLC — sorry we missed you!",
  );
});
