"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";

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

type CommunicationRepairField = "leadId" | "contactId" | "conversationId";

type CommunicationIntegrityRepairResult = {
  orgId: string;
  mode: "preview" | "apply";
  legacyCalls: {
    totalRows: number;
    scannedRows: number;
    candidateRows: number;
    createdRows: number;
    skippedExistingRows: number;
    truncated: boolean;
    samples: Array<{
      kind: "call" | "message";
      legacyId: string;
      leadId: string | null;
      contactId: string | null;
      conversationId: string | null;
      occurredAt: string;
      providerCallSid: string | null;
      providerMessageSid: string | null;
      confidence: string;
      reviewReasons: string[];
    }>;
  };
  legacyMessages: {
    totalRows: number;
    scannedRows: number;
    candidateRows: number;
    createdRows: number;
    skippedExistingRows: number;
    truncated: boolean;
    samples: Array<{
      kind: "call" | "message";
      legacyId: string;
      leadId: string | null;
      contactId: string | null;
      conversationId: string | null;
      occurredAt: string;
      providerCallSid: string | null;
      providerMessageSid: string | null;
      confidence: string;
      reviewReasons: string[];
    }>;
  };
  partialLinkage: {
    totalRows: number;
    scannedRows: number;
    repairableRows: number;
    unrepairedRows: number;
    repairedRows: number;
    truncated: boolean;
    samples: Array<{
      eventId: string;
      type: string;
      occurredAt: string;
      leadId: string | null;
      contactId: string | null;
      conversationId: string | null;
      missingFields: CommunicationRepairField[];
      repairedFields: CommunicationRepairField[];
      unresolvedFields: CommunicationRepairField[];
    }>;
  };
};

type RepairResponse =
  | {
      ok: true;
      result: CommunicationIntegrityRepairResult;
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
  repairTitle: string;
  repairSubtitle: string;
  repairPreview: string;
  repairApply: string;
  repairPreviewing: string;
  repairApplying: string;
  repairError: string;
  repairConfirm: string;
  repairModePreview: string;
  repairModeApply: string;
  repairMode: string;
  legacyCallCandidates: string;
  legacyCallCreated: string;
  legacyMessageCandidates: string;
  legacyMessageCreated: string;
  partialRepairable: string;
  partialRepaired: string;
  partialUnrepaired: string;
  sampleBackfills: string;
  sampleLinkage: string;
  noRepairSamples: string;
  missingFields: string;
  repairedFields: string;
  unresolvedFields: string;
};

