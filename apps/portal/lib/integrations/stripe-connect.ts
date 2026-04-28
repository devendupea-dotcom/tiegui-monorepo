import { type StripeConnectionStatus } from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const STRIPE_OAUTH_DEAUTHORIZE_URL = "https://connect.stripe.com/oauth/deauthorize";
const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";

type JsonObject = Record<string, unknown>;

export type StripeAccountSummary = {
  stripeAccountId: string;
  email: string | null;
  displayName: string | null;
  country: string | null;
  defaultCurrency: string | null;
  livemode: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

function getStripeSecretKey(): string {
  const value = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);
  if (!value) {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }
  return value;
}

function getStripeConnectClientId(): string | null {
  return normalizeEnvValue(process.env.STRIPE_CONNECT_CLIENT_ID) || null;
}

function getBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${getStripeSecretKey()}:`).toString("base64")}`;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function getStripeErrorMessage(payload: JsonObject | null, fallback: string): string {
  if (!payload) return fallback;

  const rootError = getObject(payload.error);
  return (
    getString(rootError?.message) ||
    getString(payload.error_description) ||
    getString(payload.error) ||
    fallback
  );
}

async function parseJsonSafe(response: Response): Promise<JsonObject | null> {
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  return payload;
}

async function requestStripeForm(url: string, params: URLSearchParams, fallback: string): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: getBasicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(getStripeErrorMessage(payload, fallback));
  }

  return payload || {};
}

export function isStripeConfigured(): boolean {
  return Boolean(normalizeEnvValue(process.env.STRIPE_SECRET_KEY));
}

function mapStripeAccountSummaryPayload(payload: JsonObject, fallbackStripeAccountId?: string): StripeAccountSummary {
  const businessProfile = getObject(payload.business_profile);
  const settings = getObject(payload.settings);
  const dashboard = getObject(settings?.dashboard);

  return {
    stripeAccountId: getString(payload.id) || fallbackStripeAccountId || "",
    email: getString(payload.email) || getString(businessProfile?.support_email),
    displayName:
      getString(businessProfile?.name) ||
      getString(dashboard?.display_name) ||
      getString(payload.display_name),
    country: getString(payload.country),
    defaultCurrency: getString(payload.default_currency),
    livemode: getBoolean(payload.livemode),
    chargesEnabled: getBoolean(payload.charges_enabled),
    payoutsEnabled: getBoolean(payload.payouts_enabled),
    detailsSubmitted: getBoolean(payload.details_submitted),
  };
}

function withOrgQuery(baseUrl: string, origin: string, orgId: string): string {
  const url = new URL(baseUrl, origin);
  url.searchParams.set("orgId", orgId);
  return url.toString();
}

export function resolveStripeRedirectUri(origin: string, orgId: string): string {
  return withOrgQuery(
    normalizeEnvValue(process.env.STRIPE_REDIRECT_URI) || "/api/integrations/stripe/callback",
    origin,
    orgId,
  );
}

export function resolveStripeRefreshUri(origin: string, orgId: string): string {
  return withOrgQuery("/api/integrations/stripe/connect?resume=1", origin, orgId);
}

async function createStripeStandardAccount(): Promise<StripeAccountSummary> {
  const payload = await requestStripeForm(
    `${STRIPE_API_BASE_URL}/accounts`,
    new URLSearchParams({
      type: "standard",
      "capabilities[card_payments][requested]": "true",
    }),
    "Stripe account creation failed.",
  );

  const stripeAccountId = getString(payload.id);
  if (!stripeAccountId) {
    throw new Error("Stripe did not return a connected account id.");
  }

  return mapStripeAccountSummaryPayload(payload, stripeAccountId);
}

