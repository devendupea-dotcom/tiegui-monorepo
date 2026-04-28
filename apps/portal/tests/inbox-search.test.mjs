import assert from "node:assert/strict";
import test from "node:test";
import { matchesInboxConversationSearch } from "../lib/inbox-search.ts";

const sampleConversation = {
  contactName: "Jane Doe",
  phoneE164: "+1 (503) 555-0101",
  lastSnippet: "Can you text me a quote later today?",
};

test("inbox search matches contact names case-insensitively", () => {
  assert.equal(matchesInboxConversationSearch(sampleConversation, "jane"), true);
  assert.equal(matchesInboxConversationSearch(sampleConversation, "DOE"), true);
});

test("inbox search matches phone digits even when formatting differs", () => {
  assert.equal(matchesInboxConversationSearch(sampleConversation, "5035550101"), true);
  assert.equal(matchesInboxConversationSearch(sampleConversation, "555-0101"), true);
});

test("inbox search matches phone queries with or without a leading country code", () => {
  assert.equal(matchesInboxConversationSearch(sampleConversation, "15035550101"), true);
  assert.equal(
    matchesInboxConversationSearch(
      {
        ...sampleConversation,
        phoneE164: "5035550101",
      },
      "+1 503 555 0101",
    ),
    true,
  );
});

test("inbox search can match the latest snippet and rejects unrelated queries", () => {
  assert.equal(matchesInboxConversationSearch(sampleConversation, "quote later"), true);
  assert.equal(matchesInboxConversationSearch(sampleConversation, "unrelated"), false);
});
