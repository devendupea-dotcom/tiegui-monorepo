import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/passwords";
import { encryptTwilioAuthToken } from "../lib/twilio-config-crypto";

type SessionKind = "internal" | "client" | "worker";
type CheckCategory = "pages" | "api";

type SessionConfig = {
  kind: SessionKind;
  cookieEnv: string;
  sessionTokenEnv: string;
  emailEnv: string;
  passwordEnv: string;
  defaultEmail: string;
  defaultPassword: string;
};

type SessionContext = {
  kind: SessionKind;
  jar: CookieJar;
  source: "cookie" | "login";
  identity: string;
};

type CheckResult = {
  name: string;
  category: CheckCategory;
  ok: boolean;
  detail: string;
};

type TwilioConfigSnapshot = {
  id: string;
  twilioSubaccountSid: string;
  twilioAuthTokenEncrypted: string;
  messagingServiceSid: string;
  phoneNumber: string;
  voiceForwardingNumber: string | null;
  status: "PENDING_A2P" | "ACTIVE" | "PAUSED";
};

type ClientSmokeOrgContext = {
  orgId: string;
  source: "default_membership" | "single_membership";
};

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://127.0.0.1:3001");
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);
const SMOKE_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9VE3FoAAAAAASUVORK5CYII=",
  "base64",
);

const SESSION_CONFIGS: SessionConfig[] = [
  {
    kind: "internal",
    cookieEnv: "PORTAL_INTERNAL_COOKIE",
    sessionTokenEnv: "PORTAL_INTERNAL_SESSION_TOKEN",
    emailEnv: "PORTAL_INTERNAL_EMAIL",
    passwordEnv: "PORTAL_INTERNAL_PASSWORD",
    defaultEmail: "deven@tiegui.com",
    defaultPassword: "TieGui123!",
  },
  {
    kind: "client",
    cookieEnv: "PORTAL_CLIENT_COOKIE",
    sessionTokenEnv: "PORTAL_CLIENT_SESSION_TOKEN",
    emailEnv: "PORTAL_CLIENT_EMAIL",
    passwordEnv: "PORTAL_CLIENT_PASSWORD",
    defaultEmail: "client@tiegui-demo-landscaping.com",
    defaultPassword: "TieGui123!",
  },
];

class CookieJar {
  private readonly cookies = new Map<string, string>();

