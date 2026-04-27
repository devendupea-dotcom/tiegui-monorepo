import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  normalizeManualSmsIdempotencyKey,
  runIdempotentManualSmsMutation,
} from "../lib/manual-sms-idempotency.ts";

function duplicateKeyError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function createReceiptClient() {
  const receiptsByKey = new Map();
  const receiptsById = new Map();
  let nextId = 0;

  const tx = {
    clientMutationReceipt: {
      async create(input) {
        const key = `${input.data.orgId}|${input.data.idempotencyKey}`;
        if (receiptsByKey.has(key)) {
          throw duplicateKeyError();
        }

        const receipt = {
          id: `receipt_${++nextId}`,
          orgId: input.data.orgId,
          route: input.data.route,
          idempotencyKey: input.data.idempotencyKey,
          responseJson: null,
        };
        receiptsByKey.set(key, receipt);
        receiptsById.set(receipt.id, receipt);
        return { id: receipt.id };
      },
      async findUnique(input) {
        const key = `${input.where.orgId_idempotencyKey.orgId}|${input.where.orgId_idempotencyKey.idempotencyKey}`;
        const receipt = receiptsByKey.get(key);
        if (!receipt) return null;
        return {
          route: receipt.route,
          responseJson: receipt.responseJson,
        };
      },
      async update(input) {
        const receipt = receiptsById.get(input.where.id);
        if (!receipt) {
          throw new Error("missing receipt");
        }
        receipt.responseJson = input.data.responseJson;
        return receipt;
      },
      async delete(input) {
        const receipt = receiptsById.get(input.where.id);
        if (receipt) {
          receiptsById.delete(receipt.id);
          receiptsByKey.delete(`${receipt.orgId}|${receipt.idempotencyKey}`);
        }
      },
    },
  };

  return {
    async $transaction(callback) {
      return callback(tx);
    },
  };
}

function runSmsMutation(client, idempotencyKey, run) {
  return runIdempotentManualSmsMutation({
    client,
    orgId: "org_1",
    route: "/api/inbox/send",
    scope: "manual-sms:inbox-send",
    idempotencyKey,
    run,
  });
}

test("normalizeManualSmsIdempotencyKey accepts standard headers and body fallback", () => {
  const request = new Request("https://example.test/api/inbox/send", {
    method: "POST",
    headers: {
      "Idempotency-Key": " retry-key-1 ",
    },
  });

  assert.equal(normalizeManualSmsIdempotencyKey(request), "retry-key-1");
  assert.equal(
    normalizeManualSmsIdempotencyKey(
      new Request("https://example.test/api/inbox/send", { method: "POST" }),
      "body-key-1",
    ),
    "body-key-1",
  );
});

test("same manual SMS idempotency key returns the stored result", async () => {
  const client = createReceiptClient();
  let sends = 0;

  const first = await runSmsMutation(client, "retry-key-1", async () => {
    sends += 1;
    return {
      httpStatus: 200,
      body: {
        ok: true,
        message: {
          id: "message_1",
          status: "QUEUED",
        },
      },
    };
  });

  const second = await runSmsMutation(client, "retry-key-1", async () => {
    sends += 1;
    throw new Error("duplicate send should not run");
  });

  assert.equal(sends, 1);
  assert.deepEqual(second, first);
});

test("double-click while first manual SMS send is in flight does not double-send", async () => {
  const client = createReceiptClient();
  let sends = 0;
  let release;

  const first = runSmsMutation(
    client,
    "retry-key-2",
    () =>
      new Promise((resolve) => {
        sends += 1;
        release = () =>
          resolve({
            httpStatus: 200,
            body: {
              ok: true,
              message: {
                id: "message_2",
                status: "QUEUED",
              },
            },
          });
      }),
  );

  await new Promise((resolve) => setImmediate(resolve));

  const second = await runSmsMutation(client, "retry-key-2", async () => {
    sends += 1;
    throw new Error("duplicate in-flight send should not run");
  });

  assert.equal(sends, 1);
  assert.equal(second.httpStatus, 409);
  assert.match(String(second.body.error), /already in progress/i);

  release();
  assert.equal((await first).httpStatus, 200);
});
