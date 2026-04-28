const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://127.0.0.1:3001");
const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";
const VERCEL_AUTOMATION_BYPASS_SECRET =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || "";
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);
const DRY_RUN = (process.env.COLLECTIONS_CRON_DRY_RUN || "true").trim().toLowerCase() !== "false";
const LIMIT = process.env.COLLECTIONS_CRON_LIMIT || "1";
const SCAN_LIMIT = process.env.COLLECTIONS_CRON_SCAN_LIMIT || "10";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getJsonPreview(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 320);
}

function buildUrl(): URL {
  const url = new URL("/api/cron/invoice-collections", BASE_URL);
  url.searchParams.set("limit", LIMIT);
  url.searchParams.set("scanLimit", SCAN_LIMIT);
  if (DRY_RUN) {
    url.searchParams.set("dryRun", "1");
  }
  return url;
}

async function main() {
  if (!CRON_SECRET) {
    throw new Error("CRON_SECRET is required to verify invoice collections cron.");
  }

  const url = buildUrl();
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${CRON_SECRET}`,
  });

  if (VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers.set("x-vercel-protection-bypass", VERCEL_AUTOMATION_BYPASS_SECRET);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();

  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Invoice collections cron returned non-JSON ${response.status}: ${getJsonPreview(text)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Invoice collections cron returned ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  const result = payload as {
    ok?: boolean;
    dryRun?: boolean;
    scanned?: number;
    dueNowCount?: number;
    attemptedCount?: number;
    sentCount?: number;
    failureCount?: number;
  };

  if (result?.ok !== true) {
    throw new Error(`Invoice collections cron did not return ok=true: ${JSON.stringify(payload)}`);
  }

  console.log("Invoice collections cron verified.");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Dry run: ${result.dryRun === true ? "yes" : "no"}`);
  console.log(`Scanned: ${result.scanned ?? 0}`);
  console.log(`Due now: ${result.dueNowCount ?? 0}`);
  console.log(`Attempted: ${result.attemptedCount ?? 0}`);
  console.log(`Sent: ${result.sentCount ?? 0}`);
  console.log(`Failures: ${result.failureCount ?? 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
