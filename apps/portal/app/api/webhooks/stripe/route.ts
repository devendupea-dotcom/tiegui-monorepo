import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe-client";
import { saveOrganizationStripeConnection } from "@/lib/integrations/stripe-connect";
import {
  syncRecurringPlanFromCheckoutSession,
  syncRecurringPlanFromInvoicePaid,
  syncRecurringPlanFromInvoicePaymentFailed,
  syncRecurringPlanFromSubscription,
} from "@/lib/stripe-recurring";
import {
  markInvoiceCheckoutSessionExpired,
  syncInvoiceCheckoutFailureFromPaymentIntent,
  syncInvoicePaymentFromCheckoutSession,
} from "@/lib/stripe-invoice-payments";

export const dynamic = "force-dynamic";

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapStripeAccountSummary(account: Stripe.Account, livemode: boolean) {
  return {
    stripeAccountId: account.id,
    email: getString(account.email) || getString(account.business_profile?.support_email),
    displayName:
      getString(account.business_profile?.name) ||
      getString(account.settings?.dashboard?.display_name) ||
      getString((account as { display_name?: string | null }).display_name),
    country: getString(account.country),
    defaultCurrency: getString(account.default_currency),
    livemode,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  };
}

async function handleAccountUpdated(account: Stripe.Account, livemode: boolean) {
  const connection = await prisma.organizationStripeConnection.findUnique({
    where: {
      stripeAccountId: account.id,
    },
    select: {
      orgId: true,
    },
  });

  if (!connection) {
    return;
  }

  await saveOrganizationStripeConnection({
    orgId: connection.orgId,
    summary: mapStripeAccountSummary(account, livemode),
  });
}

async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "account.updated":
      await handleAccountUpdated(
        event.data.object as Stripe.Account,
        event.livemode === true,
      );
      break;
    case "checkout.session.completed":
      {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") {
          await syncRecurringPlanFromCheckoutSession(
            session,
            event.account || null,
          );
        } else if (session.mode === "payment") {
          await syncInvoicePaymentFromCheckoutSession(
            session,
            event.account || null,
          );
        }
      }
      break;
    case "checkout.session.expired":
      await markInvoiceCheckoutSessionExpired(
        event.data.object as Stripe.Checkout.Session,
        event.account || null,
      );
      break;
    case "payment_intent.payment_failed":
      await syncInvoiceCheckoutFailureFromPaymentIntent(
        event.data.object as Stripe.PaymentIntent,
        event.account || null,
      );
      break;
    case "invoice.paid":
      await syncRecurringPlanFromInvoicePaid(
        event.data.object as Stripe.Invoice,
        event.account || null,
      );
      break;
    case "invoice.payment_failed":
      await syncRecurringPlanFromInvoicePaymentFailed(
        event.data.object as Stripe.Invoice,
        event.account || null,
      );
      break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncRecurringPlanFromSubscription(
        event.data.object as Stripe.Subscription,
        event.account || null,
      );
      break;
    default:
      break;
  }
}

export async function POST(req: Request) {
  const stripeSignature = req.headers.get("stripe-signature");
  if (!stripeSignature) {
    return NextResponse.json(
      { ok: false, error: "Missing Stripe signature." },
      { status: 400 },
    );
  }

  const payload = await req.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      stripeSignature,
      getStripeWebhookSecret(),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Webhook signature verification failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    await handleStripeEvent(event);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[stripe:webhook] handler failed", error);
    const message =
      error instanceof Error ? error.message : "Stripe webhook handling failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
