import { Prisma, type RecurringServicePlanStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { toMoneyDecimal } from "@/lib/invoices";
import {
  fromUnixSeconds,
  mapStripeSubscriptionStatus,
  recurringIntervalToStripe,
} from "@/lib/recurring-billing";
import { getStripeClient } from "@/lib/stripe-client";

const CHECKOUT_MODE = "subscription";
const PLAN_METADATA_KEY = "recurringServicePlanId";

function centsFromMoney(value: Prisma.Decimal | number | string): number {
  return Number(
    toMoneyDecimal(value)
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toString(),
  );
}

function getStripeAccountOptions(
  stripeAccountId: string,
): Stripe.RequestOptions {
  return {
    stripeAccount: stripeAccountId,
  };
}

export function shouldApplyRecurringCheckoutSessionCompletion(input: {
  planStatus: RecurringServicePlanStatus;
  savedCheckoutSessionId?: string | null;
  incomingCheckoutSessionId: string;
}): boolean {
  if (input.planStatus === "CANCELED") {
    return false;
  }

  if (
    input.savedCheckoutSessionId &&
    input.savedCheckoutSessionId !== input.incomingCheckoutSessionId
  ) {
    return false;
  }

  return true;
}

async function expireOpenRecurringCheckoutSession(input: {
  stripeCheckoutSessionId: string | null;
  stripeAccountId: string;
}) {
  if (!input.stripeCheckoutSessionId) {
    return;
  }

  const stripe = getStripeClient();
  const requestOptions = getStripeAccountOptions(input.stripeAccountId);
  const session = await stripe.checkout.sessions.retrieve(
    input.stripeCheckoutSessionId,
    {},
    requestOptions,
  );

  if (session.status === "complete") {
    throw new Error(
      "The previous recurring checkout link was already completed. Wait for Stripe webhook sync before changing this plan.",
    );
  }

  if (session.status !== "open") {
    return;
  }

  await stripe.checkout.sessions.expire(
    input.stripeCheckoutSessionId,
    {},
    requestOptions,
  );
}

async function getPlanStripeContext(input: {
  orgId: string;
  planId: string;
}) {
  const plan = await prisma.recurringServicePlan.findFirst({
    where: {
      id: input.planId,
      orgId: input.orgId,
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phoneE164: true,
        },
      },
      org: {
        select: {
          id: true,
          name: true,
          stripeConnection: true,
        },
      },
    },
  });

  if (!plan) {
    throw new Error("Recurring plan not found.");
  }

  const stripeConnection = plan.org.stripeConnection;
  if (!stripeConnection || stripeConnection.status !== "ACTIVE") {
    throw new Error(
      "Stripe must be connected and ready for live charges before creating recurring billing.",
    );
  }

  return {
    plan,
    stripeConnection,
  };
}

async function ensureStripeCatalogForPlan(input: {
  plan: Awaited<ReturnType<typeof getPlanStripeContext>>["plan"];
  stripeAccountId: string;
}) {
  const stripe = getStripeClient();
  const requestOptions = getStripeAccountOptions(input.stripeAccountId);

  let stripeProductId = input.plan.stripeProductId;
  if (!stripeProductId) {
    const product = await stripe.products.create(
      {
        name: input.plan.name,
        description: input.plan.description || undefined,
        metadata: {
          [PLAN_METADATA_KEY]: input.plan.id,
          orgId: input.plan.orgId,
          customerId: input.plan.customerId,
        },
      },
      requestOptions,
    );
    stripeProductId = product.id;
  }

  let stripePriceId = input.plan.stripePriceId;
  if (!stripePriceId) {
    const price = await stripe.prices.create(
      {
        currency: input.plan.currency.toLowerCase(),
        unit_amount: centsFromMoney(input.plan.amount),
        recurring: {
          interval: recurringIntervalToStripe(input.plan.interval),
          interval_count: input.plan.intervalCount,
        },
        product: stripeProductId,
        metadata: {
          [PLAN_METADATA_KEY]: input.plan.id,
          orgId: input.plan.orgId,
          customerId: input.plan.customerId,
        },
      },
      requestOptions,
    );
    stripePriceId = price.id;
  }

  return {
    stripeProductId,
    stripePriceId,
  };
}