  static fromCookieHeader(value: string): CookieJar {
    const jar = new CookieJar();
    for (const segment of value.split(";")) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const name = trimmed.slice(0, separatorIndex).trim();
      const cookieValue = trimmed.slice(separatorIndex + 1).trim();
      if (!name || !cookieValue) continue;
      jar.cookies.set(name, cookieValue);
    }
    return jar;
  }

  set(name: string, value: string) {
    if (!name || !value) return;
    this.cookies.set(name, value);
  }

  mergeFromResponse(response: Response) {
    for (const headerValue of getSetCookieHeaders(response.headers)) {
      const [pair] = headerValue.split(";", 1);
      if (!pair) continue;
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex <= 0) continue;
      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      if (!name || !value) continue;
      this.cookies.set(name, value);
    }
  }

  toHeader(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getSessionTokenCookieName(baseUrl: string): string {
  return baseUrl.startsWith("https://") ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withNodeHelper = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof withNodeHelper.getSetCookie === "function") {
    return withNodeHelper.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function createUrl(path: string): string {
  return path.startsWith("http://") || path.startsWith("https://") ? path : `${BASE_URL}${path}`;
}

function createRunPhone(seed: number): string {
  const suffix = `${Date.now()}${seed}`.slice(-7);
  return `+1206${suffix}`;
}

function createSmokeSid(prefix: "AC" | "MG", seed: string): string {
  const body = `${Date.now()}${seed}`.replace(/\D/g, "").padEnd(32, "0").slice(0, 32);
  return `${prefix}${body}`;
}

function createStoredTwilioAuthToken(value: string): string {
  try {
    return encryptTwilioAuthToken(value);
  } catch {
    return value;
  }
}

function computeTwilioSignature(url: string, formBody: URLSearchParams, authToken: string): string {
  let payload = url;
  const entries = [...formBody.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of entries) {
    payload += key + value;
  }

  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

function createTwilioHeaders(
  path: string,
  formBody: URLSearchParams,
  authToken: string,
  options?: {
    forwardedHost?: string;
    forwardedProto?: "http" | "https";
  },
): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/x-www-form-urlencoded");
  if (options?.forwardedHost) {
    headers.set("x-forwarded-host", options.forwardedHost);
  }
  if (options?.forwardedProto) {
    headers.set("x-forwarded-proto", options.forwardedProto);
  }

  if (process.env.TWILIO_VALIDATE_SIGNATURE === "true") {
    const signatureUrl =
      options?.forwardedHost && options?.forwardedProto
        ? `${options.forwardedProto}://${options.forwardedHost}${path}`
        : createUrl(path);
    headers.set("x-twilio-signature", computeTwilioSignature(signatureUrl, formBody, authToken));
  }

  return headers;
}

function extractMetaRedirectUrl(html: string): string | null {
  const match = html.match(/<meta id="__next-page-redirect"[^>]*content="[^"]*url=([^"]+)"/i);
  if (!match?.[1]) return null;
  return match[1];
}

function extractVisibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isPictureUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://"))
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 240)}`);
  }
}

async function fetchWithJar(jar: CookieJar, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookieHeader = jar.toHeader();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const response = await fetch(createUrl(path), {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  jar.mergeFromResponse(response);
  return response;
}

async function fetchJsonWithJar(jar: CookieJar, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  const response = await fetchWithJar(jar, path, {
    ...init,
    headers,
  });
  const json = await readJson(response);
  return { response, json };
}

async function fetchPageWithJar(jar: CookieJar, path: string, init: RequestInit = {}) {
  const response = await fetchWithJar(jar, path, {
    ...init,
    redirect: init.redirect || "follow",
    headers: {
      accept: "text/html",
      ...(init.headers || {}),
    },
  });

  const finalUrl = new URL(response.url);
  const html = await response.text();
  const metaRedirectUrl = extractMetaRedirectUrl(html);
  const effectiveUrl = metaRedirectUrl ? new URL(metaRedirectUrl, BASE_URL) : finalUrl;

  return {
    response,
    html,
    finalUrl,
    effectiveUrl,
    metaRedirectUrl,
  };
}

function createSmokeImageFile(name: string): File {
  return new File([SMOKE_PNG_BYTES], name, { type: "image/png" });
}

async function loginWithEmailPassword(kind: SessionKind, email: string, password: string): Promise<SessionContext> {
  const csrfJar = new CookieJar();
  const csrfResult = await fetchJsonWithJar(csrfJar, "/api/auth/csrf", {
    redirect: "manual",
  });

  assert(csrfResult.response.ok, `CSRF bootstrap failed for ${kind}: ${csrfResult.response.status}`);
  assert(
    typeof (csrfResult.json as { csrfToken?: unknown })?.csrfToken === "string",
    `Missing csrfToken for ${kind}.`,
  );

  const csrfToken = (csrfResult.json as { csrfToken: string }).csrfToken;
  const body = new URLSearchParams({
    email,
    password,
    csrfToken,
    callbackUrl: `${BASE_URL}/app`,
    json: "true",
  });

  const loginHeaders = new Headers();
  loginHeaders.set("content-type", "application/x-www-form-urlencoded");
  loginHeaders.set("accept", "application/json");

  const loginResult = await fetchWithJar(csrfJar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: loginHeaders,
    body,
    redirect: "manual",
  });

  assert(
    loginResult.status === 200 || loginResult.status === 302 || loginResult.status === 303,
    `Credential callback failed for ${kind}: ${loginResult.status}`,
  );

  const loginText = await loginResult.text();
  if (loginText) {
    try {
      const payload = JSON.parse(loginText) as { url?: string };
      if (typeof payload.url === "string" && payload.url.includes("error=")) {
        throw new Error(`Credential login failed for ${kind}: ${payload.url}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Credential login failed")) {
        throw error;
      }
    }
  }

  const sessionResult = await fetchJsonWithJar(csrfJar, "/api/auth/session");
  assert(sessionResult.response.ok, `Session verification failed for ${kind}: ${sessionResult.response.status}`);
  const session = sessionResult.json as {
    user?: {
      email?: string | null;
    };
  } | null;

  assert(
    session?.user?.email?.toLowerCase() === email,
    `Session email mismatch for ${kind}; expected ${email}.`,
  );

  return {
    kind,
    jar: csrfJar,
    source: "login",
    identity: email,
  };
}

async function loginWithCredentials(config: SessionConfig): Promise<SessionContext> {
  const email = (process.env[config.emailEnv] || config.defaultEmail).trim().toLowerCase();
  const password = process.env[config.passwordEnv] || config.defaultPassword;
  return loginWithEmailPassword(config.kind, email, password);
}

async function resolveSession(config: SessionConfig): Promise<SessionContext> {
  const directCookie = process.env[config.cookieEnv];
  if (directCookie?.trim()) {
    return {
      kind: config.kind,
      jar: CookieJar.fromCookieHeader(directCookie),
      source: "cookie",
      identity: config.cookieEnv,
    };
  }

  const sessionToken = process.env[config.sessionTokenEnv]?.trim();
  if (sessionToken) {
    const jar = new CookieJar();
    jar.set(getSessionTokenCookieName(BASE_URL), sessionToken);
    return {
      kind: config.kind,
      jar,
      source: "cookie",
      identity: config.sessionTokenEnv,
    };
  }

  return loginWithCredentials(config);
}

async function expectPage(input: {
  session: SessionContext;
  path: string;
  expectedPathPrefix: string;
  label: string;
  validate?: (page: {
    html: string;
    response: Response;
    effectiveUrl: URL;
    finalUrl: URL;
  }) => void | Promise<void>;
}) {
  const page = await fetchPageWithJar(input.session.jar, input.path);
  const { response, html, effectiveUrl, finalUrl, metaRedirectUrl } = page;

  assert(response.ok, `${input.label} returned ${response.status}`);
  assert(!effectiveUrl.pathname.startsWith("/login"), `${input.label} redirected to /login`);
  assert(
    effectiveUrl.pathname.startsWith(input.expectedPathPrefix),
    `${input.label} ended at ${effectiveUrl.pathname}${effectiveUrl.search}`,
  );
  if (input.validate) {
    await input.validate({
      html,
      response,
      effectiveUrl,
      finalUrl,
    });
  }

  if (metaRedirectUrl) {
    return `${response.status} meta-> ${effectiveUrl.pathname}${effectiveUrl.search}`;
  }

  return `${response.status} ${effectiveUrl.pathname}${effectiveUrl.search}`;
}

