import { type StripeConnectionStatus } from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const STRIPE_OAUTH_AUTHORIZE_URL = "https://connect.stripe.com/oauth/authorize";
const STRIPE_OAUTH_TOKEN_URL = "https://connect.stripe.com/oauth/token";
const STRIPE_OAUTH_DEAUTHORIZE_URL = "https://connect.stripe.com/oauth/deauthorize";
const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";
const STRIPE_DEFAULT_SCOPE = "read_write";

type JsonObject = Record<string, unknown>;

export type StripeOAuthConnection = {
  stripeAccountId: string;
  livemode: boolean;
  scope: string;
};

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

function getStripeConnectClientId(): string {
  const value = normalizeEnvValue(process.env.STRIPE_CONNECT_CLIENT_ID);
  if (!value) {
    throw new Error("STRIPE_CONNECT_CLIENT_ID is required.");
  }
  return value;
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
  return Boolean(
    normalizeEnvValue(process.env.STRIPE_SECRET_KEY) &&
      normalizeEnvValue(process.env.STRIPE_CONNECT_CLIENT_ID),
  );
}

export function resolveStripeRedirectUri(origin: string): string {
  return normalizeEnvValue(process.env.STRIPE_REDIRECT_URI) || `${origin}/api/integrations/stripe/callback`;
}

export function buildStripeAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams({
    client_id: getStripeConnectClientId(),
    response_type: "code",
    scope: STRIPE_DEFAULT_SCOPE,
    state: input.state,
    redirect_uri: input.redirectUri,
  });

  return `${STRIPE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeStripeCodeForConnection(input: {
  code: string;
}): Promise<StripeOAuthConnection> {
  const payload = await requestStripeForm(
    STRIPE_OAUTH_TOKEN_URL,
    new URLSearchParams({
      code: input.code,
      grant_type: "authorization_code",
    }),
    "Stripe account connection failed.",
  );

  const stripeAccountId = getString(payload.stripe_user_id);
  if (!stripeAccountId) {
    throw new Error("Stripe did not return a connected account id.");
  }

  return {
    stripeAccountId,
    livemode: getBoolean(payload.livemode),
    scope: getString(payload.scope) || STRIPE_DEFAULT_SCOPE,
  };
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

  const businessProfile = getObject(payload?.business_profile);
  const settings = getObject(payload?.settings);
  const dashboard = getObject(settings?.dashboard);

  return {
    stripeAccountId: getString(payload?.id) || input.stripeAccountId,
    email: getString(payload?.email) || getString(businessProfile?.support_email),
    displayName:
      getString(businessProfile?.name) ||
      getString(dashboard?.display_name) ||
      getString(payload?.display_name),
    country: getString(payload?.country),
    defaultCurrency: getString(payload?.default_currency),
    livemode: getBoolean(payload?.livemode),
    chargesEnabled: getBoolean(payload?.charges_enabled),
    payoutsEnabled: getBoolean(payload?.payouts_enabled),
    detailsSubmitted: getBoolean(payload?.details_submitted),
  };
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

  try {
    await requestStripeForm(
      STRIPE_OAUTH_DEAUTHORIZE_URL,
      new URLSearchParams({
        client_id: getStripeConnectClientId(),
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