export async function createRecurringCheckoutSessionForPlan(input: {
  orgId: string;
  planId: string;
  baseUrl: string;
}) {
  const stripe = getStripeClient();
  const { plan, stripeConnection } = await getPlanStripeContext(input);

  if (plan.status === "CANCELED") {
    throw new Error("Canceled plans cannot generate a new checkout link.");
  }

  if (plan.stripeSubscriptionId) {
    throw new Error(
      "This recurring plan already has a Stripe subscription. Cancel the existing subscription before creating a new checkout link.",
    );
  }

  const catalog = await ensureStripeCatalogForPlan({
    plan,
    stripeAccountId: stripeConnection.stripeAccountId,
  });

  await expireOpenRecurringCheckoutSession({
    stripeCheckoutSessionId: plan.stripeCheckoutSessionId,
    stripeAccountId: stripeConnection.stripeAccountId,
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: CHECKOUT_MODE,
      client_reference_id: plan.id,
      success_url: `${input.baseUrl}/billing/recurring/${plan.id}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.baseUrl}/billing/recurring/${plan.id}/cancel`,
      customer_email: plan.customer.email || undefined,
      line_items: [
        {
          price: catalog.stripePriceId,
          quantity: 1,
        },
      ],
      billing_address_collection: "auto",
      metadata: {
        [PLAN_METADATA_KEY]: plan.id,
        orgId: plan.orgId,
        customerId: plan.customerId,
      },
      subscription_data: {
        metadata: {
          [PLAN_METADATA_KEY]: plan.id,
          orgId: plan.orgId,
          customerId: plan.customerId,
        },
      },
    },
    getStripeAccountOptions(stripeConnection.stripeAccountId),
  );

  if (!session.url) {
    throw new Error("Stripe did not return a hosted checkout URL.");
  }

  const updatedPlan = await prisma.recurringServicePlan.update({
    where: { id: plan.id },
    data: {
      stripeProductId: catalog.stripeProductId,
      stripePriceId: catalog.stripePriceId,
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
      checkoutExpiresAt: fromUnixSeconds(session.expires_at),
      status: "PENDING_ACTIVATION",
      lastError: null,
    },
  });

  return {
    plan: updatedPlan,
    checkoutUrl: session.url,
  };
}

export async function cancelRecurringPlan(input: {
  orgId: string;
  planId: string;
}) {
  const { plan, stripeConnection } = await getPlanStripeContext(input);
  const now = new Date();

  if (!plan.stripeSubscriptionId) {
    await expireOpenRecurringCheckoutSession({
      stripeCheckoutSessionId: plan.stripeCheckoutSessionId,
      stripeAccountId: stripeConnection.stripeAccountId,
    });

    return prisma.recurringServicePlan.update({
      where: { id: plan.id },
      data: {
        status: "CANCELED",
        canceledAt: now,
        checkoutUrl: null,
        checkoutExpiresAt: null,
        lastError: null,
      },
    });
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.cancel(
    plan.stripeSubscriptionId,
    {},
    getStripeAccountOptions(stripeConnection.stripeAccountId),
  );

  return prisma.recurringServicePlan.update({
    where: { id: plan.id },
    data: {
      status: "CANCELED",
      canceledAt: fromUnixSeconds(subscription.canceled_at) || now,
      nextBillingAt: null,
      lastError: null,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id || plan.stripeCustomerId,
    },
  });
}

function getInvoicePeriodBounds(invoice: Stripe.Invoice): {
  periodStart: Date | null;
  periodEnd: Date | null;
} {
  const line = invoice.lines.data.find(
    (entry) => Boolean(entry.period?.start) || Boolean(entry.period?.end),
  );

  return {
    periodStart: fromUnixSeconds(line?.period?.start),
    periodEnd: fromUnixSeconds(line?.period?.end),
  };
}

function getStripeObjectId(
  value: unknown,
): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.trim()
  ) {
    return value.id.trim();
  }

  return null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parentSubscriptionId = getStripeObjectId(
    invoice.parent?.subscription_details?.subscription,
  );
  if (parentSubscriptionId) {
    return parentSubscriptionId;
  }

  return getStripeObjectId(
    (invoice as unknown as { subscription?: unknown }).subscription,
  );
}

function getInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const paymentIntentId = getStripeObjectId(
    invoice.payments?.data.find((payment) => payment.payment.type === "payment_intent")
      ?.payment.payment_intent,
  );
  if (paymentIntentId) {
    return paymentIntentId;
  }

  return getStripeObjectId(
    (invoice as unknown as { payment_intent?: unknown }).payment_intent,
  );
}

function getSubscriptionNextBillingAt(
  subscription: Stripe.Subscription,
): Date | null {
  const latestItemPeriodEnd = subscription.items.data.reduce<number | null>(
    (latest, item) => {
      if (!Number.isFinite(item.current_period_end)) {
        return latest;
      }
      return latest === null
        ? item.current_period_end
        : Math.max(latest, item.current_period_end);
    },
    null,
  );

  return fromUnixSeconds(latestItemPeriodEnd);
}

async function findPlanForStripeSubscription(input: {
  subscriptionId: string | null;
  stripeAccountId?: string | null;
}) {
  if (!input.subscriptionId) {
    return null;
  }

  const plan = await prisma.recurringServicePlan.findFirst({
    where: {
      stripeSubscriptionId: input.subscriptionId,
      ...(input.stripeAccountId
        ? {
            org: {
              stripeConnection: {
                is: {
                  stripeAccountId: input.stripeAccountId,
                },
              },
            },
          }
        : {}),
    },
    include: {
      org: {
        select: {
          stripeConnection: {
            select: {
              stripeAccountId: true,
            },
          },
        },
      },
    },
  });

  return plan;
}

export async function syncRecurringPlanFromCheckoutSession(
  session: Stripe.Checkout.Session,
  stripeAccountId?: string | null,
) {
  const planId = session.metadata?.[PLAN_METADATA_KEY] || session.client_reference_id;
  if (!planId) {
    return null;
  }

  const plan = await prisma.recurringServicePlan.findFirst({
    where: {
      id: planId,
      ...(stripeAccountId
        ? {
            org: {
              stripeConnection: {
                is: {
                  stripeAccountId,
                },
              },
            },
          }
        : {}),
    },
  });

  if (!plan) {
    return null;
  }

  if (
    !shouldApplyRecurringCheckoutSessionCompletion({
      planStatus: plan.status,
      savedCheckoutSessionId: plan.stripeCheckoutSessionId,
      incomingCheckoutSessionId: session.id,
    })
  ) {
    return null;
  }

  return prisma.recurringServicePlan.update({
    where: { id: plan.id },
    data: {
      status: "ACTIVE",
      startsAt: fromUnixSeconds(session.created),
      stripeCustomerId:
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id || plan.stripeCustomerId,
      stripeSubscriptionId:
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || plan.stripeSubscriptionId,
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url || plan.checkoutUrl,
      checkoutExpiresAt: fromUnixSeconds(session.expires_at),
      lastError: null,
    },
  });
}

