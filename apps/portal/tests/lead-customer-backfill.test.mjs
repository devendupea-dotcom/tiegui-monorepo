import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLeadCustomerBackfill,
  pickLeadCustomerBackfillName,
} from "../lib/lead-customer-backfill.ts";

test("lead customer backfill attaches a single exact existing customer", () => {
  assert.deepEqual(
    classifyLeadCustomerBackfill({
      phoneE164: "+12535550123",
      blockedPhone: false,
      exactCustomerIds: ["customer-1"],
      conflictingCustomerIds: [],
    }),
    {
      kind: "attach_existing_customer",
      canApply: true,
      customerId: "customer-1",
    },
  );
});

test("lead customer backfill blocks ambiguous, conflicting, and blocked-phone groups", () => {
  assert.deepEqual(
    classifyLeadCustomerBackfill({
      phoneE164: "+12535550123",
      blockedPhone: false,
      exactCustomerIds: ["customer-1", "customer-2"],
      conflictingCustomerIds: [],
    }),
    {
      kind: "ambiguous_existing_customer",
      canApply: false,
      customerIds: ["customer-1", "customer-2"],
    },
  );

  assert.deepEqual(
    classifyLeadCustomerBackfill({
      phoneE164: "+12535550123",
      blockedPhone: false,
      exactCustomerIds: [],
      conflictingCustomerIds: ["customer-9"],
    }),
    {
      kind: "conflicting_linked_customer",
      canApply: false,
      customerIds: ["customer-9"],
    },
  );

  assert.deepEqual(
    classifyLeadCustomerBackfill({
      phoneE164: "+12535550123",
      blockedPhone: true,
      exactCustomerIds: [],
      conflictingCustomerIds: [],
    }),
    {
      kind: "blocked_phone",
      canApply: false,
    },
  );
});

test("lead customer backfill name selection prefers contact, then business, then phone fallback", () => {
  assert.equal(
    pickLeadCustomerBackfillName({
      phoneE164: "+12535550123",
      leads: [
        {
          id: "lead-2",
          contactName: null,
          businessName: "Shop",
          createdAt: new Date("2026-04-10T12:00:00.000Z"),
        },
        {
          id: "lead-1",
          contactName: "Pat Doe",
          businessName: null,
          createdAt: new Date("2026-04-09T12:00:00.000Z"),
        },
      ],
    }),
    "Pat Doe",
  );

  assert.equal(
    pickLeadCustomerBackfillName({
      phoneE164: "+12535550123",
      leads: [
        {
          id: "lead-3",
          contactName: "   ",
          businessName: "Acme Glass",
          createdAt: new Date("2026-04-11T12:00:00.000Z"),
        },
      ],
    }),
    "Acme Glass",
  );

  assert.equal(
    pickLeadCustomerBackfillName({
      phoneE164: "+12535550123",
      leads: [
        {
          id: "lead-4",
          contactName: null,
          businessName: null,
          createdAt: new Date("2026-04-12T12:00:00.000Z"),
        },
      ],
    }),
    "+12535550123",
  );
});
