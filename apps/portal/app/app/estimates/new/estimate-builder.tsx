"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  computeEstimateLine,
  createEmptyEstimateLine,
  createEstimateLineFromMaterial,
  formatEstimateCurrency,
  normalizeEstimateTypeLabel,
  summarizeEstimateLines,
  type EstimateBuilderLineItem,
  type EstimateDraftDetail,
} from "@/lib/estimates";
import type { MaterialListItem } from "@/lib/materials";

type EstimateBuilderProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canSave: boolean;
  initialDraftId: string | null;
};

type MaterialsResponse =
  | {
      ok?: boolean;
      materials?: MaterialListItem[];
      error?: string;
    }
  | null;

type DraftResponse =
  | {
      ok?: boolean;
      draft?: EstimateDraftDetail;
      error?: string;
    }
  | null;

function recomputeLine(line: EstimateBuilderLineItem): EstimateBuilderLineItem {
  const totals = computeEstimateLine({
    quantity: line.quantity,
    unitCost: line.unitCost,
    markupPercent: line.markupPercent,
  });

  return {
    ...line,
    lineCostTotal: totals.lineCostTotal,
    lineSellTotal: totals.lineSellTotal,
  };
}

function hydrateLineItems(lines: EstimateBuilderLineItem[]): EstimateBuilderLineItem[] {
  return lines.map((line) => recomputeLine(line));
}

function pickDraftPayload(input: {
  projectName: string;
  customerName: string;
  siteAddress: string;
  projectType: string;
  notes: string;
  taxRatePercent: string;
  lineItems: EstimateBuilderLineItem[];
}) {
  return {
    projectName: input.projectName,
    customerName: input.customerName,
    siteAddress: input.siteAddress,
    projectType: input.projectType,
    notes: input.notes,
    taxRatePercent: input.taxRatePercent,
    lineItems: input.lineItems.map((line) => ({
      id: line.id,
      materialId: line.materialId,
      type: line.type,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitCost: line.unitCost,
      markupPercent: line.markupPercent,
    })),
  };
}