export async function syncRecurringPlanFromInvoicePaid(
  invoice: Stripe.Invoice,
  stripeAccountId?: string | null,
) {
  const plan = await findPlanForStripeSubscription({
    subscriptionId: getInvoiceSubscriptionId(invoice),
    stripeAccountId,
  });

  if (!plan) {
    return null;
  }

  const amountPaid = centsFromMoney((invoice.amount_paid || 0) / 100);
  const bounds = getInvoicePeriodBounds(invoice);

  await prisma.recurringBillingCharge.upsert({
    where: {
      stripeInvoiceId: invoice.id,
    },
    update: {
      amount: new Prisma.Decimal(amountPaid).div(100).toDecimalPlaces(
        2,
        Prisma.Decimal.ROUND_HALF_UP,
      ),
      currency: (invoice.currency || plan.currency || "usd").toLowerCase(),
      status: "SUCCEEDED",
      chargedAt:
        fromUnixSeconds(invoice.status_transitions?.paid_at) || new Date(),
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
      receiptUrl: invoice.hosted_invoice_url || null,
      failureCode: null,
      failureMessage: null,
    },
    create: {
      recurringServicePlanId: plan.id,
      amount: new Prisma.Decimal(amountPaid).div(100).toDecimalPlaces(
        2,
        Prisma.Decimal.ROUND_HALF_UP,
      ),
      currency: (invoice.currency || plan.currency || "usd").toLowerCase(),
      status: "SUCCEEDED",
      chargedAt:
        fromUnixSeconds(invoice.status_transitions?.paid_at) || new Date(),
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
      receiptUrl: invoice.hosted_invoice_url || null,
    },
  });

  return prisma.recurringServicePlan.update({
    where: { id: plan.id },
    data: {
      status: "ACTIVE",
      nextBillingAt: bounds.periodEnd,
      lastError: null,
      stripeCustomerId:
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id || plan.stripeCustomerId,
    },
  });
}

export async function syncRecurringPlanFromInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  stripeAccountId?: string | null,
) {
  const plan = await findPlanForStripeSubscription({
    subscriptionId: getInvoiceSubscriptionId(invoice),
    stripeAccountId,
  });

  if (!plan) {
    return null;
  }

  const amountDueDecimal = new Prisma.Decimal(invoice.amount_due || 0)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const bounds = getInvoicePeriodBounds(invoice);
  const failureMessage = "Automatic recurring payment failed.";

  await prisma.recurringBillingCharge.upsert({
    where: {
      stripeInvoiceId: invoice.id,
    },
    update: {
      amount: amountDueDecimal,
      currency: (invoice.currency || plan.currency || "usd").toLowerCase(),
      status: "FAILED",
      chargedAt: new Date(),
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
      failureCode: "payment_failed",
      failureMessage,
    },
    create: {
      recurringServicePlanId: plan.id,
      amount: amountDueDecimal,
      currency: (invoice.currency || plan.currency || "usd").toLowerCase(),
      status: "FAILED",
      chargedAt: new Date(),
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
      failureCode: "payment_failed",
      failureMessage,
    },
  });

  return prisma.recurringServicePlan.update({
    where: { id: plan.id },
    data: {
      status: "PAUSED",
      lastError: failureMessage,
      stripeCustomerId:
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id || plan.stripeCustomerId,
    },
  });
}

export async function syncRecurringPlanFromSubscription(
  subscription: Stripe.Subscription,
  stripeAccountId?: string | null,
) {
  const plan = await findPlanForStripeSubscription({
    subscriptionId: subscription.id,
    stripeAccountId,
  });

  if (!plan) {
    return null;
  }

  const mappedStatus: RecurringServicePlanStatus = mapStripeSubscriptionStatus(
    subscription.status,
  );

  return prisma.recurringServicePlan.update({
    where: { id: plan.id },
    data: {
      status: mappedStatus,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id || plan.stripeCustomerId,
      nextBillingAt: getSubscriptionNextBillingAt(subscription),
      canceledAt:
        mappedStatus === "CANCELED"
          ? fromUnixSeconds(subscription.canceled_at) || new Date()
          : null,
      lastError: mappedStatus === "ACTIVE" ? null : plan.lastError,
    },
  });
}
