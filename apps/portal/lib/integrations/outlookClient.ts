import { normalizeEnvValue } from "@/lib/env";

const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_OUTLOOK_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "User.Read",
  "Mail.Send",
];

type JsonObject = Record<string, unknown>;

export type OutlookTokenPayload = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

export type OutlookProfile = {
  id: string;
  email: string;
  displayName: string;
};

function getMicrosoftClientId(): string {
  const value = normalizeEnvValue(process.env.MICROSOFT_CLIENT_ID);
  if (!value) {
    throw new Error("MICROSOFT_CLIENT_ID is required.");
  }
  return value;
}

function getMicrosoftClientSecret(): string {
  const value = normalizeEnvValue(process.env.MICROSOFT_CLIENT_SECRET);
  if (!value) {
    throw new Error("MICROSOFT_CLIENT_SECRET is required.");
  }
  return value;
}

function getMicrosoftTenantId(): string {
  const value = normalizeEnvValue(process.env.MICROSOFT_TENANT_ID);
  if (!value) {
    throw new Error("MICROSOFT_TENANT_ID is required.");
  }
  return value;
}

function getMicrosoftAuthorityBase(): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(getMicrosoftTenantId())}/oauth2/v2.0`;
}

function parseExpiresAt(expiresIn: unknown): Date | null {
  const seconds = typeof expiresIn === "number" ? expiresIn : Number.parseInt(String(expiresIn || ""), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(Date.now() + seconds * 1000);
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function parseJsonSafe(response: Response): Promise<JsonObject> {
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  return payload || {};
}

async function requestMicrosoftToken(params: URLSearchParams): Promise<OutlookTokenPayload> {
  const response = await fetch(`${getMicrosoftAuthorityBase()}/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      getString(payload.error_description) ||
      getString(payload.error) ||
      `Microsoft token request failed (${response.status}).`;
    throw new Error(message);
  }

  const accessToken = getString(payload.access_token);
  if (!accessToken) {
    throw new Error("Microsoft token response did not include access_token.");
  }

  return {
    accessToken,
    refreshToken: getString(payload.refresh_token),
    expiresAt: parseExpiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope),
  };
}

export function resolveOutlookRedirectUri(origin: string): string {
  return normalizeEnvValue(process.env.MICROSOFT_REDIRECT_URI) || `${origin}/api/integrations/outlook/callback`;
}

export function getOutlookScopes(): string[] {
  const configured = normalizeEnvValue(process.env.MICROSOFT_SCOPES);
  if (!configured) {
    return DEFAULT_OUTLOOK_SCOPES;
  }
  return configured
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildOutlookAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: getOutlookScopes().join(" "),
    state: input.state,
    prompt: "select_account",
  });

  return `${getMicrosoftAuthorityBase()}/authorize?${params.toString()}`;
}

export async function exchangeOutlookCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<OutlookTokenPayload> {
  const params = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    client_secret: getMicrosoftClientSecret(),
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });

  return requestMicrosoftToken(params);
}

export async function refreshOutlookTokens(refreshToken: string): Promise<OutlookTokenPayload> {
  const params = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    client_secret: getMicrosoftClientSecret(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return requestMicrosoftToken(params);
}

async function outlookGraphRequest<T = JsonObject>(input: {
  accessToken: string;
  method?: "GET" | "POST";
  path: string;
  body?: JsonObject;
}): Promise<T> {
  const response = await fetch(`${MICROSOFT_GRAPH_BASE_URL}${input.path}`, {
    method: input.method || "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
      ...(input.body ? { "content-type": "application/json" } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
  });

  if (response.status === 204) {
    return {} as T;
  }

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const graphError =
      typeof payload.error === "object" && payload.error && !Array.isArray(payload.error)
        ? (payload.error as JsonObject)
        : null;
    const message =
      getString(graphError?.message) ||
      getString(payload.error_description) ||
      getString(payload.message) ||
      `Microsoft Graph request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getOutlookProfile(accessToken: string): Promise<OutlookProfile> {
  const payload = await outlookGraphRequest<JsonObject>({
    accessToken,
    path: "/me?$select=id,displayName,mail,userPrincipalName",
  });

  const id = getString(payload.id);
  const displayName = getString(payload.displayName) || "Microsoft 365";
  const email = getString(payload.mail) || getString(payload.userPrincipalName);

  if (!id || !email) {
    throw new Error("Microsoft Graph did not return a usable mailbox identity.");
  }

  return {
    id,
    email,
    displayName,
  };
}

export async function sendOutlookMail(input: {
  accessToken: string;
  to: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  await outlookGraphRequest({
    accessToken: input.accessToken,
    method: "POST",
    path: "/me/sendMail",
    body: {
      message: {
        subject: input.subject,
        body: {
          contentType: "Text",
          content: input.bodyText,
        },
        toRecipients: [
          {
            emailAddress: {
              address: input.to,
            },
          },
        ],
      },
      saveToSentItems: true,
    },
  });
}