export default function EstimateBuilder({
  orgId,
  orgName,
  internalUser,
  canSave,
  initialDraftId,
}: EstimateBuilderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [draftId, setDraftId] = useState(initialDraftId);
  const [projectName, setProjectName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [projectType, setProjectType] = useState("");
  const [notes, setNotes] = useState("");
  const [taxRatePercent, setTaxRatePercent] = useState("0");

  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [lineItems, setLineItems] = useState<EstimateBuilderLineItem[]>([]);

  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(initialDraftId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setLoadingMaterials(true);

      try {
        const params = new URLSearchParams();
        params.set("active", "true");
        if (internalUser) {
          params.set("orgId", orgId);
        }

        const response = await fetch(`/api/materials?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as MaterialsResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.materials)) {
          throw new Error(payload?.error || "Failed to load materials.");
        }

        if (cancelled) return;
        setMaterials(payload.materials);
      } catch (loadError) {
        if (cancelled) return;
        setMaterials([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load materials.");
      } finally {
        if (!cancelled) {
          setLoadingMaterials(false);
        }
      }
    }

    void loadMaterials();

    return () => {
      cancelled = true;
    };
  }, [internalUser, orgId]);

  useEffect(() => {
    if (!initialDraftId) {
      setLoadingDraft(false);
      return;
    }

    let cancelled = false;

    async function loadDraft() {
      setLoadingDraft(true);
      setError(null);

      try {
        const response = await fetch(`/api/estimates/drafts/${initialDraftId}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as DraftResponse;
        if (!response.ok || !payload?.ok || !payload.draft) {
          throw new Error(payload?.error || "Failed to load estimate draft.");
        }

        if (cancelled) return;

        setDraftId(payload.draft.id);
        setProjectName(payload.draft.projectName);
        setCustomerName(payload.draft.customerName);
        setSiteAddress(payload.draft.siteAddress);
        setProjectType(payload.draft.projectType);
        setNotes(payload.draft.notes);
        setTaxRatePercent(payload.draft.taxRatePercent);
        setLineItems(hydrateLineItems(payload.draft.lineItems));
        setNotice(`Loaded estimate draft from ${new Date(payload.draft.updatedAt).toLocaleString()}.`);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load estimate draft.");
      } finally {
        if (!cancelled) {
          setLoadingDraft(false);
        }
      }
    }

    void loadDraft();

    return () => {
      cancelled = true;
    };
  }, [initialDraftId]);

  const totals = useMemo(() => summarizeEstimateLines(lineItems, taxRatePercent), [lineItems, taxRatePercent]);

  const materialLines = lineItems.filter((line) => line.type !== "LABOR");
  const laborLines = lineItems.filter((line) => line.type === "LABOR");

  function updateUrlWithDraftId(nextDraftId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("draftId", nextDraftId);
    if (internalUser) {
      params.set("orgId", orgId);
    }
    const query = params.toString();
    router.replace(query ? `/app/estimates/new?${query}` : "/app/estimates/new");
  }

  function updateLine(lineId: string, patch: Partial<EstimateBuilderLineItem>) {
    setLineItems((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        return recomputeLine({
          ...line,
          ...patch,
        });
      }),
    );
  }

  function addCatalogMaterial() {
    const material = materials.find((entry) => entry.id === selectedMaterialId);
    if (!material) {
      setError("Select a material from the catalog first.");
      return;
    }

    setLineItems((current) => [...current, createEstimateLineFromMaterial(material)]);
    setSelectedMaterialId("");
    setError(null);
    setNotice(null);
  }

  function addCustomMaterial() {
    setLineItems((current) => [
      ...current,
      recomputeLine({
        ...createEmptyEstimateLine("CUSTOM_MATERIAL"),
        markupPercent: "35",
      }),
    ]);
    setError(null);
    setNotice(null);
  }

  function addLaborLine() {
    setLineItems((current) => [
      ...current,
      recomputeLine({
        ...createEmptyEstimateLine("LABOR"),
        description: "Labor",
        unit: "hours",
      }),
    ]);
    setError(null);
    setNotice(null);
  }

  function removeLine(lineId: string) {
    setLineItems((current) => current.filter((line) => line.id !== lineId));
  }

  async function handleSaveDraft() {
    if (!canSave) {
      setError("Read-only users cannot save estimate drafts.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const body = {
        ...(internalUser && !draftId ? { orgId } : {}),
        ...pickDraftPayload({
          projectName,
          customerName,
          siteAddress,
          projectType,
          notes,
          taxRatePercent,
          lineItems,
        }),
      };

      const response = await fetch(draftId ? `/api/estimates/drafts/${draftId}` : "/api/estimates/drafts", {
        method: draftId ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as DraftResponse;
      if (!response.ok || !payload?.ok || !payload.draft) {
        throw new Error(payload?.error || "Failed to save estimate draft.");
      }

      setDraftId(payload.draft.id);
      setProjectName(payload.draft.projectName);
      setCustomerName(payload.draft.customerName);
      setSiteAddress(payload.draft.siteAddress);
      setProjectType(payload.draft.projectType);
      setNotes(payload.draft.notes);
      setTaxRatePercent(payload.draft.taxRatePercent);
      setLineItems(hydrateLineItems(payload.draft.lineItems));
      setNotice(`Estimate draft saved for ${orgName}.`);
      updateUrlWithDraftId(payload.draft.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save estimate draft.");
    } finally {
      setSaving(false);
    }
  }

  function renderLineTable(lines: EstimateBuilderLineItem[]) {
    if (lines.length === 0) {
      return (
        <div className="portal-empty-state estimate-empty-state">
          <strong>No line items yet.</strong>
          <p className="muted">Add catalog materials, custom materials, or labor rows to start building this estimate.</p>
        </div>
      );
    }

    return (
      <div className="table-wrap">
        <table className="data-table estimate-builder-table">
          <thead>
            <tr>
              <th>Material / Line Item</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Cost</th>
              <th>Markup</th>
              <th>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const markupAmount = line.lineSellTotal - line.lineCostTotal;
              return (
                <tr key={line.id}>
                  <td>
                    <div className="stack-cell">
                      <input
                        value={line.description}
                        onChange={(event) => updateLine(line.id, { description: event.currentTarget.value })}
                        placeholder={line.type === "LABOR" ? "Crew labor" : "Material description"}
                      />
                      <div className="quick-meta">
                        <span className="badge">{normalizeEstimateTypeLabel(line.type)}</span>
                        {line.materialId ? <span className="badge status-success">Catalog linked</span> : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <input
                      value={line.quantity}
                      onChange={(event) => updateLine(line.id, { quantity: event.currentTarget.value })}
                      inputMode="decimal"
                      placeholder="1"
                    />
                  </td>
                  <td>
                    <input
                      value={line.unit}
                      onChange={(event) => updateLine(line.id, { unit: event.currentTarget.value })}
                      placeholder="each"
                    />
                  </td>
                  <td>
                    <div className="stack-cell">
                      <input
                        value={line.unitCost}
                        onChange={(event) => updateLine(line.id, { unitCost: event.currentTarget.value })}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                      <span className="muted">Line cost {formatEstimateCurrency(line.lineCostTotal)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="stack-cell">
                      <input
                        value={line.markupPercent}
                        onChange={(event) => updateLine(line.id, { markupPercent: event.currentTarget.value })}
                        inputMode="decimal"
                        placeholder="0"
                      />
                      <span className="muted">{formatEstimateCurrency(markupAmount)} markup</span>
                    </div>
                  </td>
                  <td>
                    <strong>{formatEstimateCurrency(line.lineSellTotal)}</strong>
                  </td>
                  <td>
                    <button className="btn secondary" type="button" onClick={() => removeLine(line.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="estimate-builder-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Estimate Builder</h2>
            <p className="muted">
              Build a contractor-ready estimate for {orgName} using your live materials catalog, labor rows, and draft-save
              workflow.
            </p>
          </div>
          <div className="quick-meta">
            <span className="badge status-running">Draft Builder</span>
            <span className="badge">Materials + labor</span>
            {draftId ? <span className="badge status-success">Draft ID: {draftId}</span> : null}
          </div>
        </div>

        {notice ? <p className="form-status" style={{ marginTop: 12 }}>{notice}</p> : null}
        {error ? <p className="form-status" style={{ marginTop: 12 }}>{error}</p> : null}
        {!canSave ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            Read-only users can review the builder, but they cannot save estimate drafts.
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="stack-cell">
          <h3>Project Info</h3>
          <p className="muted">Anchor the estimate with a job name, customer context, and a clean site reference.</p>
        </div>

        <form className="auth-form" style={{ marginTop: 14 }} onSubmit={(event) => event.preventDefault()}>
          <div className="grid two-col">
            <label>
              Project name
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.currentTarget.value)}
                placeholder="Front yard paver reset"
                required
              />
            </label>

            <label>
              Customer name
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.currentTarget.value)}
                placeholder="Maria Ramirez"
              />
            </label>
          </div>

          <div className="grid two-col">
            <label>
              Site address
              <input
                value={siteAddress}
                onChange={(event) => setSiteAddress(event.currentTarget.value)}
                placeholder="123 Cedar Ave, Tacoma, WA"
              />
            </label>

            <label>
              Project type
              <input
                value={projectType}
                onChange={(event) => setProjectType(event.currentTarget.value)}
                placeholder="Hardscape repair"
              />
            </label>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h3>Materials</h3>
            <p className="muted">Pull from your live materials table or drop in a one-off custom material line.</p>
          </div>
          <div className="estimate-toolbar">
            <div className="estimate-picker">
              <select
                value={selectedMaterialId}
                onChange={(event) => setSelectedMaterialId(event.currentTarget.value)}
                disabled={loadingMaterials}
              >
                <option value="">{loadingMaterials ? "Loading catalog..." : "Select catalog material"}</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.category} · {material.name} · {formatEstimateCurrency(material.sellPrice)} / {material.unit}
                  </option>
                ))}
              </select>
              <button className="btn primary" type="button" disabled={!selectedMaterialId || loadingMaterials} onClick={addCatalogMaterial}>
                Add Catalog Material
              </button>
            </div>
            <button className="btn secondary" type="button" onClick={addCustomMaterial}>
              Add Custom Material
            </button>
          </div>
        </div>

        {materials.length === 0 && !loadingMaterials ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            No active catalog materials yet. You can still add custom material rows or open{" "}
            <Link className="table-link" href={internalUser ? `/app/materials?orgId=${encodeURIComponent(orgId)}` : "/app/materials"}>
              Materials
            </Link>{" "}
            to build the pricebook first.
          </p>
        ) : null}

        <div style={{ marginTop: 14 }}>{renderLineTable(materialLines)}</div>
      </section>

      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h3>Labor</h3>
            <p className="muted">Add labor crews, installation time, or specialty work as editable sellable rows.</p>
          </div>
          <button className="btn secondary" type="button" onClick={addLaborLine}>
            Add Labor Line
          </button>
        </div>

        <div style={{ marginTop: 14 }}>{renderLineTable(laborLines)}</div>
      </section>

      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h3>Totals</h3>
            <p className="muted">Estimate totals update instantly from your material cost, markup, and labor inputs.</p>
          </div>
          <label className="estimate-tax-rate">
            Tax %
            <input
              value={taxRatePercent}
              onChange={(event) => setTaxRatePercent(event.currentTarget.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
        </div>

        <div className="estimate-summary-grid" style={{ marginTop: 14 }}>
          <div className="card estimate-summary-card">
            <span className="muted">Materials total</span>
            <strong>{formatEstimateCurrency(totals.materialsTotal)}</strong>
          </div>
          <div className="card estimate-summary-card">
            <span className="muted">Labor total</span>
            <strong>{formatEstimateCurrency(totals.laborTotal)}</strong>
          </div>
          <div className="card estimate-summary-card">
            <span className="muted">Subtotal</span>
            <strong>{formatEstimateCurrency(totals.subtotal)}</strong>
          </div>
          <div className="card estimate-summary-card">
            <span className="muted">Tax</span>
            <strong>{formatEstimateCurrency(totals.taxAmount)}</strong>
          </div>
          <div className="card estimate-summary-card estimate-summary-card--final">
            <span className="muted">Final total</span>
            <strong>{formatEstimateCurrency(totals.finalTotal)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="stack-cell">
          <h3>Notes</h3>
          <p className="muted">Capture exclusions, production notes, assumptions, and approval context.</p>
        </div>

        <label className="auth-form" style={{ marginTop: 14 }}>
          Estimate notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            rows={5}
            placeholder="Includes disposal, assumes clear access, and excludes permit fees."
          />
        </label>

        <div className="portal-empty-actions" style={{ marginTop: 14 }}>
          <button className="btn primary" type="button" disabled={saving || loadingDraft} onClick={() => void handleSaveDraft()}>
            {saving ? "Saving Draft..." : draftId ? "Update Draft" : "Save Draft"}
          </button>
          {loadingDraft ? <span className="muted">Loading saved draft...</span> : null}
        </div>
      </section>
    </div>
  );
}
