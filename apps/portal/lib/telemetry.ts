type PortalEventName =
  | "Onboarding Started"
  | "Onboarding Completed"
  | "Lead Created"
  | "Job Created"
  | "Invoice Printed"
  | "SMS Connected";

type PortalEventPayload = Record<string, unknown>;

const TELEMETRY_PREFIX = "[portal-telemetry]";

export async function trackPortalEvent(event: PortalEventName, payload: PortalEventPayload = {}) {
  const snapshot = {
    event,
    at: new Date().toISOString(),
    ...payload,
  };

  console.info(`${TELEMETRY_PREFIX} event`, snapshot);

  try {
    const sentry = await import("@sentry/nextjs");
    sentry.captureMessage(`${TELEMETRY_PREFIX} ${event}`, {
      level: "info",
      extra: snapshot,
      tags: {
        surface: "portal",
      },
    });
  } catch {
    // Sentry is optional for local/dev environments.
  }
}

export async function capturePortalError(error: unknown, context: PortalEventPayload = {}) {
  const snapshot = {
    at: new Date().toISOString(),
    ...context,
  };

  console.error(`${TELEMETRY_PREFIX} error`, error, snapshot);

  try {
    const sentry = await import("@sentry/nextjs");
    if (error instanceof Error) {
      sentry.captureException(error, {
        tags: { surface: "portal" },
        extra: snapshot,
      });
    } else {
      sentry.captureMessage(`${TELEMETRY_PREFIX} non-error exception`, {
        level: "error",
        tags: { surface: "portal" },
        extra: { ...snapshot, error },
      });
    }
  } catch {
    // Sentry is optional for local/dev environments.
  }
}
