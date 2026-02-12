import { prisma } from "@/lib/prisma";
import { decryptIntegrationToken, encryptIntegrationToken } from "./crypto";
import { GOOGLE_CALENDAR_WRITE_SCOPE, type GoogleTokenPayload } from "./googleClient";

const TOKEN_REFRESH_EARLY_MS = 60_000;

export type GoogleCalendarBlockRule = {
  blockIfBusyOnly?: boolean;
  blockAllDay?: boolean;
};

export type GoogleCalendarBlockRules = Record<string, GoogleCalendarBlockRule>;

type SaveGoogleAccountInput = {
  orgId: string;
  userId: string;
  googleEmail?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
  isEnabled?: boolean;
  writeCalendarId?: string | null;
  readCalendarIds?: string[];
  blockAvailabilityRules?: GoogleCalendarBlockRules;
};

type RefreshHandler = (refreshToken: string) => Promise<GoogleTokenPayload>;

export function normalizeReadCalendarIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
}

export function normalizeBlockAvailabilityRules(value: unknown): GoogleCalendarBlockRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const output: GoogleCalendarBlockRules = {};

  for (const [calendarId, rule] of Object.entries(input)) {
    if (!calendarId.trim() || !rule || typeof rule !== "object" || Array.isArray(rule)) continue;
    const source = rule as Record<string, unknown>;
    output[calendarId] = {
      blockIfBusyOnly: source.blockIfBusyOnly !== false,
      blockAllDay: source.blockAllDay !== false,
    };
  }

  return output;
}

export function hasGoogleWriteScope(scopes: string[]): boolean {
  return scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE);
}

export async function saveGoogleAccount(input: SaveGoogleAccountInput) {
  const accessTokenEncrypted = encryptIntegrationToken(input.accessToken);
  const refreshTokenEncrypted = input.refreshToken ? encryptIntegrationToken(input.refreshToken) : null;
  const hasReadCalendarIds = Array.isArray(input.readCalendarIds);
  const hasBlockRules = input.blockAvailabilityRules !== undefined;
  const readCalendarIds = normalizeReadCalendarIds(input.readCalendarIds || []);
  const blockRules = normalizeBlockAvailabilityRules(input.blockAvailabilityRules || {});

  return prisma.googleAccount.upsert({
    where: {
      orgId_userId: {
        orgId: input.orgId,
        userId: input.userId,
      },
    },
    update: {
      googleEmail: input.googleEmail === undefined ? undefined : input.googleEmail ?? null,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt: input.expiresAt ?? null,
      scopes: input.scopes || [],
      connectedAt: new Date(),
      isEnabled: input.isEnabled === undefined ? undefined : input.isEnabled,
      writeCalendarId: input.writeCalendarId === undefined ? undefined : input.writeCalendarId ?? null,
      readCalendarIdsJson: hasReadCalendarIds ? readCalendarIds : undefined,
      blockAvailabilityRulesJson: hasBlockRules ? blockRules : undefined,
      syncStatus: "IDLE",
      syncError: null,
    },
    create: {
      orgId: input.orgId,
      userId: input.userId,
      googleEmail: input.googleEmail ?? null,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt: input.expiresAt ?? null,
      scopes: input.scopes || [],
      isEnabled: input.isEnabled ?? true,
      writeCalendarId: input.writeCalendarId ?? null,
      readCalendarIdsJson: readCalendarIds,
      blockAvailabilityRulesJson: blockRules,
      syncStatus: "IDLE",
      syncError: null,
    },
  });
}

