import { Prisma, type InvoiceCheckoutSessionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { formatInvoiceNumber, recomputeInvoiceTotals, roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";
import { fromUnixSeconds } from "@/lib/recurring-billing";
import { getStripeClient, isStripeWebhookConfigured } from "@/lib/stripe-client";

const INVOICE_METADATA_KEY = "invoiceId";
const PAYMENT_FLOW_METADATA_KEY = "paymentFlow";
const PAYMENT_FLOW_VALUE = "invoice";
const DEFAULT_CURRENCY = "usd";

function getStripeAccountOptions(
  stripeAccountId: string,
): Stripe.RequestOptions {
  return {
    stripeAccount: stripeAccountId,
  };
}

function centsFromMoney(value: Prisma.Decimal | number | string): number {
  return Number(
    toMoneyDecimal(value)
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toString(),
  );
}

function getStripeObjectId(value: unknown): string | null {
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

export function formatInvoicePaymentFailureMessage(input: {
  message?: string | null;
  code?: string | null;
}): string {
  const message = input.message?.trim();
  if (message) {
    return message;
  }

  const code = input.code?.trim();
  if (code) {
    return `Stripe payment attempt failed (${code}).`;
  }

  return "Stripe payment attempt failed.";
}

export function isInvoiceOnlinePaymentReady(input: {
  stripeConnectionStatus?: string | null;
  webhookConfigured?: boolean;
  balanceDue: Prisma.Decimal | number | string;
}): boolean {
  return (
    input.stripeConnectionStatus === "ACTIVE" &&
    input.webhookConfigured !== false &&
    toMoneyDecimal(input.balanceDue).gt(0)
  );
}

async function getInvoiceStripeContext(input: {
  orgId: string;
  invoiceId: string;
}) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: input.invoiceId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      orgId: true,
      invoiceNumber: true,
      notes: true,
      balanceDue: true,
      status: true,
      dueDate: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      org: {
        select: {
          id: true,
          name: true,
          legalName: true,
          stripeConnection: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  if (!isStripeWebhookConfigured()) {
    throw new Error(
      "Stripe webhook sync is not configured yet. Set STRIPE_WEBHOOK_SECRET before using online invoice payments.",
    );
  }

  if (invoice.balanceDue.lte(0)) {
    throw new Error("Invoice does not have a balance due.");
  }

  const stripeConnection = invoice.org.stripeConnection;
  if (!stripeConnection || stripeConnection.status !== "ACTIVE") {
    throw new Error(
      "Stripe must be connected and ready for live charges before collecting invoice payments online.",
    );
  }

  return {
    invoice,
    stripeConnection,
    currency: DEFAULT_CURRENCY,
  };
}

async function findOpenInvoiceCheckoutSessions(input: {
  invoiceId: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  return prisma.invoiceCheckoutSession.findMany({
    where: {
      invoiceId: input.invoiceId,
      status: "OPEN",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

async function expireInvoiceCheckoutSessionAtProvider(input: {
  stripeCheckoutSessionId: string;
  stripeAccountId: string;
}) {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.expire(
    input.stripeCheckoutSessionId,
    {},
    getStripeAccountOptions(input.stripeAccountId),
  );
}

async function closeOpenInvoiceCheckoutSessions(input: {
  invoiceId: string;
  stripeAccountId: string;
  excludeStripeCheckoutSessionId?: string | null;
  localStatus: InvoiceCheckoutSessionStatus;
  localError?: string | null;
  closeLocallyOnProviderFailure?: boolean;
}) {
  const sessions = await findOpenInvoiceCheckoutSessions({
    invoiceId: input.invoiceId,
  });
  let closedCount = 0;

  for (const session of sessions) {
    if (
      input.excludeStripeCheckoutSessionId &&
      session.stripeCheckoutSessionId === input.excludeStripeCheckoutSessionId
    ) {
      continue;
    }

    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      await prisma.invoiceCheckoutSession.update({
        where: { id: session.id },
        data: {
          status: "EXPIRED",
          lastError: input.localError || session.lastError,
        },
      });
      closedCount += 1;
      continue;
    }

    try {
      const expired = await expireInvoiceCheckoutSessionAtProvider({
        stripeCheckoutSessionId: session.stripeCheckoutSessionId,
        stripeAccountId: input.stripeAccountId,
      });

      await prisma.invoiceCheckoutSession.update({
        where: { id: session.id },
        data: {
          status: expired.status === "expired" ? "EXPIRED" : input.localStatus,
          expiresAt: fromUnixSeconds(expired.expires_at) || session.expiresAt,
          lastError: input.localError || null,
        },
      });
      closedCount += 1;
    } catch (error) {
      await prisma.invoiceCheckoutSession.update({
        where: { id: session.id },
        data: {
          ...(input.closeLocallyOnProviderFailure
            ? { status: input.localStatus }
            : {}),
          lastError:
            error instanceof Error
              ? error.message
              : "Failed to expire the prior Stripe payment link.",
        },
      });
    }
  }

  return closedCount;
}

export async function cancelOpenInvoiceCheckoutSessionsForInvoice(input: {
  invoiceId: string;
  reason?: string;
}) {
  const reason =
    input.reason?.trim() ||
    "Invoice balance changed after this payment link was created.";
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
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

  if (!invoice) {
    return { canceledCount: 0 };
  }

  const stripeAccountId =
    invoice.org.stripeConnection?.stripeAccountId || null;

  if (!stripeAccountId) {
    const result = await prisma.invoiceCheckoutSession.updateMany({
      where: {
        invoiceId: invoice.id,
        status: "OPEN",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data: {
        status: "CANCELED",
        lastError: reason,
      },
    });

    return { canceledCount: result.count };
  }

  const canceledCount = await closeOpenInvoiceCheckoutSessions({
    invoiceId: invoice.id,
    stripeAccountId,
    localStatus: "CANCELED",
    localError: reason,
    closeLocallyOnProviderFailure: true,
  });

  return { canceledCount };
}

function buildInvoiceCheckoutUrls(input: {
  baseUrl: string;
  invoiceId: string;
}) {
  return {
    successUrl: `${input.baseUrl}/billing/invoices/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${input.baseUrl}/billing/invoices/cancel?invoiceId=${encodeURIComponent(input.invoiceId)}`,
  };
}

export async function ensureInvoiceCheckoutSessionForInvoice(input: {
  orgId: string;
  invoiceId: string;
  baseUrl: string;
  forceNew?: boolean;
}) {
  const stripe = getStripeClient();
  const { invoice, stripeConnection, currency } = await getInvoiceStripeContext(
    input,
  );
  const openSessions = await findOpenInvoiceCheckoutSessions({
    invoiceId: invoice.id,
  });

  const reusable = openSessions.find(
    (session) =>
      session.amount.equals(invoice.balanceDue) && session.currency === currency,
  );

  if (reusable && !input.forceNew) {
    return {
      checkoutSession: reusable,
      checkoutUrl: reusable.checkoutUrl,
      reused: true,
    };
  }

  if (openSessions.length > 0) {
    await closeOpenInvoiceCheckoutSessions({
      invoiceId: invoice.id,
      stripeAccountId: stripeConnection.stripeAccountId,
      localStatus: "CANCELED",
    });
  }

  const orgName = invoice.org.legalName?.trim() || invoice.org.name;
  const formattedInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
  const urls = buildInvoiceCheckoutUrls({
    baseUrl: input.baseUrl,
    invoiceId: invoice.id,
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      submit_type: "pay",
      payment_method_types: ["card"],
      client_reference_id: invoice.id,
      customer_email: invoice.customer.email?.trim() || undefined,
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: centsFromMoney(invoice.balanceDue),
            product_data: {
              name: `Invoice #${formattedInvoiceNumber}`,
              description:
                invoice.notes?.trim() ||
                `Payment for invoice #${formattedInvoiceNumber} from ${orgName}`,
            },
          },
        },
      ],
      billing_address_collection: "auto",
      metadata: {
        [PAYMENT_FLOW_METADATA_KEY]: PAYMENT_FLOW_VALUE,
        [INVOICE_METADATA_KEY]: invoice.id,
        orgId: invoice.orgId,
        invoiceNumber: formattedInvoiceNumber,
      },
      payment_intent_data: {
        metadata: {
          [PAYMENT_FLOW_METADATA_KEY]: PAYMENT_FLOW_VALUE,
          [INVOICE_METADATA_KEY]: invoice.id,
          orgId: invoice.orgId,
          invoiceNumber: formattedInvoiceNumber,
        },
        description: `Invoice #${formattedInvoiceNumber} from ${orgName}`,
      },
    },
    getStripeAccountOptions(stripeConnection.stripeAccountId),
  );

  if (!session.url) {
    throw new Error("Stripe did not return a hosted payment URL.");
  }

  const checkoutSession = await prisma.invoiceCheckoutSession.create({
    data: {
      invoiceId: invoice.id,
      amount: roundMoney(invoice.balanceDue),
      currency,
      status: "OPEN",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: getStripeObjectId(session.payment_intent),
      checkoutUrl: session.url,
      expiresAt: fromUnixSeconds(session.expires_at),
    },
  });

  return {
    checkoutSession,
    checkoutUrl: session.url,
    reused: false,
  };
}

async function resolveInvoiceForCheckoutSession(input: {
  session: Stripe.Checkout.Session;
  stripeAccountId?: string | null;
}) {
  const existing = await prisma.invoiceCheckoutSession.findUnique({
    where: {
      stripeCheckoutSessionId: input.session.id,
    },
    include: {
      invoice: {
        select: {
          id: true,
          orgId: true,
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
      },
    },
  });

  if (
    existing &&
    (!input.stripeAccountId ||
      existing.invoice.org.stripeConnection?.stripeAccountId ===
        input.stripeAccountId)
  ) {
    return {
      invoiceId: existing.invoiceId,
      orgId: existing.invoice.orgId,
      stripeAccountId:
        existing.invoice.org.stripeConnection?.stripeAccountId || null,
    };
  }

  const invoiceId =
    input.session.metadata?.[INVOICE_METADATA_KEY] ||
    input.session.client_reference_id;
  if (!invoiceId) {
    return null;
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
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
    select: {
      id: true,
      orgId: true,
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

  if (!invoice) {
    return null;
  }

  return {
    invoiceId: invoice.id,
    orgId: invoice.orgId,
    stripeAccountId: invoice.org.stripeConnection?.stripeAccountId || null,
  };
}

async function resolveInvoiceCheckoutSessionForPaymentIntent(input: {
  paymentIntent: Stripe.PaymentIntent;
  stripeAccountId?: string | null;
}) {
  const invoiceIdFromMetadata =
    input.paymentIntent.metadata?.[INVOICE_METADATA_KEY] || null;
  const sessionWhereClauses: Prisma.InvoiceCheckoutSessionWhereInput[] = [
    { stripePaymentIntentId: input.paymentIntent.id },
  ];

  if (invoiceIdFromMetadata) {
    sessionWhereClauses.push({
      invoiceId: invoiceIdFromMetadata,
      status: "OPEN",
    });
  }

  const existing = await prisma.invoiceCheckoutSession.findFirst({
    where: {
      OR: sessionWhereClauses,
      ...(input.stripeAccountId
        ? {
            invoice: {
              org: {
                stripeConnection: {
                  is: {
                    stripeAccountId: input.stripeAccountId,
                  },
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });

  if (existing) {
    return existing;
  }

  const invoiceId = invoiceIdFromMetadata;
  if (!invoiceId) {
    return null;
  }
  return prisma.invoiceCheckoutSession.findFirst({
    where: {
      invoiceId,
      status: "OPEN",
      ...(input.stripeAccountId
        ? {
            invoice: {
              org: {
                stripeConnection: {
                  is: {
                    stripeAccountId: input.stripeAccountId,
                  },
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

function isInvoiceCheckoutSession(
  session: Stripe.Checkout.Session,
): boolean {
  return (
    session.mode === "payment" &&
    session.metadata?.[PAYMENT_FLOW_METADATA_KEY] === PAYMENT_FLOW_VALUE
  );
}

export async function markInvoiceCheckoutSessionExpired(
  session: Stripe.Checkout.Session,
  stripeAccountId?: string | null,
) {
  if (!isInvoiceCheckoutSession(session)) {
    return null;
  }

  const invoiceRef = await resolveInvoiceForCheckoutSession({
    session,
    stripeAccountId,
  });

  if (!invoiceRef) {
    return null;
  }

  return prisma.invoiceCheckoutSession.upsert({
    where: {
      stripeCheckoutSessionId: session.id,
    },
    update: {
      invoiceId: invoiceRef.invoiceId,
      amount: roundMoney(
        new Prisma.Decimal((session.amount_total || 0) / 100),
      ),
      currency: (session.currency || DEFAULT_CURRENCY).toLowerCase(),
      status: "EXPIRED",
      stripePaymentIntentId: getStripeObjectId(session.payment_intent),
      checkoutUrl: session.url || "",
      expiresAt: fromUnixSeconds(session.expires_at),
      lastError: null,
    },
    create: {
      invoiceId: invoiceRef.invoiceId,
      amount: roundMoney(
        new Prisma.Decimal((session.amount_total || 0) / 100),
      ),
      currency: (session.currency || DEFAULT_CURRENCY).toLowerCase(),
      status: "EXPIRED",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: getStripeObjectId(session.payment_intent),
      checkoutUrl: session.url || "",
      expiresAt: fromUnixSeconds(session.expires_at),
    },
  });
}

export async function syncInvoicePaymentFromCheckoutSession(
  session: Stripe.Checkout.Session,
  stripeAccountId?: string | null,
) {
  if (!isInvoiceCheckoutSession(session)) {
    return null;
  }

  const invoiceRef = await resolveInvoiceForCheckoutSession({
    session,
    stripeAccountId,
  });

  if (!invoiceRef) {
    return null;
  }

  const amount = roundMoney(
    new Prisma.Decimal((session.amount_total || 0) / 100),
  );
  const paymentIntentId = getStripeObjectId(session.payment_intent);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.invoiceCheckoutSession.upsert({
      where: {
        stripeCheckoutSessionId: session.id,
      },
      update: {
        invoiceId: invoiceRef.invoiceId,
        amount,
        currency: (session.currency || DEFAULT_CURRENCY).toLowerCase(),
        status: session.payment_status === "paid" ? "COMPLETED" : "OPEN",
        stripePaymentIntentId: paymentIntentId,
        checkoutUrl: session.url || "",
        expiresAt: fromUnixSeconds(session.expires_at),
        completedAt: session.payment_status === "paid" ? now : null,
        lastError: null,
      },
      create: {
        invoiceId: invoiceRef.invoiceId,
        amount,
        currency: (session.currency || DEFAULT_CURRENCY).toLowerCase(),
        status: session.payment_status === "paid" ? "COMPLETED" : "OPEN",
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        checkoutUrl: session.url || "",
        expiresAt: fromUnixSeconds(session.expires_at),
        completedAt: session.payment_status === "paid" ? now : null,
      },
    });

    if (session.payment_status === "paid" && amount.gt(0)) {
      await tx.invoicePayment.upsert({
        where: {
          stripeCheckoutSessionId: session.id,
        },
        update: {
          amount,
          date: now,
          method: "STRIPE",
          note: "Paid online via Stripe Checkout.",
          stripePaymentIntentId: paymentIntentId,
        },
        create: {
          invoiceId: invoiceRef.invoiceId,
          amount,
          date: now,
          method: "STRIPE",
          note: "Paid online via Stripe Checkout.",
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
        },
      });

      await recomputeInvoiceTotals(tx, invoiceRef.invoiceId);
    }
  });

  if (session.payment_status === "paid" && invoiceRef.stripeAccountId) {
    await closeOpenInvoiceCheckoutSessions({
      invoiceId: invoiceRef.invoiceId,
      stripeAccountId: invoiceRef.stripeAccountId,
      excludeStripeCheckoutSessionId: session.id,
      localStatus: "CANCELED",
    });
  }

  return prisma.invoiceCheckoutSession.findUnique({
    where: {
      stripeCheckoutSessionId: session.id,
    },
  });
}

export async function syncInvoiceCheckoutFailureFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  stripeAccountId?: string | null,
) {
  if (paymentIntent.metadata?.[PAYMENT_FLOW_METADATA_KEY] !== PAYMENT_FLOW_VALUE) {
    return null;
  }

  const checkoutSession = await resolveInvoiceCheckoutSessionForPaymentIntent({
    paymentIntent,
    stripeAccountId,
  });

  if (!checkoutSession) {
    return null;
  }

  const failureMessage = formatInvoicePaymentFailureMessage({
    message: paymentIntent.last_payment_error?.message || null,
    code: paymentIntent.last_payment_error?.code || null,
  });

  return prisma.invoiceCheckoutSession.update({
    where: { id: checkoutSession.id },
    data: {
      status:
        checkoutSession.status === "COMPLETED"
          ? "COMPLETED"
          : paymentIntent.status === "canceled"
            ? "CANCELED"
            : "OPEN",
      stripePaymentIntentId: paymentIntent.id,
      lastError: failureMessage,
    },
  });
}
