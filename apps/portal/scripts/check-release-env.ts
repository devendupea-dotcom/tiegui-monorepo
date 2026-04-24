import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { config } from "dotenv";

type Severity = "required" | "warning";

type CheckResult = {
  name: string;
  ok: boolean;
  severity: Severity;
  detail: string;
};

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function loadEnv() {
  const envFile = getArgValue("--env-file") || process.env.PRISMA_ENV_FILE || null;
  if (envFile) {
    config({ path: resolve(envFile), override: true });
    return;
  }

  config({ path: resolve(process.cwd(), ".env") });
  config({ path: resolve(process.cwd(), ".env.local"), override: true });
}

function envValue(key: string): string {
  return process.env[key]?.trim() || "";
}

function hasEnv(key: string): boolean {
  return Boolean(envValue(key));
}

function required(name: string, keys: string[], detail?: string): CheckResult {
  const missing = keys.filter((key) => !hasEnv(key));
  return {
    name,
    ok: missing.length === 0,
    severity: "required",
    detail: missing.length === 0 ? detail || keys.join(", ") : `Missing: ${missing.join(", ")}`,
  };
}

function warning(name: string, ok: boolean, detail: string): CheckResult {
  return {
    name,
    ok,
    severity: "warning",
    detail,
  };
}

function requiredOneOf(name: string, keys: string[], detail?: string): CheckResult {
  const present = keys.filter((key) => hasEnv(key));
  return {
    name,
    ok: present.length > 0,
    severity: "required",
    detail: present.length > 0 ? `Using: ${present.join(", ")}` : detail || `Set one of: ${keys.join(", ")}`,
  };
}

function envEquals(key: string, expected: string): boolean {
  return envValue(key).toLowerCase() === expected.toLowerCase();
}

function isBase64ThirtyTwoByteKey(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

function buildChecks(): CheckResult[] {
  const checks: CheckResult[] = [
    required("Core database/auth", ["DATABASE_URL", "NEXTAUTH_URL", "NEXTAUTH_SECRET"]),
    requiredOneOf("Outbound email provider", ["SMTP_URL", "EMAIL_SERVER", "RESEND_API_KEY"]),
    required("Email sender", ["EMAIL_FROM"]),
    required("Cron auth", ["CRON_SECRET"]),
    required("Stripe billing", ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_CLIENT_ID", "STRIPE_WEBHOOK_SECRET"]),
    required("Twilio runtime flags", [
      "TWILIO_TOKEN_ENCRYPTION_KEY",
      "TWILIO_SEND_ENABLED",
      "TWILIO_VALIDATE_SIGNATURE",
    ]),
  ];

  checks.push(
    warning(
      "Prisma direct URL",
      hasEnv("DIRECT_URL"),
      hasEnv("DIRECT_URL")
        ? "DIRECT_URL is present for migrations."
        : "DIRECT_URL is recommended for reliable Prisma migrations; use DATABASE_URL only if no direct connection exists.",
    ),
  );

  const stripeSecret = envValue("STRIPE_SECRET_KEY");
  checks.push(
    warning(
      "Stripe secret shape",
      !stripeSecret || stripeSecret.startsWith("sk_"),
      stripeSecret
        ? "STRIPE_SECRET_KEY should start with sk_."
        : "Skipped because STRIPE_SECRET_KEY is missing.",
    ),
  );

  const stripeWebhookSecret = envValue("STRIPE_WEBHOOK_SECRET");
  checks.push(
    warning(
      "Stripe webhook secret shape",
      !stripeWebhookSecret || stripeWebhookSecret.startsWith("whsec_"),
      stripeWebhookSecret
        ? "STRIPE_WEBHOOK_SECRET should start with whsec_."
        : "Skipped because STRIPE_WEBHOOK_SECRET is missing.",
    ),
  );

  const stripeConnectClientId = envValue("STRIPE_CONNECT_CLIENT_ID");
  checks.push(
    warning(
      "Stripe Connect client id shape",
      !stripeConnectClientId || stripeConnectClientId.startsWith("ca_"),
      stripeConnectClientId
        ? "STRIPE_CONNECT_CLIENT_ID should start with ca_."
        : "Skipped because STRIPE_CONNECT_CLIENT_ID is missing.",
    ),
  );

  const twilioEncryptionKey = envValue("TWILIO_TOKEN_ENCRYPTION_KEY");
  checks.push(
    warning(
      "Twilio token encryption key shape",
      !twilioEncryptionKey || isBase64ThirtyTwoByteKey(twilioEncryptionKey),
      twilioEncryptionKey
        ? "TWILIO_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes."
        : "Skipped because TWILIO_TOKEN_ENCRYPTION_KEY is missing.",
    ),
  );

  if (envEquals("TWILIO_SEND_ENABLED", "true")) {
    checks.push(
      warning(
        "Twilio send mode",
        true,
        "TWILIO_SEND_ENABLED=true. Confirm org-level Twilio config is saved before live customer SMS.",
      ),
    );
  } else {
    checks.push(
      warning(
        "Twilio send mode",
        false,
        "TWILIO_SEND_ENABLED is not true; SMS compose may be queue-only or blocked.",
      ),
    );
  }

  if (envEquals("TWILIO_VALIDATE_SIGNATURE", "true")) {
    checks.push(required("Twilio webhook signature fallback", ["TWILIO_AUTH_TOKEN"]));
  }

  return checks;
}

function printResult(result: CheckResult) {
  const prefix = result.ok ? "PASS" : result.severity === "required" ? "FAIL" : "WARN";
  console.log(`${prefix} ${result.name}: ${result.detail}`);
}

loadEnv();

const checks = buildChecks();
for (const check of checks) {
  printResult(check);
}

const failedRequired = checks.filter((check) => check.severity === "required" && !check.ok);
const warnings = checks.filter((check) => check.severity === "warning" && !check.ok);

console.log("");
console.log(`Release env preflight: ${failedRequired.length === 0 ? "ready" : "blocked"}`);
console.log(`Required failures: ${failedRequired.length}`);
console.log(`Warnings: ${warnings.length}`);

if (failedRequired.length > 0) {
  process.exit(1);
}
