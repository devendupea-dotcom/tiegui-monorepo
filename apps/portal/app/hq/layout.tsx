import Link from "next/link";
import { getGoogleSyncAlertState } from "@/lib/integrations/google-sync";
import { checkRequiredTables } from "@/lib/internal-health";
import { requireInternalUser } from "@/lib/session";
import LogoutButton from "../app/logout-button";

const links = [
  { href: "/hq", label: "Command Center" },
  { href: "/hq/inbox", label: "Inbox" },
  { href: "/hq/calendar", label: "Calendar" },
  { href: "/hq/businesses", label: "Businesses" },
  { href: "/hq/integrations/google/health", label: "Sync Health" },
];

export default async function HqLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireInternalUser("/hq");
  const dbTables = await checkRequiredTables({ ttlMs: 60_000 }).catch(() => null);
  const syncAlert = await getGoogleSyncAlertState({
    cronStaleMinutes: 15,
    queueDepthThreshold: 80,
    errorRateThreshold: 0.25,
    errorRateWindowMinutes: 60,
  }).catch(() => null);

  const alertReasons: string[] = [];
  if (syncAlert?.flags.staleCron) {
    if (syncAlert.lastCronMinutesAgo === null) {
      alertReasons.push("No cron run has been recorded yet");
    } else {
      alertReasons.push(
        `Last cron run ${syncAlert.lastCronMinutesAgo}m ago (threshold ${syncAlert.thresholds.cronStaleMinutes}m)`,
      );
    }
  }
  if (syncAlert?.flags.queueDepthExceeded) {
    alertReasons.push(
      `Queue depth ${syncAlert.queueDepth.totalOpen} (threshold ${syncAlert.thresholds.queueDepthThreshold})`,
    );
  }
  if (syncAlert?.flags.errorRateExceeded) {
    alertReasons.push(
      `Recent error rate ${(syncAlert.recent.errorRate * 100).toFixed(1)}% over ${syncAlert.recent.windowMinutes}m`,
    );
  }

  const missingTables = dbTables?.missing || [];
  const missingPreview = missingTables.slice(0, 4).join(", ");
  const missingSuffix = missingTables.length > 4 ? `, and ${missingTables.length - 4} more` : "";

  return (
    <main className="page">
      <header className="card hq-header">
        <div className="hq-header-top">
          <div>
            <h1>TieGui HQ</h1>
            <p className="muted">Internal workspace for cross-business operations.</p>
          </div>
          <div className="hq-header-actions">
            <Link className="btn secondary" href="/app">
              Open Client Portal
            </Link>
            <LogoutButton />
          </div>
        </div>
        <nav className="hq-nav" aria-label="HQ navigation">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hq-nav-link">
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {!dbTables ? (
        <section
          className="card"
          style={{
            borderColor: "rgba(245, 158, 11, 0.50)",
            background: "rgba(245, 158, 11, 0.08)",
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            DB health check failed. Some features may be broken until migrations are applied.{" "}
            <a href="/api/internal/health" className="link" target="_blank" rel="noreferrer">
              View internal health
            </a>
            .
          </p>
        </section>
      ) : missingTables.length > 0 ? (
        <section
          className="card"
          style={{
            borderColor: "rgba(245, 158, 11, 0.50)",
            background: "rgba(245, 158, 11, 0.08)",
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            DB schema incomplete: missing {missingPreview}
            {missingSuffix}. Run migrations before treating prod as live.{" "}
            <a href="/api/internal/health" className="link" target="_blank" rel="noreferrer">
              View internal health
            </a>
            .
          </p>
        </section>
      ) : null}
      {syncAlert?.showBanner ? (
        <section
          className="card"
          style={{
            borderColor: "rgba(255, 107, 107, 0.55)",
            background: "rgba(71, 19, 19, 0.35)",
          }}
        >
          <h2 style={{ marginBottom: 8 }}>Google Sync Warning</h2>
          <p className="muted">
            {alertReasons.join(" • ")}. Review sync health to run recovery actions.
          </p>
          <div className="quick-links" style={{ marginTop: 12 }}>
            <Link className="btn secondary" href="/hq/integrations/google/health">
              Open Sync Health
            </Link>
          </div>
        </section>
      ) : null}
      {children}
    </main>
  );
}
