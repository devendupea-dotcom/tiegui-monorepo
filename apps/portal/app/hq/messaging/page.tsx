import Link from "next/link";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import {
  buildMessagingCommandCenterReport,
  type MessagingCommandCenterTraffic,
} from "@/lib/messaging-command-center";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireInternalUser } from "@/lib/session";
import {
  buildFailedSmsDrilldownRows,
  buildSmsWebhookMonitorReport,
} from "@/lib/sms-operations-debug";
import { getTwilioMessagingEnvironmentSnapshot } from "@/lib/twilio-readiness";
import { maskSid } from "@/lib/twilio-config-crypto";

export const dynamic = "force-dynamic";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const OVERDUE_QUEUE_GRACE_MS = 10 * 60 * 1000;

function defaultTraffic(): MessagingCommandCenterTraffic {
  return {
    inbound30d: 0,
    outbound30d: 0,
    sent30d: 0,
    delivered30d: 0,
    queued30d: 0,
    failed30d: 0,
    unmatchedStatusCallbacks30d: 0,
    dncLeadCount: 0,
    overdueQueueCount: 0,
  };
}

function boolEnv(key: string): boolean {
  return Boolean(normalizeEnvValue(process.env[key]));
}

function enabledEnv(key: string): boolean {
  return normalizeEnvValue(process.env[key]) === "true";
}

function formatDate(value: Date | null): string {
  return value
    ? formatDateTimeForDisplay(value, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";
}

function formatAge(value: Date | null, now: Date): string {
  if (!value) return "Never";
  const deltaMs = Math.max(0, now.getTime() - value.getTime());
  const deltaMinutes = Math.round(deltaMs / 60_000);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) return `${deltaHours}h ago`;
  return `${Math.round(deltaHours / 24)}d ago`;
}

function maskPhone(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return normalized || "-";
  return `${normalized.startsWith("+") ? "+" : ""}***${digits.slice(-4)}`;
}

function statusBadge(label: string, state: "ok" | "warning" | "danger") {
  return (
    <span
      className={`badge ${state === "ok" ? "status-success" : "status-overdue"}`}
    >
      {label}
    </span>
  );
}

function maxDateMap<T extends { orgId: string }>(
  rows: T[],
  read: (row: T) => Date | null | undefined,
): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const row of rows) {
    const value = read(row);
    if (!value) continue;
    const existing = map.get(row.orgId);
    if (!existing || value > existing) {
      map.set(row.orgId, value);
    }
  }
  return map;
}

function countMap<T extends { orgId: string; _count: { id: number } }>(
  rows: T[],
): Map<string, number> {
  return new Map(rows.map((row) => [row.orgId, row._count.id]));
}

