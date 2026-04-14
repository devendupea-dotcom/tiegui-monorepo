// Known upstream build warning: Next.js still reports require-in-the-middle from Sentry/OpenTelemetry during server builds, and current latest @sentry/nextjs still transitively pulls that instrumentation path.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0.05,
});