async function expectJson(input: {
  session: SessionContext;
  path: string;
  init?: RequestInit;
  expectedStatus: number;
  validate: (json: unknown) => void | Promise<void>;
  label: string;
}) {
  const { response, json } = await fetchJsonWithJar(input.session.jar, input.path, input.init);
  assert(response.status === input.expectedStatus, `${input.label} returned ${response.status}`);
  await input.validate(json);
  return `${response.status} ${input.path}`;
}

async function runCheck(results: CheckResult[], input: {
  name: string;
  category: CheckCategory;
  run: () => Promise<string>;
}) {
  try {
    const detail = await input.run();
    results.push({
      name: input.name,
      category: input.category,
      ok: true,
      detail,
    });
    console.log(`PASS ${input.name}: ${detail}`);
  } catch (error) {
    const detail = formatError(error);
    results.push({
      name: input.name,
      category: input.category,
      ok: false,
      detail,
    });
    console.error(`FAIL ${input.name}: ${detail}`);
  }
}

async function resolveSessionEmail(session: SessionContext): Promise<string> {
  const { response, json } = await fetchJsonWithJar(session.jar, "/api/auth/session");
  assert(response.ok, `Session lookup failed for ${session.kind}: ${response.status}`);
  const payload = json as {
    user?: {
      email?: string | null;
    };
  } | null;
  const email = payload?.user?.email?.trim().toLowerCase();
  assert(email, `Missing session email for ${session.kind}.`);
  return email;
}

