import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function createStateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createGoogleOAuthState(input: {
  orgId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  wantsWrite: boolean;
}) {
  const state = createStateToken();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  await prisma.googleOAuthState.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      state,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      wantsWrite: input.wantsWrite,
      expiresAt,
    },
  });

  return state;
}

export async function consumeGoogleOAuthState(state: string) {
  const now = new Date();
  const match = await prisma.googleOAuthState.findUnique({
    where: { state },
    select: {
      id: true,
      orgId: true,
      userId: true,
      redirectUri: true,
      scopes: true,
      wantsWrite: true,
      expiresAt: true,
      consumedAt: true,
    },
  });

  if (!match || match.expiresAt <= now || match.consumedAt) {
    return null;
  }

  await prisma.googleOAuthState.update({
    where: { id: match.id },
    data: {
      consumedAt: now,
    },
  });

  return match;
}
