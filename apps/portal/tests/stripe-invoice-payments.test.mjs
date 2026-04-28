import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInvoicePaymentFailureMessage,
  isInvoiceOnlinePaymentReady,
} from "../lib/stripe-invoice-payments.ts";

test("invoice online payment readiness requires active Stripe, webhook sync, and a positive balance", () => {
  assert.equal(
    isInvoiceOnlinePaymentReady({
      stripeConnectionStatus: "ACTIVE",
      webhookConfigured: true,
      balanceDue: "125.00",
    }),
    true,
  );

  assert.equal(
    isInvoiceOnlinePaymentReady({
      stripeConnectionStatus: "PENDING",
      webhookConfigured: true,
      balanceDue: "125.00",
    }),
    false,
  );

  assert.equal(
    isInvoiceOnlinePaymentReady({
      stripeConnectionStatus: "ACTIVE",
      webhookConfigured: false,
      balanceDue: "125.00",
    }),
    false,
  );

  assert.equal(
    isInvoiceOnlinePaymentReady({
      stripeConnectionStatus: "ACTIVE",
      webhookConfigured: true,
      balanceDue: "0.00",
    }),
    false,
  );
});

test("invoice payment failure messages prefer Stripe detail and fall back cleanly", () => {
  assert.equal(
    formatInvoicePaymentFailureMessage({
      message: "Your card was declined.",
      code: "card_declined",
    }),
    "Your card was declined.",
  );

  assert.equal(
    formatInvoicePaymentFailureMessage({
      message: "",
      code: "expired_card",
    }),
    "Stripe payment attempt failed (expired_card).",
  );

  assert.equal(
    formatInvoicePaymentFailureMessage({}),
    "Stripe payment attempt failed.",
  );
});
