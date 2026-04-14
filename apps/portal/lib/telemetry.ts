type PortalEventName =
  | "Onboarding Started"
  | "Onboarding Completed"
  | "Lead Created"
  | "Job Created"
  | "Invoice Sent"
  | "Invoice Printed"
  | "SMS Connected";

type PortalEventPayload = Record<string, unknown>;

const TELEMETRY_PREFIX = "[portal-telemetry]";

type PortalErrorTelemetry = {
  expected: boolean;
  level: "info" | "error";
  status: number | null;
};

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const status = Reflect.get(error, "status");
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function classifyPortalError(error: unknown): PortalErrorTelemetry {
  const status = getErrorStatus(error);
  const expected = status !== null && status >= 400 && status < 500;

  return {
    expected,
    level: expected ? "info" : "error",
    status,
  };
}

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
  const telemetry = classifyPortalError(error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const snapshot = {
    at: new Date().toISOString(),
    ...(telemetry.status !== null ? { status: telemetry.status } : {}),
    ...context,
  };

  if (telemetry.expected) {
    console.info(`${TELEMETRY_PREFIX} handled`, {
      message: errorMessage,
      ...snapshot,
    });
  } else {
    console.error(`${TELEMETRY_PREFIX} error`, error, snapshot);
  }

  try {
    const sentry = await import("@sentry/nextjs");
    if (telemetry.expected) {
      sentry.captureMessage(`${TELEMETRY_PREFIX} handled ${telemetry.status ?? "4xx"}`, {
        level: telemetry.level,
        extra: {
          ...snapshot,
          message: errorMessage,
        },
        tags: {
          surface: "portal",
          expected: "true",
          ...(telemetry.status !== null ? { status: String(telemetry.status) } : {}),
        },
      });
    } else if (error instanceof Error) {
      sentry.captureException(error, {
        tags: {
          surface: "portal",
          ...(telemetry.status !== null ? { status: String(telemetry.status) } : {}),
        },
        extra: snapshot,
      });
    } else {
      sentry.captureMessage(`${TELEMETRY_PREFIX} non-error exception`, {
        level: "error",
        tags: {
          surface: "portal",
          ...(telemetry.status !== null ? { status: String(telemetry.status) } : {}),
        },
        extra: { ...snapshot, error },
      });
    }
  } catch {
    // Sentry is optional for local/dev environments.
  }
}
