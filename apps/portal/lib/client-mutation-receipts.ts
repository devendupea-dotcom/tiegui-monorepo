import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]+$/;
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

export type ClientMutationReceiptClaim =
  | {
      status: "acquired";
      receiptId: string;
    }
  | {
      status: "completed";
      responseJson: Prisma.JsonValue;
    }
  | {
      status: "in_flight";
    };

export function normalizeClientMutationIdempotencyKey(
  value: string | null | undefined,
): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return null;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildScopedClientMutationIdempotencyKey(
  scope: string,
  idempotencyKey: string,
): string {
  const normalizedScope = scope.trim();
  const normalizedKey = idempotencyKey.trim();
  if (!normalizedScope) {
    throw new Error("Client mutation receipt scope is required.");
  }
  if (!normalizedKey) {
    throw new Error("Client mutation receipt key is required.");
  }
  return `${normalizedScope}:${normalizedKey}`;
}

export async function claimClientMutationReceipt(
  tx: Tx,
  input: {
    orgId: string;
    route: string;
    idempotencyKey: string;
  },
): Promise<ClientMutationReceiptClaim> {
  const createResult = await tx.clientMutationReceipt.createMany({
    data: {
      orgId: input.orgId,
      route: input.route,
      idempotencyKey: input.idempotencyKey,
    },
    skipDuplicates: true,
  });

  const existing = await tx.clientMutationReceipt.findUnique({
    where: {
      orgId_idempotencyKey: {
        orgId: input.orgId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      id: true,
      route: true,
      responseJson: true,
    },
  });

  if (!existing) {
    return {
      status: "in_flight",
    };
  }

  if (createResult.count > 0) {
    return {
      status: "acquired",
      receiptId: existing.id,
    };
  }

  if (existing.route !== input.route) {
    return {
      status: "in_flight",
    };
  }

  if (existing.responseJson !== null) {
    return {
      status: "completed",
      responseJson: existing.responseJson as Prisma.JsonValue,
    };
  }

  return {
    status: "in_flight",
  };
}

export async function storeClientMutationReceiptResponse(
  tx: Tx,
  input: {
    receiptId: string;
    responseJson: Prisma.InputJsonValue;
  },
) {
  return tx.clientMutationReceipt.update({
    where: {
      id: input.receiptId,
    },
    data: {
      responseJson: input.responseJson,
    },
  });
}

export async function releaseClientMutationReceipt(
  tx: Tx,
  input: {
    receiptId: string;
  },
) {
  await tx.clientMutationReceipt
    .delete({
      where: {
        id: input.receiptId,
      },
    })
    .catch(() => undefined);
}
