import { randomBytes } from "node:crypto";
import type { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function createStateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createIntegrationOAuthState(input: {
  orgId: string;
  provider: IntegrationProvider;
  redirectUri: string;
}) {
  const state = createStateToken();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  await prisma.integrationOAuthState.create({
    data: {
      orgId: input.orgId,
      provider: input.provider,
      state,
      redirectUri: input.redirectUri,
      expiresAt,
    },
  });

  return state;
}

export async function consumeIntegrationOAuthState(input: {
  provider: IntegrationProvider;
  state: string;
}) {
  const now = new Date();
  const match = await prisma.integrationOAuthState.findUnique({
    where: { state: input.state },
    select: {
      id: true,
      orgId: true,
      provider: true,
      redirectUri: true,
      expiresAt: true,
      consumedAt: true,
    },
  });

  if (!match || match.provider !== input.provider || match.expiresAt <= now || match.consumedAt) {
    return null;
  }

  await prisma.integrationOAuthState.update({
    where: { id: match.id },
    data: { consumedAt: now },
  });

  return match;
}
