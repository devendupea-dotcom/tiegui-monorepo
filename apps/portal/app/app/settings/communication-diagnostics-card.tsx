"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

type CommunicationDiagnosticsSummary = {
  orgId: string;
  totalCommunicationEvents: number;
  totalLegacyCallsWithoutCommunicationEvents: number;
  totalLegacyMessagesWithoutCommunicationEvents: number;
  voicemailArtifactCount: number;
  missingLeadIdCount: number;
  missingContactIdCount: number;
  missingEitherLinkCount: number;
  countsByTypeAndStatus: Array<{
    type: string;
    providerStatus: string | null;
    count: number;
  }>;
  linkingGapSamples: Array<{
    id: string;
    type: string;
    providerCallSid: string | null;
    providerMessageSid: string | null;
    occurredAt: string;
    leadId: string | null;
    contactId: string | null;
  }>;
};

type DiagnosticsResponse =
  | {
      ok: true;
      summary: CommunicationDiagnosticsSummary;
    }
  | {
      ok: false;
      error: string;
    };

type DiagnosticsCopy = {
  loadError: string;
  title: string;
  subtitle: string;
  loading: string;
  metric: string;
  count: string;
  totalEvents: string;
  legacyCallsWithoutEvents: string;
  legacyMessagesWithoutEvents: string;
  voicemailArtifacts: string;
  missingLeadId: string;
  missingContactId: string;
  missingEitherLink: string;
  eventType: string;
  providerStatus: string;
  noEvents: string;
  gapSample: string;
  occurred: string;
  noGaps: string;
};

function getDiagnosticsCopy(locale: string): DiagnosticsCopy {
  if (locale.startsWith("es")) {
    return {
      loadError: "No se pudieron cargar los diagnosticos.",
      title: "Diagnosticos de comunicacion",
      subtitle: "Vista de salud de solo lectura para la columna vertebral de comunicacion, el backfill legado y las brechas de vinculacion de contactos.",
      loading: "Cargando diagnosticos...",
      metric: "Metrica",
      count: "Cantidad",
      totalEvents: "Total de filas CommunicationEvent",
      legacyCallsWithoutEvents: "Filas Call heredadas sin CommunicationEvent",
      legacyMessagesWithoutEvents: "Filas Message heredadas sin CommunicationEvent",
      voicemailArtifacts: "Filas VoicemailArtifact",
      missingLeadId: "CommunicationEvents sin leadId",
      missingContactId: "CommunicationEvents sin contactId",
      missingEitherLink: "CommunicationEvents sin alguno de los enlaces",
      eventType: "Tipo de evento",
      providerStatus: "Estado del proveedor",
      noEvents: "Aun no hay eventos de comunicacion.",
      gapSample: "Muestra de brecha",
      occurred: "Ocurrio",
      noGaps: "No se encontraron brechas de vinculacion.",
    };
  }

  return {
    loadError: "Failed to load diagnostics.",
    title: "Communication Diagnostics",
    subtitle: "Read-only health view for the communication backbone, legacy backfill completeness, and contact-linking gaps.",
    loading: "Loading diagnostics...",
    metric: "Metric",
    count: "Count",
    totalEvents: "Total CommunicationEvent rows",
    legacyCallsWithoutEvents: "Legacy Call rows without CommunicationEvent",
    legacyMessagesWithoutEvents: "Legacy Message rows without CommunicationEvent",
    voicemailArtifacts: "VoicemailArtifact rows",
    missingLeadId: "CommunicationEvents missing leadId",
    missingContactId: "CommunicationEvents missing contactId",
    missingEitherLink: "CommunicationEvents missing either link",
    eventType: "Event type",
    providerStatus: "Provider status",
    noEvents: "No communication events yet.",
    gapSample: "Gap sample",
    occurred: "Occurred",
    noGaps: "No contact-linking gaps found.",
  };
}

function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function CommunicationDiagnosticsCard(input: {
  orgId: string;
  internalUser: boolean;
}) {
  const locale = useLocale();
  const copy = getDiagnosticsCopy(locale);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<CommunicationDiagnosticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = input.internalUser ? `?orgId=${encodeURIComponent(input.orgId)}` : "";
        const response = await fetch(`/api/admin/communication-diagnostics${query}`, {
          method: "GET",
          headers: { "content-type": "application/json" },
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as DiagnosticsResponse | null;
        if (!response.ok || !payload || !payload.ok) {
          throw new Error(payload && "error" in payload ? payload.error : copy.loadError);
        }
        if (!cancelled) {
          setSummary(payload.summary);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : copy.loadError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [copy.loadError, input.internalUser, input.orgId]);

  return (
    <article className="card">
      <h2>{copy.title}</h2>
      <p className="muted">{copy.subtitle}</p>

      {loading ? <p className="muted">{copy.loading}</p> : null}
      {error ? <p className="form-status">{error}</p> : null}

      {!loading && !error && summary ? (
        <>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.metric}</th>
                  <th>{copy.count}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{copy.totalEvents}</td>
                  <td>{formatCount(summary.totalCommunicationEvents, locale)}</td>
                </tr>
                <tr>
                  <td>{copy.legacyCallsWithoutEvents}</td>
                  <td>{formatCount(summary.totalLegacyCallsWithoutCommunicationEvents, locale)}</td>
                </tr>
                <tr>
                  <td>{copy.legacyMessagesWithoutEvents}</td>
                  <td>{formatCount(summary.totalLegacyMessagesWithoutCommunicationEvents, locale)}</td>
                </tr>
                <tr>
                  <td>{copy.voicemailArtifacts}</td>
                  <td>{formatCount(summary.voicemailArtifactCount, locale)}</td>
                </tr>
                <tr>
                  <td>{copy.missingLeadId}</td>
                  <td>{formatCount(summary.missingLeadIdCount, locale)}</td>
                </tr>
                <tr>
                  <td>{copy.missingContactId}</td>
                  <td>{formatCount(summary.missingContactIdCount, locale)}</td>
                </tr>
                <tr>
                  <td>{copy.missingEitherLink}</td>
                  <td>{formatCount(summary.missingEitherLinkCount, locale)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.eventType}</th>
                  <th>{copy.providerStatus}</th>
                  <th>{copy.count}</th>
                </tr>
              </thead>
              <tbody>
                {summary.countsByTypeAndStatus.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      {copy.noEvents}
                    </td>
                  </tr>
                ) : (
                  summary.countsByTypeAndStatus.map((row) => (
                    <tr key={`${row.type}:${row.providerStatus || "none"}`}>
                      <td>{row.type}</td>
                      <td>{row.providerStatus || "-"}</td>
                      <td>{formatCount(row.count, locale)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.gapSample}</th>
                  <th>{copy.occurred}</th>
                  <th>leadId</th>
                  <th>contactId</th>
                </tr>
              </thead>
              <tbody>
                {summary.linkingGapSamples.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      {copy.noGaps}
                    </td>
                  </tr>
                ) : (
                  summary.linkingGapSamples.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.type}
                        {row.providerCallSid ? ` • ${row.providerCallSid}` : ""}
                        {row.providerMessageSid ? ` • ${row.providerMessageSid}` : ""}
                      </td>
                      <td>{formatDateTime(row.occurredAt, locale)}</td>
                      <td>{row.leadId || "-"}</td>
                      <td>{row.contactId || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </article>
  );
}
