import type { MessageStatus } from "@prisma/client";

export function mapTwilioLifecycleStatus(value: string | null | undefined): MessageStatus | null {
  switch ((value || "").trim().toLowerCase()) {
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending":
      return "QUEUED";
    case "sent":
      return "SENT";
    case "delivered":
    case "read":
      return "DELIVERED";
    case "failed":
    case "undelivered":
    case "canceled":
      return "FAILED";
    default:
      return null;
  }
}

export function shouldAdvanceOutboundSmsLifecycle(
  current: MessageStatus | null | undefined,
  incoming: MessageStatus | null | undefined,
): boolean {
  if (!incoming) {
    return false;
  }

  if (!current || current === incoming) {
    return true;
  }

  if (current === "DELIVERED" || current === "FAILED") {
    return false;
  }

  if (current === "SENT") {
    return incoming === "DELIVERED" || incoming === "FAILED";
  }

  if (current === "QUEUED") {
    return incoming === "SENT" || incoming === "DELIVERED" || incoming === "FAILED";
  }

  return false;
}
