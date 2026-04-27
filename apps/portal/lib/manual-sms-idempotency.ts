import { Prisma } from "@prisma/client";
import {
  buildScopedClientMutationIdempotencyKey,
  claimClientMutationReceipt,
  normalizeClientMutationIdempotencyKey,
  releaseClientMutationReceipt,
  storeClientMutationReceiptResponse,
} from "@/lib/client-mutation-receipts";

type Tx = Prisma.TransactionClient;

type ReceiptClient = {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

export type ManualSmsApiResponse = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export const MANUAL_SMS_IN_FLIGHT_RESPONSE: ManualSmsApiResponse = {
  httpStatus: 409,
  body: {
    ok: false,
    error: "Message send is already in progress. Refresh the thread in a moment.",
  },
};

function serializeResponse(input: ManualSmsApiResponse): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export function normalizeManualSmsIdempotencyKey(
  req: Request,
  payloadKey?: unknown,
): string | null {
  return normalizeClientMutationIdempotencyKey(
    req.headers.get("Idempotency-Key") ||
      req.headers.get("x-idempotency-key") ||
      (typeof payloadKey === "string" ? payloadKey : null),
  );
}

export function readStoredManualSmsResponse(value: Prisma.JsonValue): ManualSmsApiResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const httpStatus = Number(record.httpStatus);
  const body = record.body;
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  return {
    httpStatus,
    body: body as Record<string, unknown>,
  };
}

export async function runIdempotentManualSmsMutation(input: {
  orgId: string;
  route: string;
  scope: string;
  idempotencyKey: string | null;
  run: () => Promise<ManualSmsApiResponse>;
  client?: ReceiptClient;
}): Promise<ManualSmsApiResponse> {
  const client: ReceiptClient =
    input.client || ((await import("@/lib/prisma")).prisma as unknown as ReceiptClient);
  const normalizedKey = input.idempotencyKey
    ? buildScopedClientMutationIdempotencyKey(input.scope, input.idempotencyKey)
    : null;

  if (!normalizedKey) {
    return input.run();
  }

  const claim = await client.$transaction((tx: Tx) =>
    claimClientMutationReceipt(tx, {
      orgId: input.orgId,
      route: input.route,
      idempotencyKey: normalizedKey,
    }),
  );

  if (claim.status === "completed") {
    return readStoredManualSmsResponse(claim.responseJson) || MANUAL_SMS_IN_FLIGHT_RESPONSE;
  }

  if (claim.status === "in_flight") {
    return MANUAL_SMS_IN_FLIGHT_RESPONSE;
  }

  try {
    const response = await input.run();
    await client.$transaction((tx: Tx) =>
      storeClientMutationReceiptResponse(tx, {
        receiptId: claim.receiptId,
        responseJson: serializeResponse(response),
      }),
    );
    return response;
  } catch (error) {
    await client
      .$transaction((tx: Tx) =>
        releaseClientMutationReceipt(tx, {
          receiptId: claim.receiptId,
        }),
      )
      .catch(() => undefined);
    throw error;
  }
}
