import Link from "next/link";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import type {
  MessagingAutomationFailureItem,
  MessagingAutomationHealthIssueCode,
  MessagingAutomationHealthSummary,
} from "@/lib/messaging-automation-health";
import { withOrgQuery } from "../_lib/portal-scope";

function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function formatDateTime(value: string | null, locale: string): string {
  if (!value) {
    return locale.startsWith("es") ? "Nunca" : "Never";
  }
  return formatDateTimeForDisplay(
    value,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    { locale },
  );
}

function formatMinutesAgo(value: number | null, locale: string): string {
  if (value === null) {
    return locale.startsWith("es") ? "Sin registros" : "No runs yet";
  }
  if (value < 60) {
    return locale.startsWith("es") ? `Hace ${value}m` : `${value}m ago`;
  }
  const hours = Math.round((value / 60) * 10) / 10;
  return locale.startsWith("es") ? `Hace ${hours}h` : `${hours}h ago`;
}

function getOverallBadgeClass(
  status: MessagingAutomationHealthSummary["overallStatus"],
) {
  if (status === "HEALTHY") return "status-success";
  if (status === "CRITICAL") return "status-overdue";
  return "status-warning";
}

function getOverallLabel(
  status: MessagingAutomationHealthSummary["overallStatus"],
  locale: string,
) {
  if (locale.startsWith("es")) {
    if (status === "HEALTHY") return "Saludable";
    if (status === "CRITICAL") return "Critico";
    return "Atencion";
  }
  if (status === "HEALTHY") return "Healthy";
  if (status === "CRITICAL") return "Critical";
  return "Needs attention";
}

function getReadinessLabel(
  code: MessagingAutomationHealthSummary["readinessCode"],
  locale: string,
) {
  const spanish = locale.startsWith("es");
  switch (code) {
    case "ACTIVE":
      return spanish ? "Activo" : "Active";
    case "PENDING_A2P":
      return spanish ? "Pendiente A2P" : "Pending A2P";
    case "PAUSED":
      return spanish ? "Pausado" : "Paused";
    case "SEND_DISABLED":
      return spanish ? "Envio desactivado" : "Send disabled";
    case "TOKEN_KEY_MISSING":
      return spanish ? "Falta llave de token" : "Token key missing";
    default:
      return spanish ? "Sin configurar" : "Not configured";
  }
}

function getIssueLabel(code: MessagingAutomationHealthIssueCode, locale: string) {
  const spanish = locale.startsWith("es");
  switch (code) {
    case "LIVE_AUTOMATION_BLOCKED":
      return spanish
        ? "Hay automatizaciones activas, pero Twilio no esta listo para enviar en vivo."
        : "Live automations are enabled, but Twilio is not ready to send.";
    case "DEPLOYMENT_SEND_DISABLED":
      return spanish
        ? "Las automatizaciones pueden quedar en cola, pero este despliegue tiene el envio SMS apagado."
        : "Automations can queue work, but this deployment has live SMS sending turned off.";
    case "INTAKE_CRON_STALE":
      return spanish
        ? "El worker de intake no corre hace demasiado tiempo."
        : "The intake automation worker looks stale.";
    case "GHOST_BUSTER_CRON_STALE":
      return spanish
        ? "Ghost-buster esta activado, pero su worker no corre hace demasiado tiempo."
        : "Ghost-buster is enabled, but its worker looks stale.";
    case "QUEUE_BACKLOG":
      return spanish
        ? "La cola de SMS ya tiene mensajes vencidos o acumulados."
        : "The SMS queue has overdue or backed-up work.";
    case "RECENT_FAILURES":
      return spanish
        ? "Hubo demasiados fallos recientes de cola o entrega."
        : "Recent queue or delivery failures are elevated.";
  }
}

function activeAutomationLabels(
  summary: MessagingAutomationHealthSummary,
  locale: string,
) {
  const spanish = locale.startsWith("es");
  const labels: string[] = [];
  if (summary.automationsEnabled.missedCallTextBack) {
    labels.push(spanish ? "Respuesta a llamada perdida" : "Missed-call text-back");
  }
  if (summary.automationsEnabled.autoReply) {
    labels.push(spanish ? "Auto-reply" : "Auto-reply");
  }
  if (summary.automationsEnabled.followUps) {
    labels.push(spanish ? "Seguimientos" : "Follow-ups");
  }
  if (summary.automationsEnabled.autoBooking) {
    labels.push(spanish ? "Auto-booking" : "Auto-booking");
  }
  if (summary.automationsEnabled.dispatchUpdates) {
    labels.push(spanish ? "Actualizaciones de dispatch" : "Dispatch updates");
  }
  if (summary.automationsEnabled.ghostBuster) {
    labels.push(spanish ? "Ghost-buster" : "Ghost-buster");
  }
  return labels;
}

function getFailureSourceLabel(
  source: MessagingAutomationFailureItem["source"],
  locale: string,
) {
  const spanish = locale.startsWith("es");
  if (source === "QUEUE") {
    return spanish ? "Fallo en cola" : "Queue failure";
  }
  return spanish ? "Fallo de entrega" : "Delivery failure";
}

