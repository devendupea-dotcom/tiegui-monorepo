import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRecurringChargeLabel,
  formatRecurringIntervalLabel,
  isRecurringBillingInterval,
  mapStripeSubscriptionStatus,
} from "../lib/recurring-billing.ts";
import {
  shouldApplyRecurringCheckoutSessionCompletion,
} from "../lib/stripe-recurring.ts";

test("recurring billing interval guard only accepts supported intervals", () => {
  assert.equal(isRecurringBillingInterval("MONTH"), true);
  assert.equal(isRecurringBillingInterval("WEEK"), true);
  assert.equal(isRecurringBillingInterval("hour"), false);
});

test("recurring billing labels stay operator-readable", () => {
  assert.equal(formatRecurringIntervalLabel("MONTH", 1), "Every month");
  assert.equal(formatRecurringIntervalLabel("WEEK", 2), "Every 2 weeks");
  assert.equal(
    formatRecurringChargeLabel({
      amount: "125.00",
      interval: "MONTH",
      intervalCount: 1,
    }),
    "$125.00 · every month",
  );
});

test("stripe subscription statuses collapse into the app plan lifecycle", () => {
  assert.equal(mapStripeSubscriptionStatus("active"), "ACTIVE");
  assert.equal(mapStripeSubscriptionStatus("trialing"), "ACTIVE");
  assert.equal(mapStripeSubscriptionStatus("past_due"), "PAUSED");
  assert.equal(mapStripeSubscriptionStatus("unpaid"), "PAUSED");
  assert.equal(mapStripeSubscriptionStatus("incomplete"), "PENDING_ACTIVATION");
  assert.equal(mapStripeSubscriptionStatus("canceled"), "CANCELED");
});

test("recurring checkout completion ignores canceled and stale checkout sessions", () => {
  assert.equal(
    shouldApplyRecurringCheckoutSessionCompletion({
      planStatus: "PENDING_ACTIVATION",
      savedCheckoutSessionId: "cs_current",
      incomingCheckoutSessionId: "cs_current",
    }),
    true,
  );
  assert.equal(
    shouldApplyRecurringCheckoutSessionCompletion({
      planStatus: "PENDING_ACTIVATION",
      savedCheckoutSessionId: "cs_current",
      incomingCheckoutSessionId: "cs_old",
    }),
    false,
  );
  assert.equal(
    shouldApplyRecurringCheckoutSessionCompletion({
      planStatus: "CANCELED",
      savedCheckoutSessionId: "cs_current",
      incomingCheckoutSessionId: "cs_current",
    }),
    false,
  );
});