async function resolveClientSmokeOrgContext(prisma: PrismaClient, email: string): Promise<ClientSmokeOrgContext> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      orgId: true,
      organizationMemberships: {
        where: { status: "ACTIVE" },
        select: {
          organizationId: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  assert(user, `Could not resolve smoke client user ${email}.`);

  const defaultMembership = user.orgId
    ? user.organizationMemberships.find((membership) => membership.organizationId === user.orgId) || null
    : null;
  if (defaultMembership) {
    return {
      orgId: defaultMembership.organizationId,
      source: "default_membership",
    };
  }

  if (user.organizationMemberships.length === 1 && user.organizationMemberships[0]) {
    return {
      orgId: user.organizationMemberships[0].organizationId,
      source: "single_membership",
    };
  }

  throw new Error(
    `Could not resolve an active OrganizationMembership for ${email}. Run the tenant-access backfill and ensure User.orgId points at an active membership, or use a smoke account with exactly one active membership.`,
  );
}

function printSummary(results: CheckResult[], sessions: SessionContext[]) {
  const passed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const pageResults = results.filter((result) => result.category === "pages");
  const apiResults = results.filter((result) => result.category === "api");

  console.log("");
  console.log("Portal smoke summary");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(
    `Sessions: ${sessions.map((session) => `${session.kind}=${session.source}:${session.identity}`).join(", ")}`,
  );
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Pages: ${pageResults.filter((result) => result.ok).length}/${pageResults.length}`);
  console.log(`APIs: ${apiResults.filter((result) => result.ok).length}/${apiResults.length}`);

  if (failed.length > 0) {
    console.log("");
    console.log("Failures:");
    for (const result of failed) {
      console.log(`- ${result.name}: ${result.detail}`);
    }
  }
}

async function main() {
  const prisma = new PrismaClient();
  let createdLeadId: string | null = null;
  let createdLeadPhotoId: string | null = null;
  let createdLeadStoredPhotoId: string | null = null;
  let clientOrgId: string | null = null;
  let originalLogoPhotoId: string | null = null;
  let originalSmsFromNumberE164: string | null = null;
  let originalSmsQuietHoursStartMinute: number | null = null;
  let originalSmsQuietHoursEndMinute: number | null = null;
  let originalMissedCallAutoReplyOn: boolean | null = null;
  let originalTwilioConfig: TwilioConfigSnapshot | null = null;
  let createdLogoPhotoId: string | null = null;
  let createdWorkerUserId: string | null = null;
  let twilioVoiceLeadId: string | null = null;
  let twilioVoiceCallSid: string | null = null;
  let workerSession: SessionContext | null = null;

  try {
  const [internalSession, clientSession] = await Promise.all([
    resolveSession(SESSION_CONFIGS[0]!),
    resolveSession(SESSION_CONFIGS[1]!),
  ]);

  const results: CheckResult[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const goodLeadPhone = createRunPhone(1);
  const badLeadPhone = createRunPhone(2);
  const uniqueSuffix = `${Date.now()}`.slice(-6);
  const clientEmail = await resolveSessionEmail(clientSession);
  const clientOrgContext = await resolveClientSmokeOrgContext(prisma, clientEmail);
  clientOrgId = clientOrgContext.orgId;
  console.log(`Smoke client org resolved from ${clientOrgContext.source}: ${clientOrgId}`);
  const clientOrg = await prisma.organization.findUnique({
    where: { id: clientOrgId },
    select: {
      logoPhotoId: true,
      smsFromNumberE164: true,
      smsQuietHoursStartMinute: true,
      smsQuietHoursEndMinute: true,
      missedCallAutoReplyOn: true,
      twilioConfig: {
        select: {
          id: true,
          twilioSubaccountSid: true,
          twilioAuthTokenEncrypted: true,
          messagingServiceSid: true,
          phoneNumber: true,
          voiceForwardingNumber: true,
          status: true,
        },
      },
    },
  });
  originalLogoPhotoId = clientOrg?.logoPhotoId ?? null;
  originalSmsFromNumberE164 = clientOrg?.smsFromNumberE164 ?? null;
  originalSmsQuietHoursStartMinute = clientOrg?.smsQuietHoursStartMinute ?? null;
  originalSmsQuietHoursEndMinute = clientOrg?.smsQuietHoursEndMinute ?? null;
  originalMissedCallAutoReplyOn = clientOrg?.missedCallAutoReplyOn ?? null;
  originalTwilioConfig = clientOrg?.twilioConfig ?? null;
  const workerEmail = `portal-smoke-worker-${uniqueSuffix}@tiegui.local`;
  const workerPassword = "TieGui123!";
  const workerPasswordHash = await hashPassword(workerPassword);
  const workerUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: "Portal Smoke Worker",
        email: workerEmail,
        role: "CLIENT",
        calendarAccessRole: "WORKER",
        orgId: clientOrgId,
        passwordHash: workerPasswordHash,
        mustChangePassword: false,
        emailVerified: new Date(),
      },
      select: { id: true },
    });

    await tx.organizationMembership.create({
      data: {
        organizationId: clientOrgId!,
        userId: user.id,
        role: "WORKER",
        status: "ACTIVE",
      },
    });

    return user;
  });
  createdWorkerUserId = workerUser.id;
  workerSession = await loginWithEmailPassword("worker", workerEmail, workerPassword);

  const smokeTwilioPhone = originalSmsFromNumberE164 || createRunPhone(3);
  const smokeTwilioForwardTarget = createRunPhone(4);
  const smokeTwilioAuthToken = `smoke-auth-${uniqueSuffix}`;
  const smokeTwilioCallSid = `CA${`${Date.now()}${uniqueSuffix}`.replace(/\D/g, "").padEnd(32, "0").slice(0, 32)}`;
  const smokeTwilioCallerPhone = createRunPhone(5);
  const smokeTwilioAccountSid = createSmokeSid("AC", `${uniqueSuffix}1`);
  const smokeTwilioMessagingSid = createSmokeSid("MG", `${uniqueSuffix}2`);
  const smokeTwilioStoredAuthToken = createStoredTwilioAuthToken(smokeTwilioAuthToken);

  await prisma.organizationTwilioConfig.upsert({
    where: { organizationId: clientOrgId },
    create: {
      organizationId: clientOrgId,
      twilioSubaccountSid: smokeTwilioAccountSid,
      twilioAuthTokenEncrypted: smokeTwilioStoredAuthToken,
      messagingServiceSid: smokeTwilioMessagingSid,
      phoneNumber: smokeTwilioPhone,
      voiceForwardingNumber: smokeTwilioForwardTarget,
      status: "ACTIVE",
    },
    update: {
      twilioSubaccountSid: smokeTwilioAccountSid,
      twilioAuthTokenEncrypted: smokeTwilioStoredAuthToken,
      messagingServiceSid: smokeTwilioMessagingSid,
      phoneNumber: smokeTwilioPhone,
      voiceForwardingNumber: smokeTwilioForwardTarget,
      status: "ACTIVE",
    },
  });

  await prisma.organization.update({
    where: { id: clientOrgId },
    data: {
      smsFromNumberE164: smokeTwilioPhone,
      smsQuietHoursStartMinute: 0,
      smsQuietHoursEndMinute: 0,
      missedCallAutoReplyOn: true,
    },
  });

  await runCheck(results, {
    name: "internal /app redirects into calendar",
    category: "pages",
    run: () =>
      expectPage({
        session: internalSession,
        path: `/app?orgId=${encodeURIComponent(clientOrgId!)}`,
        expectedPathPrefix: "/app/calendar",
        label: "GET /app (internal)",
      }),
  });

  await runCheck(results, {
    name: "owner /app command center",
    category: "pages",
    run: () =>
      expectPage({
        session: clientSession,
        path: "/app",
        expectedPathPrefix: "/app",
        label: "GET /app (owner)",
        validate: ({ html }) => {
          const text = extractVisibleText(html);
          assert(text.includes("Command Center"), "Expected Command Center heading");
          assert(text.includes("Revenue"), "Expected revenue card content");
          assert(text.includes("Gross"), "Expected gross revenue toggle");
          assert(text.includes("Collected"), "Expected collected revenue toggle");
          assert(text.includes("Lead Engine"), "Expected lead engine panel content");
        },
      }),
  });

  await runCheck(results, {
    name: "worker /app ops dashboard hides financials",
    category: "pages",
    run: () =>
      expectPage({
        session: workerSession!,
        path: "/app",
        expectedPathPrefix: "/app",
        label: "GET /app (worker)",
        validate: ({ html }) => {
          const text = extractVisibleText(html);
          assert(text.includes("Ops Dashboard"), "Expected Ops Dashboard heading");
          assert(!text.includes("Revenue"), "Worker HTML should not include Revenue");
          assert(!text.includes("Gross"), "Worker HTML should not include Gross");
          assert(!text.includes("Collected"), "Worker HTML should not include Collected");
          assert(!text.includes("$"), "Worker HTML should not include currency values");
          assert(!text.includes("ROAS"), "Worker HTML should not include ROAS");
          assert(!text.includes("Spend"), "Worker HTML should not include Spend");
        },
      }),
  });

  for (const path of ["/app/calendar", "/app/inbox", "/app/jobs", "/app/invoices", "/app/settings", "/app/settings/integrations"]) {
    await runCheck(results, {
      name: `client page ${path}`,
      category: "pages",
      run: () =>
        expectPage({
          session: clientSession,
          path,
          expectedPathPrefix: path,
          label: `GET ${path} (client)`,
        }),
    });
  }

  await runCheck(results, {
    name: "owner page /app/analytics/ads",
    category: "pages",
    run: () =>
      expectPage({
        session: clientSession,
        path: "/app/analytics/ads",
        expectedPathPrefix: "/app/analytics/ads",
        label: "GET /app/analytics/ads (owner)",
        validate: ({ html }) => {
          assert(html.includes("Ads Results"), "Expected Ads Results heading");
          assert(html.includes("ROAS"), "Expected ROAS on owner ads page");
        },
      }),
  });

  await runCheck(results, {
    name: "worker ads page redirected away from financial view",
    category: "pages",
    run: () =>
      expectPage({
        session: workerSession!,
        path: "/app/analytics/ads",
        expectedPathPrefix: "/app/calendar",
        label: "GET /app/analytics/ads (worker)",
        validate: ({ html }) => {
          assert(!html.includes("ROAS"), "Worker HTML should not include ROAS");
          assert(!html.includes("Spend"), "Worker HTML should not include Spend");
        },
      }),
  });

  for (const path of ["/hq", "/hq/businesses", "/hq/inbox", "/hq/calendar"]) {
    await runCheck(results, {
      name: `internal page ${path}`,
      category: "pages",
      run: () =>
        expectPage({
          session: internalSession,
          path,
          expectedPathPrefix: path,
          label: `GET ${path} (internal)`,
        }),
    });
  }

  await runCheck(results, {
    name: "api calendar events valid date",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: `/api/calendar/events?date=${encodeURIComponent(today)}`,
        expectedStatus: 200,
        label: "GET /api/calendar/events valid",
        validate: (json) => {
          const payload = json as { ok?: boolean; events?: unknown[] };
          assert(payload?.ok === true, "Expected ok=true");
          assert(Array.isArray(payload?.events), "Expected events array");
        },
      }),
  });

  await runCheck(results, {
    name: "api calendar events invalid date",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: "/api/calendar/events?date=not-a-date",
        expectedStatus: 400,
        label: "GET /api/calendar/events invalid",
        validate: (json) => {
          const payload = json as { ok?: boolean; error?: string };
          assert(payload?.ok === false, "Expected ok=false");
          assert(typeof payload?.error === "string" && payload.error.length > 0, "Expected error message");
        },
      }),
  });

  await runCheck(results, {
    name: "api analytics summary owner",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: "/api/analytics/summary?range=30d",
        expectedStatus: 200,
        label: "GET /api/analytics/summary owner",
        validate: (json) => {
          const payload = json as {
            ok?: boolean;
            visibility?: string;
            grossRevenueThisMonthCents?: unknown;
            collectedRevenueThisMonthCents?: unknown;
            jobsThisWeekCount?: unknown;
            links?: { ads?: unknown };
          };
          assert(payload?.ok === true, "Expected ok=true");
          assert(payload?.visibility === "full", "Expected full visibility");
          assert("grossRevenueThisMonthCents" in payload, "Expected gross revenue field");
          assert("collectedRevenueThisMonthCents" in payload, "Expected collected revenue field");
          assert(typeof payload?.jobsThisWeekCount === "number", "Expected jobs this week");
          assert(typeof payload?.links?.ads === "string", "Expected ads link");
        },
      }),
  });

  await runCheck(results, {
    name: "api analytics summary worker redacted",
    category: "api",
    run: () =>
      expectJson({
        session: workerSession!,
        path: "/api/analytics/summary?range=30d",
        expectedStatus: 200,
        label: "GET /api/analytics/summary worker",
        validate: (json) => {
          const payload = json as {
            ok?: boolean;
            visibility?: string;
            grossRevenueThisMonthCents?: unknown;
            collectedRevenueThisMonthCents?: unknown;
            revenueThisMonthCents?: unknown;
            outstandingInvoicesTotalCents?: unknown;
          };
          assert(payload?.ok === true, "Expected ok=true");
          assert(payload?.visibility === "limited", "Expected limited visibility");
          assert(!("grossRevenueThisMonthCents" in payload), "Worker summary should omit gross revenue");
          assert(!("collectedRevenueThisMonthCents" in payload), "Worker summary should omit collected revenue");
          assert(!("revenueThisMonthCents" in payload), "Worker summary should omit legacy revenue field");
          assert(!("outstandingInvoicesTotalCents" in payload), "Worker summary should omit outstanding invoice total");
        },
      }),
  });

  await runCheck(results, {
    name: "api analytics ads owner",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: "/api/analytics/ads",
        expectedStatus: 200,
        label: "GET /api/analytics/ads owner",
        validate: (json) => {
          const payload = json as {
            ok?: boolean;
            visibility?: string;
            totals?: { spendCents?: unknown };
            channels?: unknown[];
          };
          assert(payload?.ok === true, "Expected ok=true");
          assert(payload?.visibility === "full", "Expected full visibility");
          assert(Array.isArray(payload?.channels), "Expected channels array");
          assert(typeof payload?.totals?.spendCents === "number", "Expected totals.spendCents");
        },
      }),
  });

  await runCheck(results, {
    name: "api analytics ads worker forbidden",
    category: "api",
    run: () =>
      expectJson({
        session: workerSession!,
        path: "/api/analytics/ads",
        expectedStatus: 403,
        label: "GET /api/analytics/ads worker",
        validate: (json) => {
          const payload = json as { ok?: boolean; error?: string };
          assert(payload?.ok === false, "Expected ok=false");
          assert(typeof payload?.error === "string" && payload.error.length > 0, "Expected error message");
        },
      }),
  });

  await runCheck(results, {
    name: "api leads valid organic create",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: "/api/leads",
        expectedStatus: 200,
        label: "POST /api/leads organic",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: `Portal Smoke Lead ${uniqueSuffix}`,
            phone: goodLeadPhone,
            sourceType: "ORGANIC",
            note: "Created by scripts/smoke-portal.ts",
            ignorePossibleMatch: true,
          }),
        },
        validate: (json) => {
          const payload = json as {
            ok?: boolean;
            lead?: {
              id?: string;
              phoneE164?: string;
            };
          };
          assert(payload?.ok === true, "Expected ok=true");
          assert(typeof payload?.lead?.id === "string" && payload.lead.id.length > 0, "Expected lead id");
          assert(payload?.lead?.phoneE164 === goodLeadPhone, `Expected phone ${goodLeadPhone}`);
          createdLeadId = payload.lead.id;
        },
      }),
  });

  await runCheck(results, {
    name: "api leads paid attribution forbidden for client",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: "/api/leads",
        expectedStatus: 403,
        label: "POST /api/leads paid forbidden",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: `Portal Smoke Paid ${uniqueSuffix}`,
            phone: badLeadPhone,
            sourceType: "PAID",
            ignorePossibleMatch: true,
          }),
        },
        validate: (json) => {
          const payload = json as { ok?: boolean; error?: string };
          assert(payload?.ok === false, "Expected ok=false");
          assert(
            payload?.error === "Clients cannot set paid attribution on lead entry.",
            "Expected paid attribution guard message",
          );
        },
      }),
  });

  await runCheck(results, {
    name: "api job photo upload",
    category: "api",
    run: async () => {
      assert(createdLeadId, "Lead create must pass before photo upload can run.");

      const formData = new FormData();
      formData.set("photoFile", createSmokeImageFile("portal-smoke-photo.png"));
      formData.set("caption", "Portal smoke upload");

      return expectJson({
        session: clientSession,
        path: `/api/jobs/${createdLeadId}/photos`,
        expectedStatus: 200,
        label: "POST /api/jobs/[jobId]/photos",
        init: {
          method: "POST",
          body: formData,
        },
        validate: async (json) => {
          const payload = json as {
            ok?: boolean;
            photo?: {
              id?: string;
              photoId?: string | null;
            };
          };
          assert(payload?.ok === true, "Expected ok=true");
          assert(typeof payload?.photo?.id === "string" && payload.photo.id.length > 0, "Expected lead photo id");
          createdLeadPhotoId = payload.photo.id;
          const stored = await prisma.leadPhoto.findUnique({
            where: { id: payload.photo.id },
            select: { photoId: true, imageDataUrl: true },
          });
          assert(stored, "Uploaded lead photo was not persisted.");
          createdLeadStoredPhotoId = stored.photoId ?? null;
          assert(
            stored.photoId !== null || typeof stored.imageDataUrl === "string",
            "Expected inline data or storage-backed photo reference.",
          );
        },
      });
    },
  });

  await runCheck(results, {
    name: "api branding logo upload and readback",
    category: "api",
    run: async () => {
      const formData = new FormData();
      formData.set("logo", createSmokeImageFile("portal-smoke-logo.png"));

      const upload = await fetchJsonWithJar(clientSession.jar, "/api/branding/logo", {
        method: "POST",
        body: formData,
      });

      assert(upload.response.status === 200, `POST /api/branding/logo returned ${upload.response.status}`);
      const uploadPayload = upload.json as { ok?: boolean; error?: string } | null;
      assert(uploadPayload?.ok === true, uploadPayload?.error || "Expected ok=true");

      const org = await prisma.organization.findUnique({
        where: { id: clientOrgId! },
        select: { logoPhotoId: true },
      });
      assert(typeof org?.logoPhotoId === "string" && org.logoPhotoId.length > 0, "Expected logoPhotoId after upload");
      createdLogoPhotoId = org.logoPhotoId;

      const logoSigned = await fetchJsonWithJar(clientSession.jar, "/api/branding/logo/signed-url");
      assert(logoSigned.response.status === 200, `GET /api/branding/logo/signed-url returned ${logoSigned.response.status}`);
      const logoPayload = logoSigned.json as { ok?: boolean; url?: string | null; error?: string } | null;
      assert(logoPayload?.ok === true, logoPayload?.error || "Expected ok=true");
      assert(isPictureUrl(logoPayload?.url), "Expected picture URL or data URL for branding logo.");

      const photoSigned = await fetchJsonWithJar(
        clientSession.jar,
        `/api/photos/${encodeURIComponent(createdLogoPhotoId)}/signed-url`,
      );
      assert(photoSigned.response.status === 200, `GET /api/photos/[photoId]/signed-url returned ${photoSigned.response.status}`);
      const photoPayload = photoSigned.json as { ok?: boolean; url?: string | null; error?: string } | null;
      assert(photoPayload?.ok === true, photoPayload?.error || "Expected ok=true");
      assert(isPictureUrl(photoPayload?.url), "Expected picture URL or data URL for stored photo.");

      return `200 logo=${createdLogoPhotoId}`;
    },
  });

  await runCheck(results, {
    name: "api inbox conversations",
    category: "api",
    run: () =>
      expectJson({
        session: clientSession,
        path: "/api/inbox/conversations",
        expectedStatus: 200,
        label: "GET /api/inbox/conversations",
        validate: (json) => {
          const payload = json as { ok?: boolean; conversations?: unknown[] };
          assert(payload?.ok === true, "Expected ok=true");
          assert(Array.isArray(payload?.conversations), "Expected conversations array");
        },
      }),
  });

  await runCheck(results, {
    name: "api twilio voice returns dial twiml for configured forward target",
    category: "api",
    run: async () => {
      const formBody = new URLSearchParams({
        AccountSid: createSmokeSid("AC", `${uniqueSuffix}9`),
        CallSid: smokeTwilioCallSid,
        From: smokeTwilioCallerPhone,
        To: smokeTwilioPhone,
        Direction: "inbound",
        CallStatus: "ringing",
      });

      const response = await fetch(createUrl("/api/webhooks/twilio/voice"), {
        method: "POST",
        headers: createTwilioHeaders("/api/webhooks/twilio/voice", formBody, smokeTwilioAuthToken, {
          forwardedHost: "app.tieguisolutions.com",
          forwardedProto: "https",
        }),
        body: formBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const xml = await response.text();
      assert(response.status === 200, `POST /api/webhooks/twilio/voice returned ${response.status}`);
      assert(xml.includes("<Dial"), "Expected <Dial> in TwiML response");
      assert(xml.includes('timeout="20"'), "Expected a 20 second dial timeout so missed calls fall back quickly");
      assert(xml.includes(smokeTwilioForwardTarget), `Expected forward target ${smokeTwilioForwardTarget}`);
      assert(
        xml.includes('action="https://app.tieguisolutions.com/api/webhooks/twilio/after-call"'),
        "Expected absolute after-call callback URL on the public host",
      );
      assert(!xml.includes("<Hangup"), "Voice forward TwiML should not append Hangup after Dial");
      return `200 dial-> ${smokeTwilioForwardTarget}`;
    },
  });

  await runCheck(results, {
    name: "api twilio after-call no-answer logs missed call and starts sms flow",
    category: "api",
    run: async () => {
      const formBody = new URLSearchParams({
        AccountSid: createSmokeSid("AC", `${uniqueSuffix}8`),
        CallSid: smokeTwilioCallSid,
        From: smokeTwilioCallerPhone,
        To: smokeTwilioPhone,
        Direction: "inbound",
        DialCallStatus: "no-answer",
        CallStatus: "completed",
      });

      const response = await fetch(createUrl("/api/webhooks/twilio/after-call"), {
        method: "POST",
        headers: createTwilioHeaders("/api/webhooks/twilio/after-call", formBody, smokeTwilioAuthToken),
        body: formBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const xml = await response.text();
      assert(response.status === 200, `POST /api/webhooks/twilio/after-call returned ${response.status}`);
      assert(xml.includes("<Response"), "Expected TwiML response body");

      const call = await prisma.call.findUnique({
        where: { twilioCallSid: smokeTwilioCallSid },
        select: {
          twilioCallSid: true,
          status: true,
          direction: true,
          toNumberE164: true,
          leadId: true,
        },
      });

      assert(call, "Expected call record after after-call webhook");
      assert(call.status === "MISSED", `Expected MISSED call status, received ${call.status}`);
      assert(call.direction === "INBOUND", `Expected INBOUND call direction, received ${call.direction}`);
      assert(call.toNumberE164 === smokeTwilioPhone, `Expected call To ${smokeTwilioPhone}`);
      assert(typeof call.leadId === "string" && call.leadId.length > 0, "Expected linked lead after missed call");

      twilioVoiceCallSid = call.twilioCallSid;
      twilioVoiceLeadId = call.leadId;

      const lead = await prisma.lead.findUnique({
        where: { id: call.leadId! },
        select: { phoneE164: true },
      });
      assert(lead?.phoneE164 === smokeTwilioCallerPhone, `Expected missed-call lead phone ${smokeTwilioCallerPhone}`);

      const [messageCount, queueCount] = await Promise.all([
        prisma.message.count({
          where: {
            leadId: call.leadId!,
            direction: "OUTBOUND",
            type: "AUTOMATION",
          },
        }),
        prisma.smsDispatchQueue.count({
          where: {
            leadId: call.leadId!,
            kind: "MISSED_CALL_INTRO",
          },
        }),
      ]);

      assert(messageCount > 0 || queueCount > 0, "Expected missed-call SMS send or queue after no-answer");
      return `200 missed-> call=${call.status} messages=${messageCount} queue=${queueCount}`;
    },
  });

  printSummary(results, workerSession ? [internalSession, clientSession, workerSession] : [internalSession, clientSession]);

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
  } finally {
    if (createdWorkerUserId) {
      await prisma.user.deleteMany({ where: { id: createdWorkerUserId } }).catch((error) => {
        console.warn(`Cleanup warning (worker user): ${formatError(error)}`);
      });
    }
    if (twilioVoiceCallSid) {
      await prisma.call.deleteMany({ where: { twilioCallSid: twilioVoiceCallSid } }).catch((error) => {
        console.warn(`Cleanup warning (twilio call): ${formatError(error)}`);
      });
    }
    if (twilioVoiceLeadId) {
      await prisma.message.deleteMany({ where: { leadId: twilioVoiceLeadId } }).catch((error) => {
        console.warn(`Cleanup warning (twilio messages): ${formatError(error)}`);
      });
      await prisma.smsDispatchQueue.deleteMany({ where: { leadId: twilioVoiceLeadId } }).catch((error) => {
        console.warn(`Cleanup warning (twilio queue): ${formatError(error)}`);
      });
      await prisma.leadConversationAuditEvent.deleteMany({ where: { leadId: twilioVoiceLeadId } }).catch((error) => {
        console.warn(`Cleanup warning (twilio conversation audit): ${formatError(error)}`);
      });
      await prisma.leadConversationState.deleteMany({ where: { leadId: twilioVoiceLeadId } }).catch((error) => {
        console.warn(`Cleanup warning (twilio conversation state): ${formatError(error)}`);
      });
      await prisma.lead.deleteMany({ where: { id: twilioVoiceLeadId } }).catch((error) => {
        console.warn(`Cleanup warning (twilio lead): ${formatError(error)}`);
      });
    }
    if (createdLeadPhotoId) {
      await prisma.leadPhoto.deleteMany({ where: { id: createdLeadPhotoId } }).catch((error) => {
        console.warn(`Cleanup warning (leadPhoto): ${formatError(error)}`);
      });
    }
    if (createdLeadStoredPhotoId) {
      await prisma.photo.deleteMany({ where: { id: createdLeadStoredPhotoId } }).catch((error) => {
        console.warn(`Cleanup warning (photo): ${formatError(error)}`);
      });
    }
    if (createdLeadId) {
      await prisma.lead.deleteMany({ where: { id: createdLeadId } }).catch((error) => {
        console.warn(`Cleanup warning (lead): ${formatError(error)}`);
      });
    }
    if (clientOrgId) {
      await prisma.organization
        .update({
          where: { id: clientOrgId },
          data: {
            logoPhotoId: originalLogoPhotoId,
            smsFromNumberE164: originalSmsFromNumberE164,
            smsQuietHoursStartMinute: originalSmsQuietHoursStartMinute ?? undefined,
            smsQuietHoursEndMinute: originalSmsQuietHoursEndMinute ?? undefined,
            missedCallAutoReplyOn: originalMissedCallAutoReplyOn ?? undefined,
          },
        })
        .catch((error) => {
          console.warn(`Cleanup warning (org restore): ${formatError(error)}`);
        });
    }
    if (clientOrgId) {
      if (originalTwilioConfig) {
        await prisma.organizationTwilioConfig
          .update({
            where: { organizationId: clientOrgId },
            data: {
              twilioSubaccountSid: originalTwilioConfig.twilioSubaccountSid,
              twilioAuthTokenEncrypted: originalTwilioConfig.twilioAuthTokenEncrypted,
              messagingServiceSid: originalTwilioConfig.messagingServiceSid,
              phoneNumber: originalTwilioConfig.phoneNumber,
              voiceForwardingNumber: originalTwilioConfig.voiceForwardingNumber,
              status: originalTwilioConfig.status,
            },
          })
          .catch((error) => {
            console.warn(`Cleanup warning (twilio config restore): ${formatError(error)}`);
          });
      } else {
        await prisma.organizationTwilioConfig.deleteMany({ where: { organizationId: clientOrgId } }).catch((error) => {
          console.warn(`Cleanup warning (twilio config delete): ${formatError(error)}`);
        });
      }
    }
    if (createdLogoPhotoId && createdLogoPhotoId !== originalLogoPhotoId) {
      await prisma.photo.deleteMany({ where: { id: createdLogoPhotoId } }).catch((error) => {
        console.warn(`Cleanup warning (logo photo): ${formatError(error)}`);
      });
    }
    await prisma.$disconnect().catch(() => null);
  }
}

main().catch((error) => {
  console.error(`Portal smoke script failed before checks ran: ${formatError(error)}`);
  process.exit(1);
});