function getDiagnosticsCopy(locale: string): DiagnosticsCopy {
  if (locale.startsWith("es")) {
    return {
      loadError: "No se pudieron cargar los diagnosticos.",
      title: "Diagnosticos de comunicacion",
      subtitle:
        "Vista de salud de solo lectura para la columna vertebral de comunicacion, el backfill legado y las brechas de vinculacion de contactos.",
      loading: "Cargando diagnosticos...",
      metric: "Metrica",
      count: "Cantidad",
      totalEvents: "Total de filas CommunicationEvent",
      legacyCallsWithoutEvents: "Filas Call heredadas sin CommunicationEvent",
      legacyMessagesWithoutEvents:
        "Filas Message heredadas sin CommunicationEvent",
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
      repairTitle: "Reparacion conservadora",
      repairSubtitle:
        "Preview y aplicacion para backfill de CommunicationEvent faltantes y restauracion segura de enlaces lead/contacto/conversacion.",
      repairPreview: "Preview reparaciones",
      repairApply: "Aplicar reparaciones",
      repairPreviewing: "Generando preview...",
      repairApplying: "Aplicando reparaciones...",
      repairError: "No se pudieron ejecutar las reparaciones.",
      repairConfirm:
        "Aplicar reparaciones conservadoras de comunicacion para este workspace?",
      repairModePreview: "Preview",
      repairModeApply: "Aplicado",
      repairMode: "Modo",
      legacyCallCandidates: "Backfill Call heredado",
      legacyCallCreated: "CommunicationEvents Call creados",
      legacyMessageCandidates: "Backfill Message heredado",
      legacyMessageCreated: "CommunicationEvents Message creados",
      partialRepairable: "Brechas reparables",
      partialRepaired: "Brechas reparadas",
      partialUnrepaired: "Brechas aun manuales",
      sampleBackfills: "Muestras de backfill",
      sampleLinkage: "Muestras de vinculacion",
      noRepairSamples: "No hay muestras de reparacion para mostrar.",
      missingFields: "Faltantes",
      repairedFields: "Reparables",
      unresolvedFields: "Pendientes",
    };
  }

  return {
    loadError: "Failed to load diagnostics.",
    title: "Communication Diagnostics",
    subtitle:
      "Read-only health view for the communication backbone, legacy backfill completeness, and contact-linking gaps.",
    loading: "Loading diagnostics...",
    metric: "Metric",
    count: "Count",
    totalEvents: "Total CommunicationEvent rows",
    legacyCallsWithoutEvents: "Legacy Call rows without CommunicationEvent",
    legacyMessagesWithoutEvents:
      "Legacy Message rows without CommunicationEvent",
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
    repairTitle: "Conservative Repair",
    repairSubtitle:
      "Preview and apply safe repairs for missing legacy CommunicationEvents and deterministic lead/contact/conversation linkage.",
    repairPreview: "Preview Repairs",
    repairApply: "Apply Repairs",
    repairPreviewing: "Previewing repairs...",
    repairApplying: "Applying repairs...",
    repairError: "Failed to run communication repairs.",
    repairConfirm:
      "Apply conservative communication repairs for this workspace?",
    repairModePreview: "Preview",
    repairModeApply: "Applied",
    repairMode: "Mode",
    legacyCallCandidates: "Legacy Call backfill candidates",
    legacyCallCreated: "Legacy Call events created",
    legacyMessageCandidates: "Legacy Message backfill candidates",
    legacyMessageCreated: "Legacy Message events created",
    partialRepairable: "Repairable linkage gaps",
    partialRepaired: "Linkage gaps repaired",
    partialUnrepaired: "Still manual-review gaps",
    sampleBackfills: "Backfill samples",
    sampleLinkage: "Linkage samples",
    noRepairSamples: "No repair samples to show.",
    missingFields: "Missing",
    repairedFields: "Repairable",
    unresolvedFields: "Still missing",
  };
}

