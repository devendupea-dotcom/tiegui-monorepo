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
  const envFile =
    getArgValue("--env-file") || process.env.PRISMA_ENV_FILE || null;
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
    detail:
      missing.length === 0
        ? detail || keys.join(", ")
        : `Missing: ${missing.join(", ")}`,
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

function requiredCondition(
  name: string,
  ok: boolean,
  detail: string,
): CheckResult {
  return {
    name,
    ok,
    severity: "required",
    detail,
  };
}

function requiredOneOf(
  name: string,
  keys: string[],
  detail?: string,
): CheckResult {
  const present = keys.filter((key) => hasEnv(key));
  return {
    name,
    ok: present.length > 0,
    severity: "required",
    detail:
      present.length > 0
        ? `Using: ${present.join(", ")}`
        : detail || `Set one of: ${keys.join(", ")}`,
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

function requiredShape(
  name: string,
  key: string,
  isValid: (value: string) => boolean,
  expectedDescription: string,
): CheckResult {
  const value = envValue(key);
  if (!value) {
    return requiredCondition(
      name,
      true,
      `Skipped because ${key} is missing; missing key is reported by the required env check.`,
    );
  }

  return requiredCondition(
    name,
    isValid(value),
    isValid(value)
      ? `${key} has expected format.`
      : `${key} is malformed; expected ${expectedDescription}.`,
  );
}

function buildChecks(): CheckResult[] {
  const checks: CheckResult[] = [
    required("Core database/auth", [
      "DATABASE_URL",
      "NEXTAUTH_URL",
      "NEXTAUTH_SECRET",
    ]),
    requiredOneOf("Outbound email provider", [
      "SMTP_URL",
      "EMAIL_SERVER",
      "RESEND_API_KEY",
    ]),
    required("Email sender", ["EMAIL_FROM"]),
    required("Cron auth", ["CRON_SECRET"]),
    required("Stripe billing", [
      "STRIPE_SECRET_KEY",
      "STRIPE_CONNECT_CLIENT_ID",
      "STRIPE_WEBHOOK_SECRET",
    ]),
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

  checks.push(
    requiredShape(
      "Stripe secret shape",
      "STRIPE_SECRET_KEY",
      (value) => value.startsWith("sk_"),
      "a value that starts with sk_",
    ),
  );

  checks.push(
    requiredShape(
      "Stripe webhook secret shape",
      "STRIPE_WEBHOOK_SECRET",
      (value) => value.startsWith("whsec_"),
      "a value that starts with whsec_",
    ),
  );

  checks.push(
    requiredShape(
      "Stripe Connect client id shape",
      "STRIPE_CONNECT_CLIENT_ID",
      (value) => value.startsWith("ca_"),
      "a value that starts with ca_",
    ),
  );

  checks.push(
    requiredShape(
      "Twilio token encryption key shape",
      "TWILIO_TOKEN_ENCRYPTION_KEY",
      isBase64ThirtyTwoByteKey,
      "base64 that decodes to exactly 32 bytes",
    ),
  );

  checks.push(
    requiredCondition(
      "Twilio send mode",
      envEquals("TWILIO_SEND_ENABLED", "true"),
      envEquals("TWILIO_SEND_ENABLED", "true")
        ? "TWILIO_SEND_ENABLED=true. Confirm org-level Twilio config is saved before live customer SMS."
        : "TWILIO_SEND_ENABLED must be true for customer go-live; otherwise outbound SMS is queue-only or blocked.",
    ),
  );

  checks.push(
    requiredCondition(
      "Twilio webhook signature validation",
      envEquals("TWILIO_VALIDATE_SIGNATURE", "true"),
      envEquals("TWILIO_VALIDATE_SIGNATURE", "true")
        ? "TWILIO_VALIDATE_SIGNATURE=true."
        : "TWILIO_VALIDATE_SIGNATURE must be true for customer go-live to reject unsigned webhook traffic.",
    ),
  );

  if (envEquals("TWILIO_VALIDATE_SIGNATURE", "true")) {
    checks.push(
      warning(
        "Twilio webhook signature fallback",
        hasEnv("TWILIO_AUTH_TOKEN"),
        "TWILIO_AUTH_TOKEN is only needed as a fallback; per-org Twilio credentials can validate signed webhooks without it.",
      ),
    );
  }

  return checks;
}

function printResult(result: CheckResult) {
  const prefix = result.ok
    ? "PASS"
    : result.severity === "required"
      ? "FAIL"
      : "WARN";
  console.log(`${prefix} ${result.name}: ${result.detail}`);
}

loadEnv();

const checks = buildChecks();
for (const check of checks) {
  printResult(check);
}

const failedRequired = checks.filter(
  (check) => check.severity === "required" && !check.ok,
);
const warnings = checks.filter(
  (check) => check.severity === "warning" && !check.ok,
);

console.log("");
console.log(
  `Release env preflight: ${failedRequired.length === 0 ? "ready" : "blocked"}`,
);
console.log(`Required failures: ${failedRequired.length}`);
console.log(`Warnings: ${warnings.length}`);

if (failedRequired.length > 0) {
  process.exit(1);
}
