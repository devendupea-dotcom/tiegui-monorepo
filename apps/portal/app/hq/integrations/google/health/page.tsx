import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatDateTime, formatLabel } from "@/lib/hq";
import {
  clearStuckGoogleSyncJobs,
  getGoogleSyncHealthSnapshot,
  retryFailedGoogleSyncJobs,
  runGoogleSyncCycle,
} from "@/lib/integrations/google-sync";
import { requireInternalUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const HEALTH_PATH = "/hq/integrations/google/health";

function getParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.trim() ? first.trim() : null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseIntValue(value: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function buildRedirectUrl(params: Record<string, string>) {
  const search = new URLSearchParams(params);
  const query = search.toString();
  return query ? `${HEALTH_PATH}?${query}` : HEALTH_PATH;
}

function runStatusClass(value: string | null | undefined): string {
  if (!value) return "status-running";
  if (value === "OK") return "status-success";
  if (value === "ERROR") return "status-error";
  return "status-running";
}

async function runSyncNowAction(formData: FormData) {
  "use server";

  const internalUser = await requireInternalUser(HEALTH_PATH);
  const maxJobs = parseIntValue(formData.get("maxJobs"), 60, 1, 300);
  const maxAccounts = parseIntValue(formData.get("maxAccounts"), 40, 1, 200);

  try {
    const result = await runGoogleSyncCycle({
      maxJobs,
      maxAccounts,
      source: "MANUAL",
      triggeredByUserId: internalUser.id || null,
    });
    revalidatePath(HEALTH_PATH);
    redirect(
      buildRedirectUrl({
        saved: "run-sync",
        runId: result.runId,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run sync.";
    redirect(
      buildRedirectUrl({
        error: message.slice(0, 160),
      }),
    );
  }
}

async function retryFailedJobsAction(formData: FormData) {
  "use server";

  await requireInternalUser(HEALTH_PATH);
  const limit = parseIntValue(formData.get("retryLimit"), 200, 1, 2000);
  const result = await retryFailedGoogleSyncJobs({ limit });
  revalidatePath(HEALTH_PATH);
  redirect(
    buildRedirectUrl({
      saved: "retry-failed",
      retried: String(result.retried),
    }),
  );
}

async function clearStuckJobsAction(formData: FormData) {
  "use server";

  await requireInternalUser(HEALTH_PATH);
  const stuckMinutes = parseIntValue(formData.get("stuckMinutes"), 30, 5, 24 * 60);
  const limit = parseIntValue(formData.get("stuckLimit"), 200, 1, 1000);
  const result = await clearStuckGoogleSyncJobs({
    stuckMinutes,
    limit,
  });
  revalidatePath(HEALTH_PATH);
  redirect(
    buildRedirectUrl({
      saved: "clear-stuck",
      cleared: String(result.cleared),
    }),
  );
}

export default async function GoogleSyncHealthPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireInternalUser(HEALTH_PATH);
  const snapshot = await getGoogleSyncHealthSnapshot({
    errorLimit: 20,
    windowHours: 24,
    stuckMinutes: 30,
  });

  const saved = getParam(searchParams?.saved);
  const retried = getParam(searchParams?.retried);
  const cleared = getParam(searchParams?.cleared);
  const runId = getParam(searchParams?.runId);
  const error = getParam(searchParams?.error);

  return (
    <>
      <section className="grid">
        <article className="card kpi-card">
          <h2>Queue Ready</h2>
          <p className="kpi-value">{snapshot.queueDepth.ready}</p>
          <p className="muted">Jobs ready to run now.</p>
        </article>
        <article className="card kpi-card">
          <h2>Processing</h2>
          <p className="kpi-value">{snapshot.queueDepth.processing}</p>
          <p className="muted">Jobs currently claimed.</p>
        </article>
        <article className="card kpi-card">
          <h2>Failed</h2>
          <p className="kpi-value">{snapshot.queueDepth.failed}</p>
          <p className="muted">Jobs in error state.</p>
        </article>
        <article className="card kpi-card">
          <h2>Stuck</h2>
          <p className="kpi-value">{snapshot.queueDepth.stuck}</p>
          <p className="muted">Processing jobs older than {snapshot.stuckMinutes}m.</p>
        </article>
      </section>

      <section className="card">
        <h2>Google Sync Health</h2>
        <p className="muted">
          Queue depth, cron visibility, and safe recovery actions for Google Calendar sync workers.
        </p>

        {saved === "run-sync" ? (
          <p className="form-status">Manual sync started and recorded. Run ID: {runId || "-"}</p>
        ) : null}
        {saved === "retry-failed" ? <p className="form-status">Re-queued failed jobs: {retried || "0"}.</p> : null}
        {saved === "clear-stuck" ? <p className="form-status">Cleared stuck jobs: {cleared || "0"}.</p> : null}
        {error ? <p className="form-status">Error: {error}</p> : null}

        <div className="grid" style={{ marginTop: 12 }}>
          <article className="card">
            <h3>Run Sync Now</h3>
            <form action={runSyncNowAction} className="auth-form" style={{ marginTop: 10 }}>
              <label>
                Max queued jobs
                <input type="number" name="maxJobs" min={1} max={300} defaultValue={60} />
              </label>
              <label>
                Max accounts
                <input type="number" name="maxAccounts" min={1} max={200} defaultValue={40} />
              </label>
              <button className="btn primary" type="submit">
                Run Sync Now
              </button>
            </form>
          </article>

          <article className="card">
            <h3>Retry Failed Jobs</h3>
            <form action={retryFailedJobsAction} className="auth-form" style={{ marginTop: 10 }}>
              <label>
                Retry limit
                <input type="number" name="retryLimit" min={1} max={2000} defaultValue={200} />
              </label>
              <button className="btn secondary" type="submit">
                Retry Failed Jobs
              </button>
            </form>
          </article>

          <article className="card">
            <h3>Clear Stuck Jobs</h3>
            <form action={clearStuckJobsAction} className="auth-form" style={{ marginTop: 10 }}>
              <label>
                Mark as stuck after (minutes)
                <input type="number" name="stuckMinutes" min={5} max={1440} defaultValue={30} />
              </label>
              <label>
                Clear limit
                <input type="number" name="stuckLimit" min={1} max={1000} defaultValue={200} />
              </label>
              <button className="btn secondary" type="submit">
                Clear Stuck Jobs
              </button>
            </form>
          </article>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Last Cron Run</h2>
          {snapshot.lastCronRun ? (
            <>
              <p>
                <span className={`badge ${runStatusClass(snapshot.lastCronRun.status)}`}>
                  {formatLabel(snapshot.lastCronRun.status)}
                </span>
              </p>
              <p className="muted">Started: {formatDateTime(snapshot.lastCronRun.startedAt)}</p>
              <p className="muted">Finished: {formatDateTime(snapshot.lastCronRun.finishedAt)}</p>
              <p className="muted">
                Jobs: {snapshot.lastCronRun.jobsCompleted}/{snapshot.lastCronRun.jobsProcessed} completed
              </p>
              <p className="muted">Accounts failed: {snapshot.lastCronRun.accountsFailed}</p>
              {snapshot.lastCronRun.lastError ? (
                <p className="muted">Last error: {snapshot.lastCronRun.lastError}</p>
              ) : null}
            </>
          ) : (
            <p className="muted">No cron runs recorded yet.</p>
          )}
        </article>

        <article className="card">
          <h2>Success/Error Counts (24h)</h2>
          <p className="muted">Job attempts in last 24 hours</p>
          <p>
            <span className="badge status-success">Success: {snapshot.counts.jobSuccess}</span>{" "}
            <span className="badge status-error">Error: {snapshot.counts.jobError}</span>
          </p>
          <p className="muted" style={{ marginTop: 10 }}>Cron runs in last 24 hours</p>
          <p>
            <span className="badge status-success">Success: {snapshot.counts.cronSuccess}</span>{" "}
            <span className="badge status-error">Error: {snapshot.counts.cronError}</span>
          </p>
          {snapshot.lastRun ? (
            <p className="muted" style={{ marginTop: 10 }}>
              Last run: {formatLabel(snapshot.lastRun.source)} {formatDateTime(snapshot.lastRun.startedAt)}
            </p>
          ) : null}
        </article>
      </section>

      <section className="card">
        <h2>Last 20 Errors</h2>
        {snapshot.recentErrors.length === 0 ? (
          <p className="muted">No sync errors captured.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Org</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Attempt</th>
                  <th>Next Run</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentErrors.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.org.name}</td>
                    <td>{item.user.name || item.user.email}</td>
                    <td>{formatLabel(item.action)}</td>
                    <td>{item.attemptNumber}</td>
                    <td>
                      {formatDateTime(item.nextRunAt)}{" "}
                      {item.backoffMs ? <span className="muted">({Math.round(item.backoffMs / 1000)}s backoff)</span> : null}
                    </td>
                    <td>{item.errorMessage || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
