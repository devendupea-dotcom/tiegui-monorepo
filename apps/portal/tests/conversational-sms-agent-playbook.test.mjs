import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSmsAgentPlaybook } from "../lib/conversational-sms-agent-playbook.ts";

test("normalizeSmsAgentPlaybook keeps org guidance and defaults callback policy on", () => {
  const playbook = normalizeSmsAgentPlaybook({
    primaryGoal: "Book on-site estimates",
    estimatorName: "Cesar",
    requiredDetails: "Service address, project type, and any gate code",
  });

  assert.equal(playbook.primaryGoal, "Book on-site estimates");
  assert.equal(playbook.estimatorName, "Cesar");
  assert.equal(playbook.requiredDetails, "Service address, project type, and any gate code");
  assert.equal(playbook.useInboundPhoneAsCallback, true);
});

test("normalizeSmsAgentPlaybook trims noise and respects an explicit callback override", () => {
  const playbook = normalizeSmsAgentPlaybook({
    primaryGoal: "  Book estimates later in the day  ",
    toneNotes: "  Friendly, calm, not salesy.  ",
    useInboundPhoneAsCallback: false,
  });

  assert.equal(playbook.primaryGoal, "Book estimates later in the day");
  assert.equal(playbook.toneNotes, "Friendly, calm, not salesy.");
  assert.equal(playbook.useInboundPhoneAsCallback, false);
});
