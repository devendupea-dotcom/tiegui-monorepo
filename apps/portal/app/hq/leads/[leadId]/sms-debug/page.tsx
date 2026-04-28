import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import { prisma } from "@/lib/prisma";
import { requireInternalUser } from "@/lib/session";
import {
  buildLeadSmsDebugBundle,
  buildManualSmsReceiptIdempotencyKeys,
} from "@/lib/sms-operations-debug";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ leadId: string }>;
};

function formatDate(value: Date | null): string {
  return value
    ? formatDateTimeForDisplay(value, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";
}

function statusBadge(label: string, ok = false) {
  return (
    <span className={`badge ${ok ? "status-success" : "status-overdue"}`}>
      {label}
    </span>
  );
}

export default async function LeadSmsDebugPage(props: RouteProps) {
  const params = await props.params;
  await requireInternalUser(`/hq/leads/${params.leadId}/sms-debug`);

  const [lead, messages, communicationEvents] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        id: true,
        orgId: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        status: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        org: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.message.findMany({
      where: { leadId: params.leadId },
      orderBy: { createdAt: "desc" },
      take: 75,
      select: {
        id: true,
        direction: true,
        type: true,
        status: true,
        fromNumberE164: true,
        toNumberE164: true,
        body: true,
        providerMessageSid: true,
        createdAt: true,
      },
    }),
    prisma.communicationEvent.findMany({
      where: { leadId: params.leadId, channel: "SMS" },
      orderBy: { occurredAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        channel: true,
        summary: true,
        providerStatus: true,
        providerMessageSid: true,
        occurredAt: true,
        createdAt: true,
        metadataJson: true,
        messageId: true,
      },
    }),
  ]);

  if (!lead) {
    notFound();
  }

  const receiptKeys = buildManualSmsReceiptIdempotencyKeys(communicationEvents);
  const providerSids = [
    ...new Set(
      [
        ...messages.map((message) => message.providerMessageSid),
        ...communicationEvents.map((event) => event.providerMessageSid),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];

  const [receipts, callbackEvents] = await Promise.all([
    receiptKeys.length
      ? prisma.clientMutationReceipt.findMany({
          where: {
            orgId: lead.orgId,
            idempotencyKey: { in: receiptKeys },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            route: true,
            idempotencyKey: true,
            createdAt: true,
            updatedAt: true,
            responseJson: true,
          },
        })
      : Promise.resolve([]),
    providerSids.length
      ? prisma.communicationEvent.findMany({
          where: {
            orgId: lead.orgId,
            channel: "SMS",
            type: "OUTBOUND_SMS_SENT",
            providerMessageSid: { in: providerSids },
            summary: {
              in: [
                "Unmatched outbound SMS status callback",
                "Recovered outbound SMS status callback",
              ],
            },
          },
          orderBy: { occurredAt: "desc" },
          take: 100,
          select: {
            id: true,
            type: true,
            channel: true,
            summary: true,
            providerStatus: true,
            providerMessageSid: true,
            occurredAt: true,
            createdAt: true,
            metadataJson: true,
            messageId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const bundle = buildLeadSmsDebugBundle({
    lead: {
      id: lead.id,
      orgId: lead.orgId,
      orgName: lead.org.name,
      contactName: lead.contactName,
      businessName: lead.businessName,
      phoneE164: lead.phoneE164,
      status: lead.status,
      lastInboundAt: lead.lastInboundAt,
      lastOutboundAt: lead.lastOutboundAt,
    },
    messages,
    communicationEvents,
    receipts,
    callbackEvents,
  });

  return (
    <>
      <section className="card">
        <Link href={`/hq/leads/${lead.id}?tab=messages`} className="table-link">
          Back to lead messages
        </Link>
        <h2 style={{ marginTop: 8 }}>SMS Debug Bundle</h2>
        <p className="muted">
          Read-only internal diagnostics for one lead. Phone numbers, provider
          SIDs, and message bodies are masked or previewed.
        </p>
        <div className="quick-links" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href={`/hq/orgs/${lead.orgId}/twilio`}>
            Open Org Twilio
          </Link>
          <Link className="btn secondary" href="/hq/messaging">
            Messaging Command Center
          </Link>
        </div>
      </section>

      <section className="grid">
        <article className="card kpi-card">
          <h2>Lead</h2>
          <p className="muted">{bundle.lead.id}</p>
          <p>{bundle.lead.contactName || bundle.lead.businessName || "Lead"}</p>
        </article>
        <article className="card kpi-card">
          <h2>Org</h2>
          <p>{bundle.lead.orgName}</p>
          <p className="muted">{bundle.lead.orgId}</p>
        </article>
        <article className="card kpi-card">
          <h2>Phone</h2>
          <p>{bundle.lead.maskedPhone}</p>
          <p className="muted">Masked</p>
        </article>
        <article className="card kpi-card">
          <h2>Status</h2>
          <p>{bundle.lead.status}</p>
          {bundle.lead.dncBlocked ? (
            <p>{statusBadge("DNC/STOP blocked")}</p>
          ) : (
            <p>{statusBadge("SMS allowed by lead status", true)}</p>
          )}
        </article>
        <article className="card kpi-card">
          <h2>Latest Inbound</h2>
          <p>{formatDate(bundle.lead.lastInboundAt)}</p>
        </article>
        <article className="card kpi-card">
          <h2>Latest Outbound</h2>
          <p>{formatDate(bundle.lead.lastOutboundAt)}</p>
        </article>
      </section>

      <section className="card">
        <h3>Copy Debug Summary</h3>
        <p className="muted">
          Safe to paste into release notes or incident threads. It excludes full
          phone numbers, full SIDs, message bodies, raw payloads, and secrets.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
          {bundle.debugSummary}
        </pre>
      </section>

      <section className="card">
        <h3>Message Rows</h3>
        {bundle.messages.length === 0 ? (
          <p className="muted">No SMS message rows for this lead.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>ID</th>
                  <th>Direction</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>From / To</th>
                  <th>SID</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {bundle.messages.map((message) => (
                  <tr key={message.id}>
                    <td>{formatDate(message.createdAt)}</td>
                    <td>{message.id}</td>
                    <td>{message.direction}</td>
                    <td>{message.type}</td>
                    <td>{message.status || "-"}</td>
                    <td>
                      {message.maskedFrom} / {message.maskedTo}
                    </td>
                    <td>{message.maskedProviderSid}</td>
                    <td>{message.bodyPreview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Communication Events</h3>
        {bundle.communicationEvents.length === 0 ? (
          <p className="muted">No SMS communication events for this lead.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Occurred</th>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Summary</th>
                  <th>Provider</th>
                  <th>Failure</th>
                  <th>Operator Action</th>
                  <th>Compliance</th>
                </tr>
              </thead>
              <tbody>
                {bundle.communicationEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.occurredAt)}</td>
                    <td>{event.id}</td>
                    <td>
                      {event.type}
                      <br />
                      <span className="muted">{event.channel}</span>
                    </td>
                    <td>{event.summary}</td>
                    <td>
                      {event.providerStatus || "-"}
                      <br />
                      <span className="muted">{event.maskedProviderSid}</span>
                    </td>
                    <td>
                      {event.failure?.label ||
                        event.failure?.category ||
                        event.failure?.reason ||
                        "-"}
                    </td>
                    <td>
                      {event.failure?.operatorActionLabel ||
                        event.failure?.operatorDetail ||
                        "-"}
                    </td>
                    <td>{event.complianceKeyword || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid two-col">
        <article className="card">
          <h3>Idempotency Receipts</h3>
          {bundle.receipts.length === 0 ? (
            <p className="muted">
              No manual SMS receipt rows were discoverable from this lead's
              communication event metadata.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>ID</th>
                    <th>Route</th>
                    <th>Stored response</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.receipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td>{formatDate(receipt.createdAt)}</td>
                      <td>{receipt.id}</td>
                      <td>{receipt.route}</td>
                      <td>{receipt.responseJsonExists ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="card">
          <h3>Status Callback Diagnostics</h3>
          <p className="muted">
            {bundle.unmatchedCallbackCount} unmatched /{" "}
            {bundle.recoveredCallbackCount} recovered callbacks for known lead
            SIDs.
          </p>
          {bundle.callbackEvents.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>
              No unmatched or recovered callback diagnostics tied to this lead's
              provider SIDs.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Occurred</th>
                    <th>ID</th>
                    <th>Summary</th>
                    <th>Status</th>
                    <th>SID</th>
                    <th>Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.callbackEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDate(event.occurredAt)}</td>
                      <td>{event.id}</td>
                      <td>{event.summary}</td>
                      <td>{event.providerStatus || "-"}</td>
                      <td>{event.maskedProviderSid}</td>
                      <td>{event.failure?.label || event.failure?.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </>
  );
}