function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function formatDateTime(value: string, locale: string) {
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

function formatFieldList(fields: CommunicationRepairField[]) {
  return fields.length > 0 ? fields.join(", ") : "-";
}

export default function CommunicationDiagnosticsCard(input: {
  orgId: string;
  internalUser: boolean;
}) {
  const locale = useLocale();
  const copy = getDiagnosticsCopy(locale);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] =
    useState<CommunicationDiagnosticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairBusyMode, setRepairBusyMode] = useState<
    "preview" | "apply" | null
  >(null);
  const [repairResult, setRepairResult] =
    useState<CommunicationIntegrityRepairResult | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);

    const query = input.internalUser
      ? `?orgId=${encodeURIComponent(input.orgId)}`
      : "";
    const response = await fetch(
      `/api/admin/communication-diagnostics${query}`,
      {
        method: "GET",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      },
    );
    const payload = (await response
      .json()
      .catch(() => null)) as DiagnosticsResponse | null;
    if (!response.ok || !payload || !payload.ok) {
      throw new Error(
        payload && "error" in payload ? payload.error : copy.loadError,
      );
    }

    setSummary(payload.summary);
  }, [copy.loadError, input.internalUser, input.orgId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await loadDiagnostics();
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : copy.loadError,
          );
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
  }, [copy.loadError, loadDiagnostics]);

  async function runRepair(mode: "preview" | "apply") {
    if (repairBusyMode) {
      return;
    }

    if (mode === "apply" && !window.confirm(copy.repairConfirm)) {
      return;
    }

    setRepairBusyMode(mode);
    setRepairError(null);

    try {
      const response = await fetch("/api/admin/communication-repairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: input.orgId,
          apply: mode === "apply",
        }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as RepairResponse | null;
      if (!response.ok || !payload || !payload.ok) {
        throw new Error(
          payload && "error" in payload ? payload.error : copy.repairError,
        );
      }

      setRepairResult(payload.result);
      await loadDiagnostics();
    } catch (nextError) {
      setRepairError(
        nextError instanceof Error ? nextError.message : copy.repairError,
      );
    } finally {
      setRepairBusyMode(null);
    }
  }

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
                  <td>
                    {formatCount(summary.totalCommunicationEvents, locale)}
                  </td>
                </tr>
                <tr>
                  <td>{copy.legacyCallsWithoutEvents}</td>
                  <td>
                    {formatCount(
                      summary.totalLegacyCallsWithoutCommunicationEvents,
                      locale,
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{copy.legacyMessagesWithoutEvents}</td>
                  <td>
                    {formatCount(
                      summary.totalLegacyMessagesWithoutCommunicationEvents,
                      locale,
                    )}
                  </td>
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
                        {row.providerMessageSid
                          ? ` • ${row.providerMessageSid}`
                          : ""}
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

          <section style={{ marginTop: 24 }}>
            <h3 style={{ marginBottom: 6 }}>{copy.repairTitle}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {copy.repairSubtitle}
            </p>

            <div
              className="portal-empty-actions"
              style={{ justifyContent: "flex-start", gap: 8 }}
            >
              <button
                className="btn secondary"
                type="button"
                disabled={Boolean(repairBusyMode)}
                onClick={() => void runRepair("preview")}
              >
                {repairBusyMode === "preview"
                  ? copy.repairPreviewing
                  : copy.repairPreview}
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={Boolean(repairBusyMode)}
                onClick={() => void runRepair("apply")}
              >
                {repairBusyMode === "apply"
                  ? copy.repairApplying
                  : copy.repairApply}
              </button>
            </div>

            {repairError ? <p className="form-status">{repairError}</p> : null}

            {repairResult ? (
              <>
                <div className="table-wrap" style={{ marginTop: 18 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{copy.metric}</th>
                        <th>{copy.count}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{copy.repairMode}</td>
                        <td>
                          {repairResult.mode === "apply"
                            ? copy.repairModeApply
                            : copy.repairModePreview}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.legacyCallCandidates}</td>
                        <td>
                          {formatCount(
                            repairResult.legacyCalls.candidateRows,
                            locale,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.legacyCallCreated}</td>
                        <td>
                          {formatCount(
                            repairResult.legacyCalls.createdRows,
                            locale,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.legacyMessageCandidates}</td>
                        <td>
                          {formatCount(
                            repairResult.legacyMessages.candidateRows,
                            locale,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.legacyMessageCreated}</td>
                        <td>
                          {formatCount(
                            repairResult.legacyMessages.createdRows,
                            locale,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.partialRepairable}</td>
                        <td>
                          {formatCount(
                            repairResult.partialLinkage.repairableRows,
                            locale,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.partialRepaired}</td>
                        <td>
                          {formatCount(
                            repairResult.partialLinkage.repairedRows,
                            locale,
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{copy.partialUnrepaired}</td>
                        <td>
                          {formatCount(
                            repairResult.partialLinkage.unrepairedRows,
                            locale,
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="table-wrap" style={{ marginTop: 18 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{copy.sampleBackfills}</th>
                        <th>{copy.occurred}</th>
                        <th>leadId</th>
                        <th>contactId</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repairResult.legacyCalls.samples.length === 0 &&
                      repairResult.legacyMessages.samples.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="muted">
                            {copy.noRepairSamples}
                          </td>
                        </tr>
                      ) : (
                        [
                          ...repairResult.legacyCalls.samples,
                          ...repairResult.legacyMessages.samples,
                        ].map((row) => (
                          <tr key={`${row.kind}:${row.legacyId}`}>
                            <td>
                              {row.kind.toUpperCase()} • {row.legacyId}
                              {row.providerCallSid
                                ? ` • ${row.providerCallSid}`
                                : ""}
                              {row.providerMessageSid
                                ? ` • ${row.providerMessageSid}`
                                : ""}
                              {row.reviewReasons.length > 0
                                ? ` • ${row.reviewReasons.join(" | ")}`
                                : ""}
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

                <div className="table-wrap" style={{ marginTop: 18 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{copy.sampleLinkage}</th>
                        <th>{copy.occurred}</th>
                        <th>{copy.missingFields}</th>
                        <th>{copy.repairedFields}</th>
                        <th>{copy.unresolvedFields}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repairResult.partialLinkage.samples.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="muted">
                            {copy.noRepairSamples}
                          </td>
                        </tr>
                      ) : (
                        repairResult.partialLinkage.samples.map((row) => (
                          <tr key={row.eventId}>
                            <td>
                              {row.type} • {row.eventId}
                            </td>
                            <td>{formatDateTime(row.occurredAt, locale)}</td>
                            <td>{formatFieldList(row.missingFields)}</td>
                            <td>{formatFieldList(row.repairedFields)}</td>
                            <td>{formatFieldList(row.unresolvedFields)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </article>
  );
}