export default async function HqMessagingCommandCenterPage() {
  await requireInternalUser("/hq/messaging");

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);
  const twentyFourHoursAgo = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);
  const overdueQueueBefore = new Date(now.getTime() - OVERDUE_QUEUE_GRACE_MS);
  const env = {
    ...getTwilioMessagingEnvironmentSnapshot(),
    validateSignature: enabledEnv("TWILIO_VALIDATE_SIGNATURE"),
  };

  const [
    organizations,
    messageCounts,
    latestInboundRows,
    latestOutboundRows,
    latestStatusRows,
    latestVoiceRows,
    unmatchedStatusCounts,
    dncLeadCounts,
    overdueQueueCounts,
    recentFailedSms,
    webhookMonitorEvents,
    webhookMonitorMessages,
  ] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        package: true,
        messagingLaunchMode: true,
        smsFromNumberE164: true,
        twilioConfig: {
          select: {
            phoneNumber: true,
            status: true,
            twilioSubaccountSid: true,
            messagingServiceSid: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.message.groupBy({
      by: ["orgId", "direction", "status"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    }),
    prisma.message.groupBy({
      by: ["orgId"],
      where: { direction: "INBOUND" },
      _max: { createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["orgId"],
      where: { direction: "OUTBOUND" },
      _max: { createdAt: true },
    }),
    prisma.communicationEvent.groupBy({
      by: ["orgId"],
      where: {
        channel: "SMS",
        type: "OUTBOUND_SMS_SENT",
        providerMessageSid: { not: null },
        providerStatus: {
          in: ["queued", "sent", "delivered", "undelivered", "failed"],
        },
      },
      _max: { createdAt: true },
    }),
    prisma.call.groupBy({
      by: ["orgId"],
      _max: { startedAt: true },
    }),
    prisma.communicationEvent.groupBy({
      by: ["orgId"],
      where: {
        channel: "SMS",
        type: "OUTBOUND_SMS_SENT",
        summary: "Unmatched outbound SMS status callback",
        providerMessageSid: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { id: true },
    }),
    prisma.lead.groupBy({
      by: ["orgId"],
      where: { status: "DNC" },
      _count: { id: true },
    }),
    prisma.smsDispatchQueue.groupBy({
      by: ["orgId"],
      where: {
        status: "QUEUED",
        sendAfterAt: { lt: overdueQueueBefore },
      },
      _count: { id: true },
    }),
    prisma.message.findMany({
      where: {
        direction: "OUTBOUND",
        status: "FAILED",
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        orgId: true,
        createdAt: true,
        toNumberE164: true,
        body: true,
        providerMessageSid: true,
        status: true,
        org: { select: { name: true } },
        lead: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            status: true,
          },
        },
        communicationEvents: {
          orderBy: { createdAt: "desc" },
          take: 2,
          select: {
            providerStatus: true,
            metadataJson: true,
          },
        },
      },
    }),
    prisma.communicationEvent.findMany({
      where: {
        channel: "SMS",
        OR: [
          { createdAt: { gte: thirtyDaysAgo } },
          { occurredAt: { gte: thirtyDaysAgo } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        type: true,
        channel: true,
        summary: true,
        providerStatus: true,
        providerMessageSid: true,
        occurredAt: true,
        createdAt: true,
        metadataJson: true,
      },
    }),
    prisma.message.findMany({
      where: {
        createdAt: { gte: twentyFourHoursAgo },
        direction: { in: ["INBOUND", "OUTBOUND"] },
      },
      select: {
        direction: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  const trafficByOrg = new Map<string, MessagingCommandCenterTraffic>();
  for (const org of organizations) {
    trafficByOrg.set(org.id, defaultTraffic());
  }

  for (const row of messageCounts) {
    const traffic = trafficByOrg.get(row.orgId) || defaultTraffic();
    const count = row._count.id;
    if (row.direction === "INBOUND") traffic.inbound30d += count;
    if (row.direction === "OUTBOUND") {
      traffic.outbound30d += count;
      if (row.status === "SENT") traffic.sent30d += count;
      if (row.status === "DELIVERED") traffic.delivered30d += count;
      if (row.status === "QUEUED") traffic.queued30d += count;
      if (row.status === "FAILED") traffic.failed30d += count;
    }
    trafficByOrg.set(row.orgId, traffic);
  }

  const unmatchedByOrg = countMap(unmatchedStatusCounts);
  const dncByOrg = countMap(dncLeadCounts);
  const overdueQueueByOrg = countMap(overdueQueueCounts);
  for (const [orgId, traffic] of trafficByOrg.entries()) {
    traffic.unmatchedStatusCallbacks30d = unmatchedByOrg.get(orgId) || 0;
    traffic.dncLeadCount = dncByOrg.get(orgId) || 0;
    traffic.overdueQueueCount = overdueQueueByOrg.get(orgId) || 0;
  }

  const latestInboundByOrg = maxDateMap(
    latestInboundRows,
    (row) => row._max.createdAt,
  );
  const latestOutboundByOrg = maxDateMap(
    latestOutboundRows,
    (row) => row._max.createdAt,
  );
  const latestStatusByOrg = maxDateMap(
    latestStatusRows,
    (row) => row._max.createdAt,
  );
  const latestVoiceByOrg = maxDateMap(
    latestVoiceRows,
    (row) => row._max.startedAt,
  );

  const report = buildMessagingCommandCenterReport({
    now,
    orgs: organizations.map((org) => ({
      orgId: org.id,
      orgName: org.name,
      package: org.package,
      messagingLaunchMode: org.messagingLaunchMode,
      twilioConfig: org.twilioConfig
        ? {
            phoneNumber:
              org.twilioConfig.phoneNumber || org.smsFromNumberE164 || null,
            status: org.twilioConfig.status,
            updatedAt: org.twilioConfig.updatedAt,
          }
        : null,
      env,
      traffic: trafficByOrg.get(org.id) || defaultTraffic(),
      latest: {
        inboundAt: latestInboundByOrg.get(org.id) || null,
        outboundAt: latestOutboundByOrg.get(org.id) || null,
        statusCallbackAt: latestStatusByOrg.get(org.id) || null,
        voiceAt: latestVoiceByOrg.get(org.id) || null,
      },
    })),
  });
  const orgById = new Map(organizations.map((org) => [org.id, org]));
  const attentionQueue = report.orgs.filter((org) => org.issues.length > 0);
  const webhookMonitor = buildSmsWebhookMonitorReport({
    events: webhookMonitorEvents,
    messages: webhookMonitorMessages,
    now,
  });
  const failedSmsRows = buildFailedSmsDrilldownRows(
    recentFailedSms.map((message) => ({
      id: message.id,
      orgId: message.orgId,
      orgName: message.org.name,
      leadId: message.lead.id,
      leadLabel:
        message.lead.contactName ||
        message.lead.businessName ||
        maskPhone(message.toNumberE164),
      leadStatus: message.lead.status,
      toNumberE164: message.toNumberE164,
      providerMessageSid: message.providerMessageSid,
      status: message.status,
      body: message.body,
      createdAt: message.createdAt,
      communicationEvents: message.communicationEvents,
    })),
  );

  return (
    <>
      <section className="card">
        <h2>Messaging Command Center</h2>
        <p className="muted">
          Internal Twilio operations view for live readiness, delivery health,
          failed sends, webhook callbacks, and stuck SMS automation.
        </p>
      </section>

      <section className="grid">
        <article className="card kpi-card">
          <h2>Live Ready</h2>
          <p className="kpi-value">{report.summary.liveReady}</p>
          <p className="muted">Orgs with no blocking SMS issue.</p>
        </article>
        <article className="card kpi-card">
          <h2>Blocked</h2>
          <p className="kpi-value">{report.summary.blocked}</p>
          <p className="muted">Critical runtime or org setup issue.</p>
        </article>
        <article className="card kpi-card">
          <h2>Warnings</h2>
          <p className="kpi-value">{report.summary.warning}</p>
          <p className="muted">Needs review before scaling traffic.</p>
        </article>
        <article className="card kpi-card">
          <h2>No SMS</h2>
          <p className="kpi-value">{report.summary.smsDisabled}</p>
          <p className="muted">Orgs intentionally launched without Twilio.</p>
        </article>
        <article className="card kpi-card">
          <h2>Portal Only</h2>
          <p className="kpi-value">{report.summary.portalOnly}</p>
          <p className="muted">Orgs without SMS/Twilio entitlement.</p>
        </article>
        <article className="card kpi-card">
          <h2>Managed</h2>
          <p className="kpi-value">{report.summary.managed}</p>
          <p className="muted">Orgs with managed setup entitlement.</p>
        </article>
        <article className="card kpi-card">
          <h2>Failed SMS (30d)</h2>
          <p className="kpi-value">{report.summary.failed30d}</p>
          <p className="muted">Outbound sends marked failed.</p>
        </article>
        <article className="card kpi-card">
          <h2>Unmatched Callbacks</h2>
          <p className="kpi-value">
            {report.summary.unmatchedStatusCallbacks30d}
          </p>
          <p className="muted">Delivery callbacks with no local match.</p>
        </article>
        <article className="card kpi-card">
          <h2>Overdue Queue</h2>
          <p className="kpi-value">{report.summary.overdueQueueCount}</p>
          <p className="muted">Queued SMS past send time.</p>
        </article>
      </section>

      <section
        className={`card${
          env.tokenEncryptionKeyPresent && env.sendEnabled && env.validateSignature
            ? ""
            : " tone-panel danger"
        }`}
      >
        <h3>Runtime SMS Gates</h3>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Status</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Token encryption key</td>
                <td>
                  {statusBadge(
                    env.tokenEncryptionKeyPresent ? "Present" : "Missing",
                    env.tokenEncryptionKeyPresent ? "ok" : "danger",
                  )}
                </td>
                <td>TWILIO_TOKEN_ENCRYPTION_KEY set in this deployment.</td>
              </tr>
              <tr>
                <td>Live sending</td>
                <td>
                  {statusBadge(
                    env.sendEnabled ? "Enabled" : "Disabled",
                    env.sendEnabled ? "ok" : "danger",
                  )}
                </td>
                <td>TWILIO_SEND_ENABLED=true only after staging SMS passes.</td>
              </tr>
              <tr>
                <td>Webhook signatures</td>
                <td>
                  {statusBadge(
                    env.validateSignature ? "Enabled" : "Disabled",
                    env.validateSignature ? "ok" : "danger",
                  )}
                </td>
                <td>TWILIO_VALIDATE_SIGNATURE=true in customer traffic.</td>
              </tr>
              <tr>
                <td>Voice after-call override</td>
                <td>
                  {statusBadge(
                    boolEnv("TWILIO_VOICE_AFTER_CALL_URL")
                      ? "Configured"
                      : "Default",
                    "warning",
                  )}
                </td>
                <td>Only needed when overriding the default public callback.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Webhook / Status Monitor</h3>
        <p className="muted">
          24-hour SMS webhook and delivery-state signals. Invalid signature
          attempt persistence is intentionally deferred; forged callbacks should
          still fail closed at the route.
        </p>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Value</th>
                <th>Latest</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Inbound SMS webhooks</td>
                <td>{webhookMonitor.inboundSmsVolume24h}</td>
                <td title={formatDate(webhookMonitor.latestInboundWebhookAt)}>
                  {formatAge(webhookMonitor.latestInboundWebhookAt, now)}
                </td>
              </tr>
              <tr>
                <td>Outbound SMS messages</td>
                <td>{webhookMonitor.outboundSmsVolume24h}</td>
                <td title={formatDate(webhookMonitor.latestOutboundStatusCallbackAt)}>
                  {formatAge(webhookMonitor.latestOutboundStatusCallbackAt, now)}
                </td>
              </tr>
              <tr>
                <td>Status callback volume</td>
                <td>{webhookMonitor.callbackVolume24h}</td>
                <td title={formatDate(webhookMonitor.latestOutboundStatusCallbackAt)}>
                  {formatAge(webhookMonitor.latestOutboundStatusCallbackAt, now)}
                </td>
              </tr>
              <tr>
                <td>Failed / undelivered callbacks</td>
                <td>
                  {statusBadge(
                    formatAge(webhookMonitor.latestFailedCallbackAt, now),
                    webhookMonitor.latestFailedCallbackAt ? "warning" : "ok",
                  )}
                </td>
                <td title={formatDate(webhookMonitor.latestFailedCallbackAt)}>
                  {formatDate(webhookMonitor.latestFailedCallbackAt)}
                </td>
              </tr>
              <tr>
                <td>Unmatched callbacks</td>
                <td>
                  {statusBadge(
                    `${webhookMonitor.unmatchedCallbackCount24h}`,
                    webhookMonitor.unmatchedCallbackCount24h === 0
                      ? "ok"
                      : "warning",
                  )}
                </td>
                <td>Last 24h</td>
              </tr>
              <tr>
                <td>Recovered callbacks</td>
                <td>{webhookMonitor.recoveredCallbackCount24h}</td>
                <td>Last 24h</td>
              </tr>
              <tr>
                <td>Invalid signature attempts</td>
                <td>Deferred</td>
                <td>No raw webhook payload storage in this PR.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Pilot Daily Checklist</h3>
        <div className="grid two-col" style={{ marginTop: 10 }}>
          <ul className="stack">
            <li>Check failed SMS and operator action labels.</li>
            <li>Check unmatched callbacks and recovered callbacks.</li>
            <li>Check DNC/STOP events before any manual follow-up.</li>
            <li>Confirm inbound replies route to the correct Velocity thread.</li>
          </ul>
          <ul className="stack">
            <li>Confirm Cesar can send and receive normally.</li>
            <li>Record any Twilio 30006 or 30007 failures.</li>
            <li>Do not retry DNC/STOP recipients.</li>
            <li>Escalate carrier filtering separately from bad numbers.</li>
          </ul>
        </div>
      </section>

      <section className="card">
        <h3>Attention Queue</h3>
        {attentionQueue.length === 0 ? (
          <p className="muted">No messaging issues detected across orgs.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Org</th>
                  <th>Severity</th>
                  <th>Issue</th>
                  <th>Action</th>
                  <th>Failures</th>
                  <th>Callbacks</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {attentionQueue.map((org) => {
                  const primary = org.issues[0];
                  if (!primary) return null;
                  return (
                    <tr key={org.orgId}>
                      <td>{org.orgName}</td>
                      <td>
                        {statusBadge(
                          primary.severity === "critical"
                            ? "Critical"
                            : "Warning",
                          primary.severity === "critical"
                            ? "danger"
                            : "warning",
                        )}
                      </td>
                      <td>
                        <strong>{primary.title}</strong>
                        <br />
                        <span className="muted">{primary.detail}</span>
                      </td>
                      <td>{primary.action}</td>
                      <td>{org.traffic.failed30d}</td>
                      <td>{org.traffic.unmatchedStatusCallbacks30d}</td>
                      <td>
                        <Link
                          className="table-link"
                          href={`/hq/orgs/${org.orgId}/twilio`}
                        >
                          Twilio
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Org Messaging Health</h3>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Org</th>
                <th>Readiness</th>
                <th>Sender</th>
                <th>30d In / Out</th>
                <th>Failed</th>
                <th>DNC</th>
                <th>Latest Inbound</th>
                <th>Latest Outbound</th>
                <th>Status Callback</th>
                <th>Voice</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {report.orgs.map((org) => {
                const sourceOrg = orgById.get(org.orgId);
                const sender =
                  sourceOrg?.twilioConfig?.phoneNumber ||
                  sourceOrg?.smsFromNumberE164 ||
                  null;
                const readinessState =
                  org.state === "ready" || org.state === "sms_disabled"
                    ? "ok"
                    : org.state === "blocked"
                      ? "danger"
                      : "warning";
                const readinessLabel =
                  org.state === "sms_disabled" ? "NO_SMS" : org.readinessCode;
                return (
                  <tr key={org.orgId}>
                    <td>
                      <strong>{org.orgName}</strong>
                      <br />
                      <span className="muted">{org.packageLabel}</span>
                      <br />
                      <span className="muted">
                        {org.state === "sms_disabled"
                          ? "No SMS / no Twilio"
                          : sourceOrg?.twilioConfig
                          ? `${maskSid(sourceOrg.twilioConfig.twilioSubaccountSid)} / ${maskSid(
                              sourceOrg.twilioConfig.messagingServiceSid,
                            )}`
                          : "No Twilio config"}
                      </span>
                    </td>
                    <td>
                      {statusBadge(readinessLabel, readinessState)}
                      {org.issues.length ? (
                        <>
                          <br />
                          <span className="muted">
                            {org.criticalIssueCount} critical /{" "}
                            {org.warningIssueCount} warning
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>{maskPhone(sender)}</td>
                    <td>
                      {org.traffic.inbound30d} / {org.traffic.outbound30d}
                    </td>
                    <td>
                      {statusBadge(
                        `${org.traffic.failed30d}`,
                        org.traffic.failed30d === 0 ? "ok" : "warning",
                      )}
                    </td>
                    <td>{org.traffic.dncLeadCount}</td>
                    <td title={formatDate(org.latest.inboundAt)}>
                      {formatAge(org.latest.inboundAt, now)}
                    </td>
                    <td title={formatDate(org.latest.outboundAt)}>
                      {formatAge(org.latest.outboundAt, now)}
                    </td>
                    <td title={formatDate(org.latest.statusCallbackAt)}>
                      {formatAge(org.latest.statusCallbackAt, now)}
                    </td>
                    <td title={formatDate(org.latest.voiceAt)}>
                      {formatAge(org.latest.voiceAt, now)}
                    </td>
                    <td>
                      <Link
                        className="table-link"
                        href={
                          org.state === "sms_disabled"
                            ? `/hq/businesses/${org.orgId}`
                            : `/hq/orgs/${org.orgId}/twilio`
                        }
                      >
                        {org.state === "sms_disabled" ? "Org" : "Twilio"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Recent Failed SMS</h3>
        {failedSmsRows.length === 0 ? (
          <p className="muted">No outbound SMS failures in the last 30 days.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Org</th>
                  <th>Lead</th>
                  <th>Phone</th>
                  <th>SID</th>
                  <th>Status</th>
                  <th>Failure</th>
                  <th>Operator Action</th>
                  <th>Preview</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {failedSmsRows.map((message) => {
                  const failureLabel =
                    message.failure?.label ||
                    message.failure?.category ||
                    message.failure?.reason ||
                    "Failed";
                  const operatorAction =
                    message.failure?.operatorActionLabel ||
                    message.failure?.operatorDetail ||
                    "Review manually";
                  return (
                    <tr key={message.id}>
                      <td>
                        {formatDateTimeForDisplay(message.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td>{message.orgName}</td>
                      <td>
                        {message.leadLabel}
                        <br />
                        <span className="muted">
                          {message.leadStatus}
                        </span>
                      </td>
                      <td>{message.maskedPhone}</td>
                      <td>{message.maskedProviderSid}</td>
                      <td>{message.status}</td>
                      <td>{failureLabel}</td>
                      <td>{operatorAction}</td>
                      <td>{message.bodyPreview}</td>
                      <td>
                        <Link
                          className="table-link"
                          href={`/hq/orgs/${message.orgId}/twilio`}
                        >
                          Twilio
                        </Link>
                        <br />
                        <Link
                          className="table-link"
                          href={`/hq/leads/${message.leadId}/sms-debug`}
                        >
                          SMS Debug
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