async function createStripeAccountLink(input: {
  stripeAccountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<string> {
  const payload = await requestStripeForm(
    `${STRIPE_API_BASE_URL}/account_links`,
    new URLSearchParams({
      account: input.stripeAccountId,
      type: "account_onboarding",
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
    }),
    "Stripe onboarding link failed.",
  );

  const url = getString(payload.url);
  if (!url) {
    throw new Error("Stripe did not return an onboarding link.");
  }

  return url;
}

export async function createStripeOnboardingUrl(input: {
  orgId: string;
  origin: string;
}): Promise<string> {
  const existing = await prisma.organizationStripeConnection.findUnique({
    where: { orgId: input.orgId },
    select: {
      stripeAccountId: true,
      status: true,
    },
  });

  let stripeAccountId =
    existing && existing.status !== "DISCONNECTED" ? existing.stripeAccountId : null;

  if (!stripeAccountId) {
    const summary = await createStripeStandardAccount();
    stripeAccountId = summary.stripeAccountId;
    await saveOrganizationStripeConnection({
      orgId: input.orgId,
      summary,
      connectedAt: new Date(),
    });
  }

  return createStripeAccountLink({
    stripeAccountId,
    returnUrl: resolveStripeRedirectUri(input.origin, input.orgId),
    refreshUrl: resolveStripeRefreshUri(input.origin, input.orgId),
  });
}

export async function fetchStripeAccountSummary(input: {
  stripeAccountId: string;
}): Promise<StripeAccountSummary> {
  const response = await fetch(`${STRIPE_API_BASE_URL}/accounts/${encodeURIComponent(input.stripeAccountId)}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: getBasicAuthHeader(),
    },
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(getStripeErrorMessage(payload, `Stripe account lookup failed (${response.status}).`));
  }

  return mapStripeAccountSummaryPayload(payload || {}, input.stripeAccountId);
}

export function deriveStripeConnectionStatus(input: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disconnectedAt?: Date | null;
}): StripeConnectionStatus {
  if (input.disconnectedAt) {
    return "DISCONNECTED";
  }

  if (input.chargesEnabled && input.payoutsEnabled) {
    return "ACTIVE";
  }

  if (input.detailsSubmitted) {
    return "RESTRICTED";
  }

  return "PENDING";
}

export async function saveOrganizationStripeConnection(input: {
  orgId: string;
  summary: StripeAccountSummary;
  connectedAt?: Date;
}) {
  const now = new Date();
  const status = deriveStripeConnectionStatus(input.summary);

  return prisma.organizationStripeConnection.upsert({
    where: { orgId: input.orgId },
    update: {
      stripeAccountId: input.summary.stripeAccountId,
      stripeAccountEmail: input.summary.email,
      stripeDisplayName: input.summary.displayName,
      stripeCountry: input.summary.country,
      defaultCurrency: input.summary.defaultCurrency,
      livemode: input.summary.livemode,
      chargesEnabled: input.summary.chargesEnabled,
      payoutsEnabled: input.summary.payoutsEnabled,
      detailsSubmitted: input.summary.detailsSubmitted,
      status,
      lastSyncedAt: now,
      lastError: null,
      disconnectedAt: null,
      ...(input.connectedAt ? { connectedAt: input.connectedAt } : {}),
    },
    create: {
      orgId: input.orgId,
      stripeAccountId: input.summary.stripeAccountId,
      stripeAccountEmail: input.summary.email,
      stripeDisplayName: input.summary.displayName,
      stripeCountry: input.summary.country,
      defaultCurrency: input.summary.defaultCurrency,
      livemode: input.summary.livemode,
      chargesEnabled: input.summary.chargesEnabled,
      payoutsEnabled: input.summary.payoutsEnabled,
      detailsSubmitted: input.summary.detailsSubmitted,
      status,
      connectedAt: input.connectedAt || now,
      lastSyncedAt: now,
    },
  });
}

export async function setStripeConnectionLastError(input: {
  orgId: string;
  error: string;
}) {
  const existing = await prisma.organizationStripeConnection.findUnique({
    where: { orgId: input.orgId },
    select: { id: true },
  });

  if (!existing) {
    return null;
  }

  return prisma.organizationStripeConnection.update({
    where: { id: existing.id },
    data: {
      lastError: input.error,
      lastSyncedAt: new Date(),
    },
  });
}

export async function refreshOrganizationStripeConnection(input: {
  orgId: string;
}) {
  const existing = await prisma.organizationStripeConnection.findUnique({
    where: { orgId: input.orgId },
    select: {
      stripeAccountId: true,
      status: true,
    },
  });

  if (!existing || existing.status === "DISCONNECTED") {
    throw new Error("Stripe is not connected for this organization.");
  }

  try {
    const summary = await fetchStripeAccountSummary({
      stripeAccountId: existing.stripeAccountId,
    });

    return await saveOrganizationStripeConnection({
      orgId: input.orgId,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh Stripe status.";
    await setStripeConnectionLastError({
      orgId: input.orgId,
      error: message,
    });
    throw error;
  }
}

export async function disconnectOrganizationStripeConnection(input: {
  orgId: string;
}) {
  const existing = await prisma.organizationStripeConnection.findUnique({
    where: { orgId: input.orgId },
    select: {
      id: true,
      stripeAccountId: true,
      status: true,
    },
  });

  if (!existing || existing.status === "DISCONNECTED") {
    return null;
  }

  const stripeConnectClientId = getStripeConnectClientId();
  if (stripeConnectClientId) {
    try {
      await requestStripeForm(
        STRIPE_OAUTH_DEAUTHORIZE_URL,
        new URLSearchParams({
          client_id: stripeConnectClientId,
          stripe_user_id: existing.stripeAccountId,
        }),
        "Stripe account disconnect failed.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe account disconnect failed.";
      await setStripeConnectionLastError({
        orgId: input.orgId,
        error: message,
      });
      throw error;
    }
  }

  return prisma.organizationStripeConnection.update({
    where: { id: existing.id },
    data: {
      status: "DISCONNECTED",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      disconnectedAt: new Date(),
      lastSyncedAt: new Date(),
      lastError: null,
    },
  });
}
