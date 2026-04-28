import Stripe from "stripe";
import { normalizeEnvValue } from "@/lib/env";

let stripeClient: Stripe | null = null;

function getStripeSecretKey(): string {
  const value = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);
  if (!value) {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }
  return value;
}

export function getStripeWebhookSecret(): string {
  const value = normalizeEnvValue(process.env.STRIPE_WEBHOOK_SECRET);
  if (!value) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required.");
  }
  return value;
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(normalizeEnvValue(process.env.STRIPE_WEBHOOK_SECRET));
}

export function getStripeClient(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  stripeClient = new Stripe(getStripeSecretKey());
  return stripeClient;
}
