import assert from "node:assert/strict";
import test from "node:test";
import { deriveCommunicationEventRepairPlan } from "../lib/communication-integrity-repair.ts";

test("deriveCommunicationEventRepairPlan repairs lead, contact, and conversation when transport can resolve the lead", () => {
  const plan = deriveCommunicationEventRepairPlan({
    leadId: null,
    contactId: null,
    conversationId: null,
    linkedLeadId: "lead-1",
    leadCustomerId: "customer-1",
    leadConversationId: "conversation-1",
  });

  assert.equal(plan.canRepair, true);
  assert.deepEqual(plan.missingFields, [
    "leadId",
    "contactId",
    "conversationId",
  ]);
  assert.deepEqual(plan.repairedFields, [
    "leadId",
    "contactId",
    "conversationId",
  ]);
  assert.deepEqual(plan.unresolvedFields, []);
  assert.equal(plan.nextLeadId, "lead-1");
  assert.equal(plan.nextContactId, "customer-1");
  assert.equal(plan.nextConversationId, "conversation-1");
  assert.equal(plan.needsConversationCreate, false);
});

test("deriveCommunicationEventRepairPlan can still restore lead and conversation when contact remains unknown", () => {
  const plan = deriveCommunicationEventRepairPlan({
    leadId: null,
    contactId: null,
    conversationId: null,
    linkedLeadId: "lead-1",
    leadCustomerId: null,
    leadConversationId: null,
  });

  assert.equal(plan.canRepair, true);
  assert.deepEqual(plan.repairedFields, ["leadId", "conversationId"]);
  assert.deepEqual(plan.unresolvedFields, ["contactId"]);
  assert.equal(plan.needsConversationCreate, true);
});

test("deriveCommunicationEventRepairPlan stays unrepaired when no lead can be resolved", () => {
  const plan = deriveCommunicationEventRepairPlan({
    leadId: null,
    contactId: null,
    conversationId: null,
    linkedLeadId: null,
    leadCustomerId: null,
    leadConversationId: null,
  });

  assert.equal(plan.canRepair, false);
  assert.deepEqual(plan.repairedFields, []);
  assert.deepEqual(plan.unresolvedFields, [
    "leadId",
    "contactId",
    "conversationId",
  ]);
  assert.equal(plan.needsConversationCreate, false);
});