export async function disconnectGoogleAccount(input: { orgId: string; userId: string }) {
  const existing = await prisma.googleAccount.findUnique({
    where: {
      orgId_userId: {
        orgId: input.orgId,
        userId: input.userId,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    return;
  }

  await prisma.googleAccount.update({
    where: { id: existing.id },
    data: {
      isEnabled: false,
      accessTokenEncrypted: "",
      refreshTokenEncrypted: null,
      expiresAt: null,
      scopes: [],
      writeCalendarId: null,
      readCalendarIdsJson: [],
      blockAvailabilityRulesJson: {},
      syncStatus: "DISCONNECTED",
      syncError: null,
    },
  });
}

export async function updateGoogleAccountSettings(input: {
  orgId: string;
  userId: string;
  isEnabled: boolean;
  writeCalendarId: string | null;
  readCalendarIds: string[];
  blockAvailabilityRules: GoogleCalendarBlockRules;
}) {
  return prisma.googleAccount.update({
    where: {
      orgId_userId: {
        orgId: input.orgId,
        userId: input.userId,
      },
    },
    data: {
      isEnabled: input.isEnabled,
      writeCalendarId: input.writeCalendarId || null,
      readCalendarIdsJson: normalizeReadCalendarIds(input.readCalendarIds),
      blockAvailabilityRulesJson: normalizeBlockAvailabilityRules(input.blockAvailabilityRules),
      syncStatus: input.isEnabled ? "IDLE" : "DISCONNECTED",
      syncError: null,
    },
  });
}

export async function markGoogleAccountSyncResult(input: {
  accountId: string;
  ok: boolean;
  error?: string | null;
}) {
  await prisma.googleAccount.update({
    where: { id: input.accountId },
    data: {
      lastSyncAt: new Date(),
      syncStatus: input.ok ? "OK" : "ERROR",
      syncError: input.ok ? null : input.error?.slice(0, 1500) || "Sync failed.",
    },
  });
}

export async function getGoogleAccountByOrgUser(input: { orgId: string; userId: string }) {
  return prisma.googleAccount.findUnique({
    where: {
      orgId_userId: {
        orgId: input.orgId,
        userId: input.userId,
      },
    },
  });
}

export async function getGoogleAccountById(accountId: string) {
  return prisma.googleAccount.findUnique({
    where: { id: accountId },
  });
}

async function refreshGoogleAccountToken(input: {
  accountId: string;
  orgId: string;
  userId: string;
  currentScopes: string[];
  refreshToken: string;
  refresh: RefreshHandler;
}) {
  const refreshed = await input.refresh(input.refreshToken);
  await saveGoogleAccount({
    orgId: input.orgId,
    userId: input.userId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? input.refreshToken,
    expiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes.length > 0 ? refreshed.scopes : input.currentScopes,
  });

  return refreshed.accessToken;
}

export async function getGoogleAccessTokenForAccount(input: {
  accountId: string;
  refresh: RefreshHandler;
}): Promise<{ accessToken: string; account: Awaited<ReturnType<typeof getGoogleAccountById>> }> {
  const account = await prisma.googleAccount.findUnique({
    where: { id: input.accountId },
  });

  if (!account) {
    throw new Error("Google account not found.");
  }

  if (!account.accessTokenEncrypted) {
    throw new Error("Google account is not connected.");
  }

  const nowWithSkew = new Date(Date.now() + TOKEN_REFRESH_EARLY_MS);
  const needsRefresh = Boolean(account.expiresAt && account.expiresAt <= nowWithSkew);
  if (!needsRefresh) {
    return {
      accessToken: decryptIntegrationToken(account.accessTokenEncrypted),
      account,
    };
  }

  if (!account.refreshTokenEncrypted) {
    throw new Error("Google access token expired and no refresh token is available.");
  }

  const refreshToken = decryptIntegrationToken(account.refreshTokenEncrypted);
  const refreshedAccessToken = await refreshGoogleAccountToken({
    accountId: account.id,
    orgId: account.orgId,
    userId: account.userId,
    currentScopes: account.scopes,
    refreshToken,
    refresh: input.refresh,
  });

  const latest = await prisma.googleAccount.findUnique({
    where: { id: account.id },
  });

  return {
    accessToken: refreshedAccessToken,
    account: latest || account,
  };
}

export function getGoogleAccountReadCalendarIds(account: {
  readCalendarIdsJson: unknown;
  writeCalendarId: string | null;
}): string[] {
  const ids = normalizeReadCalendarIds(account.readCalendarIdsJson);
  if (ids.length > 0) return ids;
  if (account.writeCalendarId) return [account.writeCalendarId];
  return ["primary"];
}

export function getGoogleAccountBlockRules(account: {
  blockAvailabilityRulesJson: unknown;
}): GoogleCalendarBlockRules {
  return normalizeBlockAvailabilityRules(account.blockAvailabilityRulesJson);
}
