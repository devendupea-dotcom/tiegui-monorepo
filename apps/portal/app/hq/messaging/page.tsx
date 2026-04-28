import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatDateTime, formatLabel } from "@/lib/hq";
import { requireInternalUser } from "@/lib/session";
import {
  getSmsTrustCenterSnapshot,
  pauseOrgSmsAutomation,
  type SmsTrustCenterSnapshot,
  type SmsTrustMode,
  type SmsTrustOrgSnapshot,
  type SmsTrustVerdict,
} from "@/lib/sms-trust-center";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function maskPhone(value: string | null): string {
  const normalized = (value || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return normalized || "-";
  return `${normalized.startsWith("+") ? "+" : ""}***${digits.slice(-4)}`;
}

function verdictClass(verdict: SmsTrustVerdict): string {
  if (verdict === "READY") return "status-success";
  if (verdict === "BLOCKED") return "status-overdue";
  return "status-follow_up";
}

function modeClass(mode: SmsTrustMode): string {
  if (mode === "AUTOPILOT") return "status-success";
  if (mode === "ASSISTED") return "status-running";
  if (mode === "DRAFT_ONLY") return "status-follow_up";
  return "status-new";
}

function formatMode(mode: SmsTrustMode): string {
  if (mode === "DRAFT_ONLY") return "Draft Only";
  return formatLabel(mode);
}

function formatDate(value: string | null): string {
  return value ? formatDateTime(new Date(value)) : "-";
}

function IssueList({ org }: { org: SmsTrustOrgSnapshot }) {
  if (org.blockers.length === 0) {
    return <p className="muted">No active blockers.</p>;
  }

  return (
    <ul className="dashboard-list">
      {org.blockers.map((blocker) => (
        <li key={blocker.code} className="dashboard-list-row">
          <div className="dashboard-list-primary">
            <strong>{formatLabel(blocker.code)}</strong>
            <p className="muted" style={{ margin: 0 }}>
              {blocker.label}
            </p>
          </div>
          <span className={`badge ${blocker.severity === "critical" ? "status-overdue" : "status-follow_up"}`}>
            {blocker.severity}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Checklist({ org }: { org: SmsTrustOrgSnapshot }) {
  return (
    <div className="dashboard-status-list">
      {org.checklist.map((item) => (
        <div key={item.key} className="dashboard-status-row">
          <span>
            <strong>{item.label}</strong>
            <small className="muted" style={{ display: "block", marginTop: 2 }}>
              {item.detail}
            </small>
          </span>
          <span className={`badge ${item.passed ? "status-success" : "status-overdue"}`}>
            {item.passed ? "Pass" : "Needs work"}
          </span>
        </div>
      ))}
    </div>
  );
}

function OrgActions({ org }: { org: SmsTrustOrgSnapshot }) {
  const hasAutomations = org.activeAutomationCount > 0;

  return (
    <div className="quick-links">
      <Link className="btn secondary" href={`/app/inbox?orgId=${org.orgId}`}>
        Review Inbox
      </Link>
      <Link className="btn secondary" href={`/hq/orgs/${org.orgId}/twilio`}>
        Twilio Setup
      </Link>
      <Link className="btn secondary" href={`/app/settings?orgId=${org.orgId}#settings-messaging`}>
        App Settings
      </Link>
      {hasAutomations ? (
        <form action={pauseAutomationAction}>
          <input type="hidden" name="orgId" value={org.orgId} />
          <button type="submit" className="btn secondary">
            Pause Automation
          </button>
        </form>
      ) : null}
    </div>
  );
}

function TrustSummaryCards({ snapshot }: { snapshot: SmsTrustCenterSnapshot }) {
  return (
    <section className="grid">
      <article className="card kpi-card">
        <h2>Ready</h2>
        <p className="kpi-value">{snapshot.totals.ready}</p>
      </article>
      <article className="card kpi-card">
        <h2>Attention</h2>
        <p className="kpi-value">{snapshot.totals.attention}</p>
      </article>
      <article className="card kpi-card">
        <h2>Blocked</h2>
        <p className="kpi-value">{snapshot.totals.blocked}</p>
      </article>
      <article className="card kpi-card">
        <h2>Needs Review</h2>
        <p className="kpi-value">{snapshot.totals.reviewQueue}</p>
      </article>
      <article className="card kpi-card">
        <h2>Failed 24h</h2>
        <p className="kpi-value">{snapshot.totals.failedLast24h}</p>
      </article>
    </section>
  );
}

function EnvironmentPanel({ snapshot }: { snapshot: SmsTrustCenterSnapshot }) {
  return (
    <section className="card">
      <div className="dashboard-panel-head">
        <div className="dashboard-panel-copy">
          <p className="dashboard-panel-eyebrow">Runtime</p>
          <h2>SMS Safety Environment</h2>
          <p className="muted">
            These are deployment-wide gates. If they are not right, no org should be trusted on autopilot.
          </p>
        </div>
      </div>
      <div className="dashboard-status-list">
        <div className="dashboard-status-row">
          <span>Live SMS sending</span>
          <span className={`badge ${snapshot.environment.sendEnabled ? "status-success" : "status-follow_up"}`}>
            {snapshot.environment.sendEnabled ? "Enabled" : "Queue only"}
          </span>
        </div>
        <div className="dashboard-status-row">
          <span>Twilio token encryption key</span>
          <span className={`badge ${snapshot.environment.tokenEncryptionKeyPresent ? "status-success" : "status-overdue"}`}>
            {snapshot.environment.tokenEncryptionKeyPresent ? "Present" : "Missing"}
          </span>
        </div>
        <div className="dashboard-status-row">
          <span>Webhook signature validation</span>
          <span className={`badge ${snapshot.environment.webhookValidationMode === "validate" ? "status-success" : "status-overdue"}`}>
            {snapshot.environment.webhookValidationMode}
          </span>
        </div>
      </div>
    </section>
  );
}

async function pauseAutomationAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/hq/messaging?error=missing-org");
  }

  await requireInternalUser("/hq/messaging");
  await pauseOrgSmsAutomation(orgId);

  revalidatePath("/hq/messaging");
  revalidatePath("/app/settings");
  revalidatePath("/app");

  redirect(`/hq/messaging?paused=${encodeURIComponent(orgId)}`);
}

export default async function HqMessagingTrustPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const paused = getParam(searchParams?.paused);
  const error = getParam(searchParams?.error);
  const snapshot = await getSmsTrustCenterSnapshot();

  return (
    <>
      <section className="card">
        <div className="hq-header-top">
          <div>
            <h2>SMS Trust Center</h2>
            <p className="muted">
              Cross-org control tower for Twilio readiness, compliance, automation safety, owner review, failed sends, and callback drift.
            </p>
          </div>
          <div className="hq-header-actions">
            <Link className="btn secondary" href="/hq/inbox">
              Open HQ Inbox
            </Link>
            <Link className="btn secondary" href="/api/internal/health" target="_blank" rel="noreferrer">
              Internal Health
            </Link>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Last generated {formatDate(snapshot.generatedAt)}
        </p>
      </section>

      {paused ? (
        <section className="card tone-panel warning">
          <p className="muted" style={{ margin: 0 }}>
            Automation paused for workspace {paused}. Manual SMS and inbox review remain available.
          </p>
        </section>
      ) : null}

      {error ? (
        <section className="card tone-panel danger">
          <p className="muted" style={{ margin: 0 }}>
            SMS Trust Center action failed: {error}
          </p>
        </section>
      ) : null}

      <TrustSummaryCards snapshot={snapshot} />
      <EnvironmentPanel snapshot={snapshot} />

      <section className="card">
        <div className="dashboard-panel-head">
          <div className="dashboard-panel-copy">
            <p className="dashboard-panel-eyebrow">Organizations</p>
            <h2>Automation Trust by Workspace</h2>
            <p className="muted">
              Autopilot is only safe when Twilio is live, compliance gates pass, owner review is clear, and delivery telemetry is clean.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Verdict</th>
                <th>Mode</th>
                <th>Twilio</th>
                <th>Needs Review</th>
                <th>Queue / Failures</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.orgs.length === 0 ? (
                <tr>
                  <td colSpan={7}>No organizations found.</td>
                </tr>
              ) : (
                snapshot.orgs.map((org) => (
                  <tr key={org.orgId}>
                    <td>
                      <details>
                        <summary>
                          <strong>{org.orgName}</strong>
                        </summary>
                        <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                          {org.error ? (
                            <p className="muted text-danger" style={{ margin: 0 }}>
                              Health load error: {org.error}
                            </p>
                          ) : null}
                          <div>
                            <strong>Blockers</strong>
                            <IssueList org={org} />
                          </div>
                          <div>
                            <strong>Compliance checklist</strong>
                            <Checklist org={org} />
                          </div>
                          {org.health ? (
                            <div>
                              <strong>Recent telemetry</strong>
                              <div className="dashboard-status-list" style={{ marginTop: 8 }}>
                                <div className="dashboard-status-row">
                                  <span>Latest inbound SMS</span>
                                  <span>{formatDate(org.health.signals.latestInboundSmsAt)}</span>
                                </div>
                                <div className="dashboard-status-row">
                                  <span>Latest inbound call</span>
                                  <span>{formatDate(org.health.signals.latestInboundCallAt)}</span>
                                </div>
                                <div className="dashboard-status-row">
                                  <span>Intake cron</span>
                                  <span className={`badge ${org.health.cron.intake.stale ? "status-overdue" : "status-success"}`}>
                                    {org.health.cron.intake.stale ? "Stale" : "Fresh"}
                                  </span>
                                </div>
                                <div className="dashboard-status-row">
                                  <span>Ghost-buster cron</span>
                                  <span className={`badge ${org.health.cron.ghostBuster.stale ? "status-overdue" : "status-success"}`}>
                                    {org.health.cron.ghostBuster.stale ? "Stale" : "Fresh"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    </td>
                    <td>
                      <span className={`badge ${verdictClass(org.verdict)}`}>
                        {formatLabel(org.verdict)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${modeClass(org.mode)}`}>
                        {formatMode(org.mode)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span>{formatLabel(org.readinessCode)}</span>
                        <small className="muted">{maskPhone(org.twilioPhoneNumber)}</small>
                      </div>
                    </td>
                    <td>{org.reviewQueueCount}</td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span>Due now: {org.health?.queue.dueNowCount ?? 0}</span>
                        <small className="muted">
                          Failed 24h: {org.health ? org.health.queue.failedLast24hCount + org.health.queue.outboundFailedLast24hCount : 0}
                          {" "} / Unmatched 30d: {org.unmatchedCallbacks30dCount}
                        </small>
                      </div>
                    </td>
                    <td>
                      <OrgActions org={org} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