function getFailureLabel(
  failure: MessagingAutomationFailureItem,
  locale: string,
) {
  return (
    failure.contactName ||
    failure.businessName ||
    failure.phoneE164 ||
    (locale.startsWith("es") ? "Lead sin nombre" : "Unnamed lead")
  );
}

export default function MessagingAutomationHealthCard(input: {
  summary: MessagingAutomationHealthSummary;
  locale: string;
  internalUser: boolean;
  orgId: string;
}) {
  const { summary, locale } = input;
  const spanish = locale.startsWith("es");
  const activeAutomations = activeAutomationLabels(summary, locale);
  const spamReviewHref = withOrgQuery(
    "/app/jobs?lane=spam&openOnly=0",
    input.orgId,
    input.internalUser,
  );
  const inboxHref = withOrgQuery(
    "/app/inbox",
    input.orgId,
    input.internalUser,
  );

  return (
    <section className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div className="stack-cell">
          <h2>
            {spanish
              ? "Salud de mensajeria y automatizaciones"
              : "Messaging & Automation Health"}
          </h2>
          <p className="muted">
            {spanish
              ? "Estado real de SMS en vivo, workers cron, cola pendiente y fallos recientes."
              : "Truthful status for live SMS, cron workers, queue backlog, and recent delivery issues."}
          </p>
        </div>
        <span className={`badge ${getOverallBadgeClass(summary.overallStatus)}`}>
          {getOverallLabel(summary.overallStatus, locale)}
        </span>
      </div>

      <div className="settings-integrations-grid" style={{ marginTop: 12 }}>
        <article className="settings-integration-card">
          <strong>{spanish ? "Mensajeria en vivo" : "Live messaging"}</strong>
          <p
            className={`settings-integration-status ${summary.canSendLive ? "connected" : "warning"}`}
          >
            {getReadinessLabel(summary.readinessCode, locale)}
          </p>
          <p className="muted">
            {summary.canSendLive
              ? spanish
                ? "Twilio puede enviar mensajes reales desde este espacio."
                : "Twilio can send live messages from this workspace."
              : spanish
                ? "Este espacio no esta listo para enviar SMS en vivo."
                : "This workspace is not ready for live SMS sending."}
          </p>
        </article>

        <article className="settings-integration-card">
          <strong>{spanish ? "Worker de intake" : "Intake worker"}</strong>
          <p
            className={`settings-integration-status ${summary.cron.intake.stale ? "warning" : "connected"}`}
          >
            {formatMinutesAgo(summary.cron.intake.minutesSinceLastRun, locale)}
          </p>
          <p className="muted">
            {summary.cron.intake.monitored
              ? formatDateTime(summary.cron.intake.lastRunAt, locale)
              : spanish
                ? "Sin automatizaciones que requieran este worker."
                : "No active automation requires this worker right now."}
          </p>
        </article>

        <article className="settings-integration-card">
          <strong>{spanish ? "Cola SMS vencida" : "Overdue SMS queue"}</strong>
          <p
            className={`settings-integration-status ${summary.queue.dueNowCount === 0 ? "connected" : "warning"}`}
          >
            {formatCount(summary.queue.dueNowCount, locale)}
          </p>
          <p className="muted">
            {summary.queue.oldestDueAt
              ? formatDateTime(summary.queue.oldestDueAt, locale)
              : spanish
                ? "Nada pendiente ahora."
                : "Nothing overdue right now."}
          </p>
        </article>

        <article className="settings-integration-card">
          <strong>{spanish ? "Fallos ultimas 24h" : "Failures last 24h"}</strong>
          <p
            className={`settings-integration-status ${summary.queue.failedLast24hCount + summary.queue.outboundFailedLast24hCount === 0 ? "connected" : "warning"}`}
          >
            {formatCount(
              summary.queue.failedLast24hCount +
                summary.queue.outboundFailedLast24hCount,
              locale,
            )}
          </p>
          <p className="muted">
            {spanish
              ? `${formatCount(summary.queue.failedLast24hCount, locale)} en cola · ${formatCount(summary.queue.outboundFailedLast24hCount, locale)} enviados`
              : `${formatCount(summary.queue.failedLast24hCount, locale)} queue · ${formatCount(summary.queue.outboundFailedLast24hCount, locale)} outbound`}
          </p>
        </article>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{spanish ? "Chequeo" : "Check"}</th>
              <th>{spanish ? "Estado" : "Status"}</th>
              <th>{spanish ? "Detalle" : "Detail"}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{spanish ? "Automatizaciones activas" : "Active automations"}</td>
              <td>{activeAutomations.length > 0 ? activeAutomations.length : 0}</td>
              <td>
                {activeAutomations.length > 0
                  ? activeAutomations.join(" · ")
                  : spanish
                    ? "No hay automatizaciones activas."
                    : "No live automations are enabled."}
              </td>
            </tr>
            <tr>
              <td>{spanish ? "SMS en cola despues" : "Queued for later"}</td>
              <td>{formatCount(summary.queue.scheduledCount, locale)}</td>
              <td>
                {summary.queue.nextScheduledAt
                  ? formatDateTime(summary.queue.nextScheduledAt, locale)
                  : spanish
                    ? "Sin mensajes diferidos."
                    : "No deferred messages queued."}
              </td>
            </tr>
            <tr>
              <td>{spanish ? "Ultimo SMS entrante" : "Latest inbound SMS"}</td>
              <td>{formatDateTime(summary.signals.latestInboundSmsAt, locale)}</td>
              <td>
                {spanish
                  ? "Senal mas reciente recibida por SMS."
                  : "Most recent inbound SMS signal."}
              </td>
            </tr>
            <tr>
              <td>{spanish ? "Ultima llamada entrante" : "Latest inbound call"}</td>
              <td>{formatDateTime(summary.signals.latestInboundCallAt, locale)}</td>
              <td>
                {spanish
                  ? "Senal mas reciente recibida por voz."
                  : "Most recent inbound voice signal."}
              </td>
            </tr>
            <tr>
              <td>{spanish ? "Worker ghost-buster" : "Ghost-buster worker"}</td>
              <td>
                {summary.cron.ghostBuster.monitored
                  ? formatMinutesAgo(summary.cron.ghostBuster.minutesSinceLastRun, locale)
                  : spanish
                    ? "Apagado"
                    : "Off"}
              </td>
              <td>
                {summary.cron.ghostBuster.monitored
                  ? formatDateTime(summary.cron.ghostBuster.lastRunAt, locale)
                  : spanish
                    ? "Ghost-buster no esta activo en este espacio."
                    : "Ghost-buster is not enabled for this workspace."}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>{spanish ? "Lo que necesita atencion" : "What needs attention"}</strong>
        {summary.issues.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {spanish
              ? "No hay alertas activas en este momento."
              : "No active messaging automation alerts right now."}
          </p>
        ) : (
          <ul className="portal-empty-list" style={{ marginTop: 8 }}>
            {summary.issues.map((issue) => (
              <li key={issue}>{getIssueLabel(issue, locale)}</li>
            ))}
          </ul>
        )}
      </div>

      {summary.recentFailures.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <strong>
              {spanish ? "Leads con fallos recientes" : "Recent failed leads"}
            </strong>
            <div className="portal-empty-actions">
              <Link className="btn secondary" href={inboxHref}>
                {spanish ? "Abrir bandeja" : "Open Inbox"}
              </Link>
              <Link className="btn secondary" href={spamReviewHref}>
                {spanish ? "Abrir revisar spam" : "Open Spam Review"}
              </Link>
            </div>
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {summary.recentFailures.map((failure) => {
              const leadHref = withOrgQuery(
                `/app/jobs/${failure.leadId}`,
                input.orgId,
                input.internalUser,
              );
              const failureInboxHref = withOrgQuery(
                `/app/inbox?leadId=${encodeURIComponent(failure.leadId)}`,
                input.orgId,
                input.internalUser,
              );

              return (
                <article
                  key={`${failure.source}-${failure.id}`}
                  className="settings-integration-card"
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div className="stack-cell">
                      <strong>{getFailureLabel(failure, locale)}</strong>
                      <span className="muted">{failure.phoneE164}</span>
                    </div>
                    <div className="quick-meta">
                      <span className="badge">
                        {getFailureSourceLabel(failure.source, locale)}
                      </span>
                      {failure.spamReview ? (
                        <span className="badge status-overdue">
                          {spanish ? "Revisar spam" : "Spam review"}
                        </span>
                      ) : null}
                      {failure.failedOutboundCount > 0 ? (
                        <span className="badge">
                          {spanish
                            ? `SMS fallidos: ${formatCount(failure.failedOutboundCount, locale)}`
                            : `Failed SMS: ${formatCount(failure.failedOutboundCount, locale)}`}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="muted" style={{ marginTop: 8 }}>
                    {formatDateTime(failure.failedAt, locale)}
                  </p>
                  <p style={{ marginTop: 8 }}>
                    {failure.reason ||
                      (spanish
                        ? "Fallo reciente de mensajeria."
                        : "Recent messaging failure.")}
                  </p>
                  <div className="portal-empty-actions" style={{ marginTop: 10 }}>
                    <Link className="btn secondary" href={failureInboxHref}>
                      {spanish ? "Abrir conversacion" : "Open Conversation"}
                    </Link>
                    <Link className="btn secondary" href={leadHref}>
                      {spanish ? "Abrir lead" : "Open Lead"}
                    </Link>
                    {failure.spamReview ? (
                      <Link className="btn secondary" href={spamReviewHref}>
                        {spanish ? "Ir a revisar spam" : "Go to Spam Review"}
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {input.internalUser ? (
        <div className="portal-empty-actions" style={{ marginTop: 12 }}>
          <Link
            className="btn secondary"
            href={`/api/integrations/health?orgId=${encodeURIComponent(input.orgId)}`}
            target="_blank"
            rel="noreferrer"
          >
            {spanish ? "Ver health JSON" : "Open health JSON"}
          </Link>
          <Link
            className="btn secondary"
            href="/api/internal/health"
            target="_blank"
            rel="noreferrer"
          >
            {spanish ? "Ver health interno" : "Open internal health"}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
