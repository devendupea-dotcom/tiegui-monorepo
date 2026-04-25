import Link from "next/link";
import { headers } from "next/headers";
import { Prisma, type RecurringBillingInterval } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createRecurringCheckoutSessionForPlan,
  cancelRecurringPlan,
} from "@/lib/stripe-recurring";
import {
  formatRecurringChargeLabel,
  formatRecurringIntervalLabel,
  fromUnixSeconds,
  isRecurringBillingInterval,
  recurringBillingIntervalOptions,
} from "@/lib/recurring-billing";
import { formatCurrency, parseMoneyInput } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";
import { getConfiguredBaseUrl } from "@/lib/urls";
import { isStripeWebhookConfigured } from "@/lib/stripe-client";
import { formatDateTime, formatLabel } from "@/lib/hq";
import {
  getParam,
  requireAppOrgActor,
  resolveAppScope,
  withOrgQuery,
} from "../../_lib/portal-scope";
import { requireAppPageViewer } from "../../_lib/portal-viewer";

export const dynamic = "force-dynamic";

function canManageBilling(input: {
  internalUser: boolean;
  calendarAccessRole: "OWNER" | "ADMIN" | "WORKER" | "READ_ONLY";
}): boolean {
  return (
    input.internalUser ||
    input.calendarAccessRole === "OWNER" ||
    input.calendarAccessRole === "ADMIN"
  );
}

function appendQuery(path: string, key: string, value: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

async function getServerActionBaseUrl(): Promise<string> {
  const headerStore = await headers();
  const forwardedProto = headerStore
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = headerStore
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host =
    forwardedHost || headerStore.get("host")?.split(",")[0]?.trim() || null;

  if (host) {
    return `${forwardedProto || "https"}://${host}`;
  }

  return getConfiguredBaseUrl() || "http://localhost:3001";
}

async function requireRecurringBillingActor(formData: FormData) {
  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/invoices");
  }

  const actor = await requireAppOrgActor("/app/invoices/recurring", orgId);
  const returnPath = withOrgQuery(
    "/app/invoices/recurring",
    orgId,
    actor.internalUser,
  );

  if (
    !canManageBilling({
      internalUser: actor.internalUser,
      calendarAccessRole: actor.calendarAccessRole,
    })
  ) {
    redirect(appendQuery(returnPath, "error", "unauthorized"));
  }

  return { actor, orgId, returnPath };
}

