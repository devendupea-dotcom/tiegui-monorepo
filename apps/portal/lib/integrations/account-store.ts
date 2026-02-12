import type { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptIntegrationToken, encryptIntegrationToken } from "./crypto";

type SaveIntegrationAccountInput = {
  orgId: string;
  provider: IntegrationProvider;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  providerAccountId?: string | null;
  realmId?: string | null;
  scopes?: string[];
  status?: "CONNECTED" | "DISCONNECTED" | "ERROR";
};

type RefreshResult = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
  providerAccountId?: string | null;
  realmId?: string | null;
};

type RefreshHandler = (refreshToken: string) => Promise<RefreshResult>;

const TOKEN_REFRESH_EARLY_MS = 60_000;

export async function saveIntegrationAccount(input: SaveIntegrationAccountInput) {
  const accessTokenEncrypted = encryptIntegrationToken(input.accessToken);
  const refreshTokenEncrypted = input.refreshToken
    ? encryptIntegrationToken(input.refreshToken)
    : null;

  return prisma.integrationAccount.upsert({
    where: {
      orgId_provider: {
        orgId: input.orgId,
        provider: input.provider,
      },
    },
    update: {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt: input.expiresAt ?? null,
      providerAccountId: input.providerAccountId ?? null,
      realmId: input.realmId ?? null,
      scopes: input.scopes || [],
      connectedAt: new Date(),
      status: input.status || "CONNECTED",
      lastError: null,
    },
    create: {
      orgId: input.orgId,
      provider: input.provider,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt: input.expiresAt ?? null,
      providerAccountId: input.providerAccountId ?? null,
      realmId: input.realmId ?? null,
      scopes: input.scopes || [],
      status: input.status || "CONNECTED",
    },
  });
}

export async function disconnectIntegrationAccount(input: {
  orgId: string;
  provider: IntegrationProvider;
}) {
  const existing = await prisma.integrationAccount.findUnique({
    where: {
      orgId_provider: {
        orgId: input.orgId,
        provider: input.provider,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    return;
  }

  await prisma.integrationAccount.update({
    where: { id: existing.id },
    data: {
      status: "DISCONNECTED",
      syncEnabled: false,
      accessTokenEncrypted: "",
      refreshTokenEncrypted: null,
      expiresAt: null,
      lastError: null,
    },
  });
}

export async function setIntegrationSyncEnabled(input: {
  orgId: string;
  provider: IntegrationProvider;
  syncEnabled: boolean;
}) {
  return prisma.integrationAccount.update({
    where: {
      orgId_provider: {
        orgId: input.orgId,
        provider: input.provider,
      },
    },
    data: {
      syncEnabled: input.syncEnabled,
    },
  });
}

export async function getDecryptedAccessToken(input: {
  orgId: string;
  provider: IntegrationProvider;
  refresh: RefreshHandler;
}): Promise<{ accessToken: string; realmId: string | null }> {
  const account = await prisma.integrationAccount.findUnique({
    where: {
      orgId_provider: {
        orgId: input.orgId,
        provider: input.provider,
      },
    },
    select: {
      id: true,
      status: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      realmId: true,
      providerAccountId: true,
      scopes: true,
    },
  });

  if (!account || account.status !== "CONNECTED" || !account.accessTokenEncrypted) {
    throw new Error(`${input.provider} is not connected for this organization.`);
  }

  const nowWithSkew = new Date(Date.now() + TOKEN_REFRESH_EARLY_MS);
  const needsRefresh = Boolean(account.expiresAt && account.expiresAt <= nowWithSkew);

  if (!needsRefresh) {
    return {
      accessToken: decryptIntegrationToken(account.accessTokenEncrypted),
      realmId: account.realmId,
    };
  }

  if (!account.refreshTokenEncrypted) {
    throw new Error(`${input.provider} access token has expired and no refresh token is available.`);
  }

  const refreshToken = decryptIntegrationToken(account.refreshTokenEncrypted);
  const refreshed = await input.refresh(refreshToken);

  await saveIntegrationAccount({
    orgId: input.orgId,
    provider: input.provider,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    expiresAt: refreshed.expiresAt ?? null,
    providerAccountId: refreshed.providerAccountId ?? account.providerAccountId ?? null,
    realmId: refreshed.realmId ?? account.realmId ?? null,
    scopes: refreshed.scopes ?? account.scopes,
    status: "CONNECTED",
  });

  return {
    accessToken: refreshed.accessToken,
    realmId: refreshed.realmId ?? account.realmId,
  };
}
