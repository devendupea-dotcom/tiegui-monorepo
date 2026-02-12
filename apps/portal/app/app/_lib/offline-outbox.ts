"use client";

import { createStore, get, set } from "idb-keyval";

const OUTBOX_DB_NAME = "tiegui-offline-v1";
const OUTBOX_STORE_NAME = "mutation-outbox";
const OUTBOX_KEY = "queue";
const OUTBOX_EVENT = "tiegui:offline-outbox-updated";

const outboxStore = createStore(OUTBOX_DB_NAME, OUTBOX_STORE_NAME);

type OutboxAction = "appendJobNote" | "updateJobStatus";
type OutboxMethod = "POST" | "PATCH";

export type OfflineOutboxItem = {
  id: string;
  action: OutboxAction;
  jobId: string;
  endpoint: string;
  method: OutboxMethod;
  body: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

type QueueMutationInput = {
  action: OutboxAction;
  jobId: string;
  endpoint: string;
  method: OutboxMethod;
  body: Record<string, unknown>;
};

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `outbox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isQueueItem(value: unknown): value is OfflineOutboxItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OfflineOutboxItem>;
  return (
    typeof item.id === "string" &&
    typeof item.action === "string" &&
    typeof item.jobId === "string" &&
    typeof item.endpoint === "string" &&
    (item.method === "POST" || item.method === "PATCH") &&
    typeof item.idempotencyKey === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.attempts === "number"
  );
}

async function readQueue(): Promise<OfflineOutboxItem[]> {
  const raw = await get<unknown>(OUTBOX_KEY, outboxStore);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isQueueItem);
}

async function writeQueue(nextQueue: OfflineOutboxItem[]): Promise<void> {
  await set(OUTBOX_KEY, nextQueue, outboxStore);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(OUTBOX_EVENT, {
        detail: {
          pendingCount: nextQueue.length,
        },
      }),
    );
  }
}

export function subscribeOfflineOutbox(listener: (pendingCount: number) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ pendingCount?: unknown }>;
    const pendingCount = Number(customEvent.detail?.pendingCount || 0);
    listener(Number.isFinite(pendingCount) ? pendingCount : 0);
  };

  window.addEventListener(OUTBOX_EVENT, handler);
  return () => window.removeEventListener(OUTBOX_EVENT, handler);
}

export async function getOfflineOutboxCount(jobId?: string): Promise<number> {
  const queue = await readQueue();
  if (!jobId) {
    return queue.length;
  }
  return queue.filter((item) => item.jobId === jobId).length;
}

export async function enqueueOfflineMutation(input: QueueMutationInput): Promise<OfflineOutboxItem> {
  const queue = await readQueue();
  const nextItem: OfflineOutboxItem = {
    id: createId(),
    action: input.action,
    jobId: input.jobId,
    endpoint: input.endpoint,
    method: input.method,
    body: input.body,
    idempotencyKey: createId(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };

  // Keep status queue deterministic and compact by only retaining the latest status mutation.
  const trimmedQueue =
    input.action === "updateJobStatus"
      ? queue.filter((item) => !(item.action === "updateJobStatus" && item.jobId === input.jobId))
      : queue;

  const nextQueue = [...trimmedQueue, nextItem];
  await writeQueue(nextQueue);
  return nextItem;
}

function isOfflineLikeError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror");
}

export async function replayOfflineOutbox(): Promise<{
  processed: number;
  failed: number;
  remaining: number;
}> {
  const queue = await readQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { processed: 0, failed: 0, remaining: queue.length };
  }

  const remainingQueue: OfflineOutboxItem[] = [];
  let processed = 0;
  let failed = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item) continue;

    try {
      const response = await fetch(item.endpoint, {
        method: item.method,
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": item.idempotencyKey,
        },
        body: JSON.stringify(item.body),
      });

      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        const message = payload?.error || `Request failed with status ${response.status}.`;
        throw new Error(message);
      }

      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Failed to replay offline mutation.";
      const failedItem: OfflineOutboxItem = {
        ...item,
        attempts: item.attempts + 1,
        lastError: message.slice(0, 2000),
      };
      remainingQueue.push(failedItem);

      // If we lost network again, keep the rest of the queue untouched for a later retry.
      if (isOfflineLikeError(error)) {
        const untouched = queue.slice(index + 1);
        remainingQueue.push(...untouched);
        break;
      }
    }
  }

  await writeQueue(remainingQueue);
  return {
    processed,
    failed,
    remaining: remainingQueue.length,
  };
}
