import type { Prisma } from "@prisma/client";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

function normalizeBlockedCallerPhone(value: string | null | undefined) {
  return normalizeE164(value || null);
}

export async function findBlockedCallerByPhone(input: {
  orgId: string;
  phone: string | null | undefined;
  tx?: Tx;
}) {
  const phoneE164 = normalizeBlockedCallerPhone(input.phone);
  if (!phoneE164) {
    return null;
  }

  const client = input.tx || prisma;
  return client.blockedCaller.findUnique({
    where: {
      orgId_phoneE164: {
        orgId: input.orgId,
        phoneE164,
      },
    },
    select: {
      id: true,
      orgId: true,
      phoneE164: true,
      reason: true,
      sourceLeadId: true,
      createdAt: true,
    },
  });
}

export async function isBlockedCaller(input: {
  orgId: string;
  phone: string | null | undefined;
  tx?: Tx;
}) {
  return Boolean(await findBlockedCallerByPhone(input));
}

export async function upsertBlockedCaller(
  tx: Tx,
  input: {
    orgId: string;
    phone: string | null | undefined;
    reason?: string | null;
    sourceLeadId?: string | null;
    createdByUserId?: string | null;
  },
) {
  const phoneE164 = normalizeBlockedCallerPhone(input.phone);
  if (!phoneE164) {
    return null;
  }

  const nextReason = `${input.reason || ""}`.trim() || null;

  return tx.blockedCaller.upsert({
    where: {
      orgId_phoneE164: {
        orgId: input.orgId,
        phoneE164,
      },
    },
    create: {
      orgId: input.orgId,
      phoneE164,
      reason: nextReason,
      sourceLeadId: input.sourceLeadId || null,
      createdByUserId: input.createdByUserId || null,
    },
    update: {
      reason: nextReason,
      sourceLeadId: input.sourceLeadId || null,
      createdByUserId: input.createdByUserId || null,
    },
    select: {
      id: true,
      phoneE164: true,
    },
  });
}
