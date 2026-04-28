import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMessagingOpsTriageCreateRows,
  buildMessagingOpsTriageSets,
  countUnacceptedMessagingOpsIssues,
  normalizeMessagingOpsTriageNote,
  normalizeMessagingOpsTriageReason,
} from "../lib/messaging-ops-triage.ts";

test("accepted triage rows split failed messages from unmatched callbacks", () => {
  const sets = buildMessagingOpsTriageSets([
    {
      targetType: "FAILED_SMS_MESSAGE",
      targetId: "message_1",
    },
    {
      targetType: "UNMATCHED_STATUS_CALLBACK",
      targetId: "event_1",
    },
  ]);

  assert.equal(sets.failedSmsMessageIds.has("message_1"), true);
  assert.equal(sets.unmatchedStatusCallbackIds.has("event_1"), true);
  assert.equal(sets.failedSmsMessageIds.has("event_1"), false);
});

test("unaccepted issue counts exclude reviewed backlog", () => {
  const result = countUnacceptedMessagingOpsIssues({
    failedMessages: [{ id: "message_1" }, { id: "message_2" }],
    unmatchedCallbacks: [{ id: "event_1" }, { id: "event_2" }],
    triageRows: [
      { targetType: "FAILED_SMS_MESSAGE", targetId: "message_1" },
      { targetType: "UNMATCHED_STATUS_CALLBACK", targetId: "event_1" },
    ],
  });

  assert.deepEqual(
    result.activeFailedMessages.map((message) => message.id),
    ["message_2"],
  );
  assert.deepEqual(
    result.activeUnmatchedCallbacks.map((event) => event.id),
    ["event_2"],
  );
  assert.equal(result.acceptedFailedSmsCount, 1);
  assert.equal(result.acceptedUnmatchedCallbackCount, 1);
});

test("create rows skip already accepted targets and keep safe metadata", () => {
  const createdAt = new Date("2026-04-28T12:00:00.000Z");
  const rows = buildMessagingOpsTriageCreateRows({
    orgId: "org_1",
    reason: "ACCEPTED_FOR_CONTROLLED_ROLLOUT",
    note: "Reviewed bad-number test backlog",
    decidedByUserId: "user_1",
    failedMessages: [
      { id: "message_1", createdAt },
      { id: "message_2", createdAt },
    ],
    unmatchedCallbacks: [{ id: "event_1", createdAt }],
    triageRows: [{ targetType: "FAILED_SMS_MESSAGE", targetId: "message_1" }],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => `${row.targetType}:${row.targetId}`).sort(),
    ["FAILED_SMS_MESSAGE:message_2", "UNMATCHED_STATUS_CALLBACK:event_1"],
  );
  assert.equal(rows[0].reason, "ACCEPTED_FOR_CONTROLLED_ROLLOUT");
  assert.equal(rows[0].decidedByUserId, "user_1");
});

test("triage reason and notes are normalized conservatively", () => {
  assert.equal(
    normalizeMessagingOpsTriageReason("BAD_DESTINATION_NUMBER"),
    "BAD_DESTINATION_NUMBER",
  );
  assert.equal(normalizeMessagingOpsTriageReason("bad"), null);
  assert.equal(normalizeMessagingOpsTriageNote("  reviewed   safely  "), "reviewed safely");
  assert.equal(normalizeMessagingOpsTriageNote(""), null);
  assert.equal(normalizeMessagingOpsTriageNote("x".repeat(400))?.length, 280);
});