async function createRecurringPlanAction(formData: FormData) {
  "use server";

  const scoped = await requireRecurringBillingActor(formData);
  const customerId = String(formData.get("customerId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const amountRaw = String(formData.get("amount") || "").trim();
  const intervalRaw = String(formData.get("interval") || "").trim().toUpperCase();
  const intervalCountRaw = String(formData.get("intervalCount") || "").trim();

  if (!isStripeWebhookConfigured()) {
    redirect(appendQuery(scoped.returnPath, "error", "webhook-not-configured"));
  }

  if (!customerId || !name || !isRecurringBillingInterval(intervalRaw)) {
    redirect(appendQuery(scoped.returnPath, "error", "invalid-plan"));
  }

  const amount = parseMoneyInput(amountRaw);
  const intervalCount = Number.parseInt(intervalCountRaw, 10);
  if (!amount || amount.lte(0) || !Number.isFinite(intervalCount) || intervalCount < 1 || intervalCount > 12) {
    redirect(appendQuery(scoped.returnPath, "error", "invalid-plan"));
  }

  const stripeConnection = await prisma.organizationStripeConnection.findUnique({
    where: { orgId: scoped.orgId },
    select: {
      id: true,
      status: true,
      defaultCurrency: true,
    },
  });

  if (!stripeConnection || stripeConnection.status !== "ACTIVE") {
    redirect(appendQuery(scoped.returnPath, "error", "stripe-not-ready"));
  }

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      orgId: scoped.orgId,
    },
    select: {
      id: true,
    },
  });

  if (!customer) {
    redirect(appendQuery(scoped.returnPath, "error", "invalid-plan"));
  }

  const plan = await prisma.recurringServicePlan.create({
    data: {
      orgId: scoped.orgId,
      customerId,
      createdByUserId: scoped.actor.id ?? null,
      name,
      description: description || null,
      amount,
      currency: (stripeConnection.defaultCurrency || "usd").toLowerCase(),
      interval: intervalRaw,
      intervalCount,
      status: "DRAFT",
    },
    select: { id: true },
  });

  try {
    await createRecurringCheckoutSessionForPlan({
      orgId: scoped.orgId,
      planId: plan.id,
      baseUrl: await getServerActionBaseUrl(),
    });

    revalidatePath("/app/invoices");
    revalidatePath("/app/invoices/recurring");
    redirect(appendQuery(scoped.returnPath, "saved", "created"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the recurring plan.";
    await prisma.recurringServicePlan.update({
      where: { id: plan.id },
      data: {
        lastError: message,
      },
    });
    revalidatePath("/app/invoices/recurring");
    redirect(appendQuery(scoped.returnPath, "error", "checkout-failed"));
  }
}

async function regenerateCheckoutAction(formData: FormData) {
  "use server";

  const scoped = await requireRecurringBillingActor(formData);
  const planId = String(formData.get("planId") || "").trim();
  if (!planId) {
    redirect(appendQuery(scoped.returnPath, "error", "invalid-plan"));
  }

  if (!isStripeWebhookConfigured()) {
    redirect(appendQuery(scoped.returnPath, "error", "webhook-not-configured"));
  }

  try {
    await createRecurringCheckoutSessionForPlan({
      orgId: scoped.orgId,
      planId,
      baseUrl: await getServerActionBaseUrl(),
    });
    revalidatePath("/app/invoices/recurring");
    redirect(appendQuery(scoped.returnPath, "saved", "checkout"));
  } catch {
    redirect(appendQuery(scoped.returnPath, "error", "checkout-failed"));
  }
}

async function cancelRecurringPlanAction(formData: FormData) {
  "use server";

  const scoped = await requireRecurringBillingActor(formData);
  const planId = String(formData.get("planId") || "").trim();
  if (!planId) {
    redirect(appendQuery(scoped.returnPath, "error", "invalid-plan"));
  }

  try {
    await cancelRecurringPlan({
      orgId: scoped.orgId,
      planId,
    });
    revalidatePath("/app/invoices/recurring");
    redirect(appendQuery(scoped.returnPath, "saved", "canceled"));
  } catch {
    redirect(appendQuery(scoped.returnPath, "error", "cancel-failed"));
  }
}

export default async function RecurringBillingPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);
  const scope = await resolveAppScope({
    nextPath: "/app/invoices/recurring",
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/invoices/recurring",
    orgId: scope.orgId,
  });
  const canManage = canManageBilling({
    internalUser: viewer.internalUser,
    calendarAccessRole: viewer.calendarAccessRole,
  });

  const [organization, stripeConnection, customers, plans] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: { id: true, name: true },
    }),
    prisma.organizationStripeConnection.findUnique({
      where: { orgId: scope.orgId },
    }),
    prisma.customer.findMany({
      where: { orgId: scope.orgId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneE164: true,
      },
      orderBy: [{ name: "asc" }],
      take: 300,
    }),
    prisma.recurringServicePlan.findMany({
      where: { orgId: scope.orgId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneE164: true,
          },
        },
        charges: {
          orderBy: [{ createdAt: "desc" }],
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }),
  ]);

  if (!organization) {
    redirect(scope.internalUser ? "/hq/businesses" : "/app");
  }

  const recurringRuntimeReady = isStripeWebhookConfigured();
  const stripeReady = stripeConnection?.status === "ACTIVE";
  const createReady =
    Boolean(canManage && recurringRuntimeReady && stripeReady && customers.length > 0);
  const integrationsPath = withOrgQuery(
    "/app/settings/integrations",
    scope.orgId,
    scope.internalUser,
  );
  const invoicesPath = withOrgQuery(
    "/app/invoices",
    scope.orgId,
    scope.internalUser,
  );

  const savedMessage =
    saved === "created"
      ? "Recurring plan created and hosted checkout link generated."
      : saved === "checkout"
        ? "A fresh hosted checkout link is ready to share."
        : saved === "canceled"
          ? "Recurring plan canceled."
          : null;
  const errorMessage =
    error === "unauthorized"
      ? "Only owners and admins can manage recurring billing."
      : error === "webhook-not-configured"
        ? "Recurring billing is blocked until STRIPE_WEBHOOK_SECRET is configured."
        : error === "stripe-not-ready"
          ? "Stripe must be connected and fully active before creating recurring plans."
          : error === "checkout-failed"
            ? "Could not generate the hosted subscription checkout link."
            : error === "cancel-failed"
              ? "Could not cancel the recurring plan."
              : error === "invalid-plan"
                ? "The recurring billing form is incomplete or invalid."
                : null;

  return (
    <>
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <Link className="table-link" href={invoicesPath}>
              ← Back to Invoices
            </Link>
            <h2>Recurring Billing</h2>
            <p className="muted">
              Set up fixed weekly, monthly, or yearly plans and send customers
              to Stripe-hosted subscription checkout.
            </p>
          </div>
          <div className="quick-links">
            <Link className="btn secondary" href={integrationsPath}>
              Stripe Settings
            </Link>
          </div>
        </div>

        <div className="quick-meta" style={{ marginTop: 12 }}>
          <span className={`badge ${stripeReady ? "status-paid" : "status-overdue"}`}>
            Stripe: {stripeConnection?.status || "NOT_CONNECTED"}
          </span>
          <span
            className={`badge ${recurringRuntimeReady ? "status-paid" : "status-overdue"}`}
          >
            Webhook: {recurringRuntimeReady ? "Configured" : "Missing"}
          </span>
          <span className="badge">Customers: {customers.length}</span>
          <span className="badge">Plans: {plans.length}</span>
        </div>

        {!stripeReady ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            Stripe isn&apos;t ready for recurring billing yet. Finish Connect onboarding or
            refresh Stripe status in Settings.
          </p>
        ) : null}
        {!recurringRuntimeReady ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            STRIPE_WEBHOOK_SECRET is missing. Don&apos;t sell recurring billing until webhook
            sync is live.
          </p>
        ) : null}
        {!canManage ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            You can review recurring plans here, but only owners and admins can create or cancel them.
          </p>
        ) : null}
        {savedMessage ? <p className="form-status">{savedMessage}</p> : null}
        {errorMessage ? <p className="form-status">{errorMessage}</p> : null}
      </section>

      <section className="grid">
        <article className="card">
          <h3 style={{ marginTop: 0 }}>Create recurring plan</h3>
          <p className="muted">
            This creates a fixed-price subscription and gives you a Stripe-hosted
            signup link to share with the customer.
          </p>

          {customers.length === 0 ? (
            <div className="portal-empty-state" style={{ marginTop: 16 }}>
              <strong>No customers are ready for recurring billing yet.</strong>
              <p className="muted">
                Convert a lead into a customer first, then come back here to set up a plan.
              </p>
              <div className="portal-empty-actions">
                <Link className="btn primary" href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}>
                  Open Leads
                </Link>
              </div>
            </div>
          ) : (
            <form action={createRecurringPlanAction} className="auth-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="orgId" value={scope.orgId} />

              <label>
                Customer
                <select name="customerId" defaultValue="">
                  <option value="" disabled>
                    Select customer
                  </option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.email ? ` · ${customer.email}` : ""}
                      {!customer.email && customer.phoneE164
                        ? ` · ${customer.phoneE164}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Plan name
                <input
                  name="name"
                  placeholder="Monthly service plan"
                  maxLength={120}
                />
              </label>

              <label>
                Description
                <textarea
                  name="description"
                  rows={3}
                  maxLength={500}
                  placeholder="What this recurring service covers."
                />
              </label>

              <label>
                Amount
                <input
                  name="amount"
                  inputMode="decimal"
                  placeholder="125.00"
                />
              </label>

              <div className="grid" style={{ gap: 12 }}>
                <label>
                  Interval
                  <select name="interval" defaultValue="MONTH">
                    {recurringBillingIntervalOptions.map((interval) => (
                      <option key={interval} value={interval}>
                        {formatLabel(interval)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Every
                  <input
                    name="intervalCount"
                    type="number"
                    min="1"
                    max="12"
                    defaultValue="1"
                  />
                </label>
              </div>

              <button className="btn primary" type="submit" disabled={!createReady}>
                Create plan and generate checkout
              </button>
            </form>
          )}
        </article>

        <article className="card">
          <h3 style={{ marginTop: 0 }}>What this ships today</h3>
          <ul className="list">
            <li>Fixed-price recurring plans per customer.</li>
            <li>Stripe-hosted subscription checkout links you can share manually.</li>
            <li>Webhook sync for activation, successful payments, failures, and cancellations.</li>
            <li>Office-side cancel flow from this workspace.</li>
          </ul>
          <p className="muted" style={{ marginTop: 12 }}>
            Next expansion after this is one-time online invoice pay links and automated customer send flows.
          </p>
        </article>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Recurring plans</h3>
        {plans.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No recurring plans yet.</strong>
            <p className="muted">
              Create the first plan above to generate a hosted Stripe signup link.
            </p>
          </div>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {plans.map((plan) => {
              const latestCharge = plan.charges[0] || null;
              const canCancel =
                canManage &&
                plan.status !== "CANCELED";
              const canRefreshCheckout =
                canManage &&
                plan.status !== "CANCELED" &&
                !plan.stripeSubscriptionId;

              return (
                <article key={plan.id} className="card" style={{ margin: 0 }}>
                  <div className="invoice-header-row">
                    <div className="stack-cell">
                      <h4 style={{ margin: 0 }}>{plan.name}</h4>
                      <span className="muted">
                        {plan.customer.name}
                        {plan.customer.email ? ` · ${plan.customer.email}` : ""}
                      </span>
                    </div>
                    <span className={`badge status-${plan.status.toLowerCase()}`}>
                      {formatLabel(plan.status)}
                    </span>
                  </div>

                  <p style={{ marginTop: 12, marginBottom: 0 }}>
                    <strong>
                      {formatRecurringChargeLabel({
                        amount: plan.amount,
                        interval: plan.interval as RecurringBillingInterval,
                        intervalCount: plan.intervalCount,
                      })}
                    </strong>
                  </p>

                  {plan.description ? (
                    <p className="muted" style={{ marginTop: 8 }}>
                      {plan.description}
                    </p>
                  ) : null}

                  <div className="quick-meta" style={{ marginTop: 12 }}>
                    <span className="badge">
                      Next billing: {plan.nextBillingAt ? formatDateTime(plan.nextBillingAt) : "Pending"}
                    </span>
                    <span className="badge">
                      Started: {plan.startsAt ? formatDateTime(plan.startsAt) : "Not active yet"}
                    </span>
                    <span className="badge">
                      Cadence: {formatRecurringIntervalLabel(plan.interval as RecurringBillingInterval, plan.intervalCount)}
                    </span>
                  </div>

                  {plan.checkoutUrl && plan.status === "PENDING_ACTIVATION" ? (
                    <div style={{ marginTop: 12 }}>
                      <a
                        className="btn secondary"
                        href={plan.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open hosted checkout
                      </a>
                      <p className="muted" style={{ marginTop: 10, wordBreak: "break-all" }}>
                        Share link: {plan.checkoutUrl}
                      </p>
                      <p className="muted">
                        Expires: {plan.checkoutExpiresAt ? formatDateTime(plan.checkoutExpiresAt) : "Stripe-managed"}
                      </p>
                    </div>
                  ) : null}

                  {latestCharge ? (
                    <div style={{ marginTop: 12 }}>
                      <p className="muted" style={{ margin: 0 }}>
                        Latest charge: {formatCurrency(latestCharge.amount)} · {formatLabel(latestCharge.status)}
                      </p>
                      <p className="muted" style={{ marginTop: 6 }}>
                        {latestCharge.chargedAt ? formatDateTime(latestCharge.chargedAt) : "Awaiting charge result"}
                      </p>
                    </div>
                  ) : null}

                  {plan.lastError ? (
                    <p className="form-status" style={{ marginTop: 12 }}>
                      {plan.lastError}
                    </p>
                  ) : null}

                  <div className="quick-links" style={{ marginTop: 12 }}>
                    {canRefreshCheckout ? (
                      <form action={regenerateCheckoutAction}>
                        <input type="hidden" name="orgId" value={scope.orgId} />
                        <input type="hidden" name="planId" value={plan.id} />
                        <button className="btn secondary" type="submit">
                          {plan.checkoutUrl && plan.status === "PENDING_ACTIVATION"
                            ? "Refresh checkout link"
                            : "Generate checkout link"}
                        </button>
                      </form>
                    ) : null}
                    {canCancel ? (
                      <form action={cancelRecurringPlanAction}>
                        <input type="hidden" name="orgId" value={scope.orgId} />
                        <input type="hidden" name="planId" value={plan.id} />
                        <button className="btn secondary" type="submit">
                          Cancel plan
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
