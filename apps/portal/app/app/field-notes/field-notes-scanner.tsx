"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  FieldNoteMaterial,
  FieldNoteMeasurement,
  ParsedFieldNotes,
} from "@/lib/field-notes";
import { createEmptyParsedFieldNotes } from "@/lib/field-notes";

type FieldNotesScannerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
};

type ParseResponse =
  | {
      ok?: boolean;
      data?: ParsedFieldNotes;
      error?: string;
    }
  | null;

type SaveResponse =
  | {
      ok?: boolean;
      leadId?: string;
      redirectTo?: string;
      saveMode?: "lead" | "estimate";
      error?: string;
    }
  | null;

function createEmptyMeasurement(): FieldNoteMeasurement {
  return {
    label: "",
    value: "",
    unit: "",
    notes: "",
  };
}

function createEmptyMaterial(): FieldNoteMaterial {
  return {
    name: "",
    quantity: "",
    unit: "",
    notes: "",
  };
}

function badgeClass(input: { step: number; activeStep: number; completed: boolean }): string {
  if (input.completed) return "badge status-success";
  if (input.step === input.activeStep) return "badge status-running";
  return "badge";
}

function renderMeasurement(row: FieldNoteMeasurement): string {
  const base = [row.label, row.value && `${row.value}${row.unit ? ` ${row.unit}` : ""}`.trim()]
    .filter(Boolean)
    .join(": ");
  return row.notes ? `${base} (${row.notes})` : base || "Not captured";
}

function renderMaterial(row: FieldNoteMaterial): string {
  const quantity = [row.quantity, row.unit].filter(Boolean).join(" ");
  const base = [row.name, quantity].filter(Boolean).join(" - ");
  return row.notes ? `${base} (${row.notes})` : base || "Not captured";
}

export default function FieldNotesScanner({
  orgId,
  orgName,
  internalUser,
}: FieldNotesScannerProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedFieldNotes | null>(null);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [savingMode, setSavingMode] = useState<"lead" | "estimate" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [savedRedirectTo, setSavedRedirectTo] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState<"lead" | "estimate" | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [selectedFile]);

  const activeStep = savedLeadId ? 5 : processing ? 2 : parsedData ? 4 : 1;

  function resetSaveState() {
    setSaveError(null);
    setSavedLeadId(null);
    setSavedRedirectTo(null);
    setSavedMode(null);
  }

  function resetParsedState() {
    setParsedData(null);
    setParseError(null);
    setParseNotice(null);
    resetSaveState();
  }

  function updateParsedField<K extends keyof ParsedFieldNotes>(field: K, value: ParsedFieldNotes[K]) {
    setParsedData((current) => {
      const next = current ? { ...current } : createEmptyParsedFieldNotes();
      next[field] = value;
      return next;
    });
  }

  function updateMeasurement(index: number, field: keyof FieldNoteMeasurement, value: string) {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      const nextMeasurements = [...base.measurements];
      const existing = nextMeasurements[index] || createEmptyMeasurement();
      nextMeasurements[index] = {
        ...existing,
        [field]: value,
      };
      base.measurements = nextMeasurements;
      return base;
    });
  }

  function updateMaterial(index: number, field: keyof FieldNoteMaterial, value: string) {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      const nextMaterials = [...base.materials];
      const existing = nextMaterials[index] || createEmptyMaterial();
      nextMaterials[index] = {
        ...existing,
        [field]: value,
      };
      base.materials = nextMaterials;
      return base;
    });
  }

  function addMeasurementRow() {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      base.measurements = [...base.measurements, createEmptyMeasurement()];
      return base;
    });
  }

  function addMaterialRow() {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      base.materials = [...base.materials, createEmptyMaterial()];
      return base;
    });
  }

  function removeMeasurementRow(index: number) {
    setParsedData((current) => {
      if (!current) return current;
      return {
        ...current,
        measurements: current.measurements.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  }

  function removeMaterialRow(index: number) {
    setParsedData((current) => {
      if (!current) return current;
      return {
        ...current,
        materials: current.materials.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  }

  async function handleAnalyze() {
    if (!selectedFile) {
      setParseError("Choose a field-note image first.");
      return;
    }

    setProcessing(true);
    setParseError(null);
    setParseNotice(null);
    resetSaveState();

    try {
      const formData = new FormData();
      formData.set("image", selectedFile);
      if (internalUser) {
        formData.set("orgId", orgId);
      }

      const response = await fetch("/api/ai/parse-field-notes", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as ParseResponse;
      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.error || "Could not organize the field notes.");
      }

      setParsedData(payload.data);
      setParseNotice("Field notes organized. Review every field before saving.");
    } catch (error) {
      setParsedData(null);
      setParseError(error instanceof Error ? error.message : "Could not organize the field notes.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleSave(mode: "lead" | "estimate") {
    if (!parsedData) {
      setSaveError("Run the AI scan before saving.");
      return;
    }

    setSavingMode(mode);
    setSaveError(null);

    try {
      const response = await fetch("/api/ai/field-notes/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(internalUser ? { orgId } : {}),
          mode,
          phone,
          email,
          data: parsedData,
        }),
      });

      const payload = (await response.json().catch(() => null)) as SaveResponse;
      if (!response.ok || !payload?.ok || !payload.leadId || !payload.redirectTo) {
        throw new Error(payload?.error || "Could not save the reviewed field notes.");
      }

      setSavedLeadId(payload.leadId);
      setSavedRedirectTo(payload.redirectTo);
      setSavedMode(payload.saveMode || mode);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the reviewed field notes.");
    } finally {
      setSavingMode(null);
    }
  }

  return (
    <div className="field-notes-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>AI Field Notes Scanner</h2>
            <p className="muted">
              Turn handwritten site notes into clean job data for {orgName}. Nothing is saved until the contractor reviews
              and confirms it.
            </p>
          </div>
          <div className="quick-meta">
            <span className="badge status-running">AI Review Flow</span>
            <span className="badge">No auto-save</span>
            <span className="badge">Lead or estimate draft</span>
          </div>
        </div>

        <div className="field-notes-stepper" style={{ marginTop: 14 }}>
          {[1, 2, 3, 4, 5].map((step) => {
            const completed =
              step === 1
                ? Boolean(selectedFile)
                : step === 2
                  ? Boolean(parsedData) || Boolean(savedLeadId)
                  : step === 3
                    ? Boolean(parsedData) || Boolean(savedLeadId)
                    : step === 4
                      ? Boolean(parsedData) || Boolean(savedLeadId)
                      : Boolean(savedLeadId);

            const label =
              step === 1
                ? "Upload"
                : step === 2
                  ? "AI Parse"
                  : step === 3
                    ? "Review"
                    : step === 4
                      ? "Edit"
                      : "Save";

            return (
              <span key={step} className={badgeClass({ step, activeStep, completed })}>
                Step {step}: {label}
              </span>
            );
          })}
        </div>

        {parseNotice ? <p className="form-status" style={{ marginTop: 12 }}>{parseNotice}</p> : null}
        {parseError ? <p className="form-status" style={{ marginTop: 12 }}>{parseError}</p> : null}
        {saveError ? <p className="form-status" style={{ marginTop: 12 }}>{saveError}</p> : null}
      </section>

      <section className="card">
        <div className="field-notes-layout">
          <div className="stack-cell">
            <h3>Step 1: Upload handwritten notes</h3>
            <div className="field-notes-dropzone">
              <label className="stack-cell">
                <span>Photo of handwritten field notes</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={processing || Boolean(savingMode)}
                  onChange={(event) => {
                    const nextFile = event.currentTarget.files?.[0] || null;
                    setSelectedFile(nextFile);
                    resetParsedState();
                  }}
                />
              </label>

              <p className="muted">
                Best results: bright photo, full page visible, minimal shadows, and clear measurements or material notes.
              </p>

              <div className="portal-empty-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={!selectedFile || processing || Boolean(savingMode)}
                  onClick={() => {
                    void handleAnalyze();
                  }}
                >
                  {processing ? "Organizing..." : "Analyze Notes"}
                </button>

                {selectedFile ? (
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={processing || Boolean(savingMode)}
                    onClick={() => {
                      setSelectedFile(null);
                      resetParsedState();
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="stack-cell">
            <h3>What the AI extracts</h3>
            <div className="field-notes-facts">
              <span className="badge">Customer</span>
              <span className="badge">Project type</span>
              <span className="badge">Site address</span>
              <span className="badge">Measurements</span>
              <span className="badge">Materials</span>
              <span className="badge">Scope of work</span>
              <span className="badge">Labor notes</span>
              <span className="badge">Quote amount</span>
              <span className="badge">Timeline</span>
              <span className="badge">Follow-up</span>
            </div>
            <p className="muted">
              Review is required before anything is saved. TieGui will never auto-create a lead or estimate from a scan.
            </p>
          </div>
        </div>
      </section>

      {processing ? (
        <section className="card">
          <div className="field-notes-layout">
            <div className="stack-cell">
              <h3>Step 2: AI processing</h3>
              <p className="muted">
                Reading handwriting, grouping measurements, and organizing the job scope into clean CRM fields.
              </p>
              <div className="quick-meta">
                <span className="badge status-running">Scanning handwriting</span>
                <span className="badge status-running">Structuring measurements</span>
                <span className="badge status-running">Preparing review form</span>
              </div>
            </div>
            {previewUrl ? (
              <div className="field-notes-preview-card">
                <Image
                  className="field-notes-preview-image"
                  src={previewUrl}
                  alt="Field notes preview"
                  width={1200}
                  height={1600}
                  unoptimized
                  loader={({ src }) => src}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {parsedData ? (
        <>
          <section className="card">
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>Step 3: Review organized data</h3>
                <p className="muted">Sanity-check the extracted job details before you edit or save anything.</p>
              </div>
              <div className="field-notes-inline-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={Boolean(savingMode)}
                  onClick={() => {
                    void handleAnalyze();
                  }}
                >
                  Re-run AI
                </button>
              </div>
            </div>

            <div className="field-notes-layout" style={{ marginTop: 14 }}>
              {previewUrl ? (
                <div className="field-notes-preview-card">
                  <Image
                    className="field-notes-preview-image"
                    src={previewUrl}
                    alt="Uploaded field notes"
                    width={1200}
                    height={1600}
                    unoptimized
                    loader={({ src }) => src}
                  />
                </div>
              ) : null}

              <div className="field-notes-summary-grid">
                <div className="card field-notes-nested-card">
                  <h4>Customer</h4>
                  <p>{parsedData.customer_name || "Not captured yet"}</p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>Project type</h4>
                  <p>{parsedData.project_type || "Not captured yet"}</p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>Site address</h4>
                  <p>{parsedData.site_address || "Not captured yet"}</p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>Quote amount</h4>
                  <p>{parsedData.quote_amount || "Not captured yet"}</p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>Timeline</h4>
                  <p>{parsedData.timeline || "Not captured yet"}</p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>Follow-up</h4>
                  <p>{parsedData.follow_up || "Not captured yet"}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="stack-cell">
              <h3>Step 4: Edit extracted fields</h3>
              <p className="muted">Clean up anything the scan missed. These fields are the final version that gets saved.</p>
            </div>

            <form className="auth-form" style={{ marginTop: 14 }} onSubmit={(event) => event.preventDefault()}>
              <div className="grid two-col">
                <label>
                  Customer name
                  <input
                    value={parsedData.customer_name}
                    onChange={(event) => updateParsedField("customer_name", event.currentTarget.value)}
                    placeholder="Maria Ramirez"
                  />
                </label>

                <label>
                  Project type
                  <input
                    value={parsedData.project_type}
                    onChange={(event) => updateParsedField("project_type", event.currentTarget.value)}
                    placeholder="Front yard cleanup and mulch refresh"
                  />
                </label>
              </div>

              <div className="grid two-col">
                <label>
                  Site address
                  <input
                    value={parsedData.site_address}
                    onChange={(event) => updateParsedField("site_address", event.currentTarget.value)}
                    placeholder="123 Cedar Ave, Tacoma, WA"
                  />
                </label>

                <label>
                  Quote amount
                  <input
                    value={parsedData.quote_amount}
                    onChange={(event) => updateParsedField("quote_amount", event.currentTarget.value)}
                    placeholder="$4,850"
                  />
                </label>
              </div>

              <div className="grid two-col">
                <label>
                  Timeline
                  <input
                    value={parsedData.timeline}
                    onChange={(event) => updateParsedField("timeline", event.currentTarget.value)}
                    placeholder="2-day install, next Friday if approved"
                  />
                </label>

                <label>
                  Follow-up
                  <textarea
                    value={parsedData.follow_up}
                    onChange={(event) => updateParsedField("follow_up", event.currentTarget.value)}
                    rows={3}
                    placeholder="Call after HOA approval. Wants alternate paver option."
                  />
                </label>
              </div>

              <label>
                Scope of work
                <textarea
                  value={parsedData.scope_of_work}
                  onChange={(event) => updateParsedField("scope_of_work", event.currentTarget.value)}
                  rows={5}
                  placeholder="Demo old bed edge, haul debris, reset drip, install fresh bark and steel edging."
                />
              </label>

              <label>
                Labor notes
                <textarea
                  value={parsedData.labor_notes}
                  onChange={(event) => updateParsedField("labor_notes", event.currentTarget.value)}
                  rows={4}
                  placeholder="Need 3-person crew, stump grinder, and trailer access in alley."
                />
              </label>
            </form>
          </section>

          <section className="card">
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>Measurements</h3>
                <p className="muted">Keep dimensions clean so the job folder starts with usable field data.</p>
              </div>
              <button className="btn secondary" type="button" onClick={addMeasurementRow}>
                Add Measurement
              </button>
            </div>

            {parsedData.measurements.length > 0 ? (
              <div className="field-notes-line-list">
                {parsedData.measurements.map((row, index) => (
                  <div key={`measurement-${index}`} className="field-notes-line-item">
                    <div className="grid two-col">
                      <label>
                        Label
                        <input
                          value={row.label}
                          onChange={(event) => updateMeasurement(index, "label", event.currentTarget.value)}
                          placeholder="Back yard"
                        />
                      </label>
                      <label>
                        Value
                        <input
                          value={row.value}
                          onChange={(event) => updateMeasurement(index, "value", event.currentTarget.value)}
                          placeholder="860"
                        />
                      </label>
                    </div>

                    <div className="grid two-col">
                      <label>
                        Unit
                        <input
                          value={row.unit}
                          onChange={(event) => updateMeasurement(index, "unit", event.currentTarget.value)}
                          placeholder="sqft"
                        />
                      </label>
                      <label>
                        Notes
                        <input
                          value={row.notes}
                          onChange={(event) => updateMeasurement(index, "notes", event.currentTarget.value)}
                          placeholder="Includes side strip near fence"
                        />
                      </label>
                    </div>

                    <div className="field-notes-line-footer">
                      <span className="muted">{renderMeasurement(row)}</span>
                      <button className="btn secondary" type="button" onClick={() => removeMeasurementRow(index)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-notes-empty">
                <p>No measurements were captured yet.</p>
              </div>
            )}
          </section>

          <section className="card">
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>Materials</h3>
                <p className="muted">Capture product and quantity notes before they get lost between site visit and quote.</p>
              </div>
              <button className="btn secondary" type="button" onClick={addMaterialRow}>
                Add Material
              </button>
            </div>

            {parsedData.materials.length > 0 ? (
              <div className="field-notes-line-list">
                {parsedData.materials.map((row, index) => (
                  <div key={`material-${index}`} className="field-notes-line-item">
                    <div className="grid two-col">
                      <label>
                        Material
                        <input
                          value={row.name}
                          onChange={(event) => updateMaterial(index, "name", event.currentTarget.value)}
                          placeholder="3/4 clean gravel"
                        />
                      </label>
                      <label>
                        Quantity
                        <input
                          value={row.quantity}
                          onChange={(event) => updateMaterial(index, "quantity", event.currentTarget.value)}
                          placeholder="4"
                        />
                      </label>
                    </div>

                    <div className="grid two-col">
                      <label>
                        Unit
                        <input
                          value={row.unit}
                          onChange={(event) => updateMaterial(index, "unit", event.currentTarget.value)}
                          placeholder="yards"
                        />
                      </label>
                      <label>
                        Notes
                        <input
                          value={row.notes}
                          onChange={(event) => updateMaterial(index, "notes", event.currentTarget.value)}
                          placeholder="Match existing color"
                        />
                      </label>
                    </div>

                    <div className="field-notes-line-footer">
                      <span className="muted">{renderMaterial(row)}</span>
                      <button className="btn secondary" type="button" onClick={() => removeMaterialRow(index)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-notes-empty">
                <p>No materials were captured yet.</p>
              </div>
            )}
          </section>

          <section className="card">
            <div className="stack-cell">
              <h3>Step 5: Confirm and save</h3>
              <p className="muted">
                TieGui needs a phone number to create a real lead record. Save as a lead if you only want the job folder,
                or save as an estimate draft if you also want the invoice-draft text prepared.
              </p>
            </div>

            <form className="auth-form" style={{ marginTop: 14 }} onSubmit={(event) => event.preventDefault()}>
              <div className="grid two-col">
                <label>
                  Customer phone
                  <input
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.currentTarget.value);
                      resetSaveState();
                    }}
                    placeholder="(206) 555-0100"
                    required
                  />
                </label>

                <label>
                  Customer email (optional)
                  <input
                    value={email}
                    onChange={(event) => {
                      setEmail(event.currentTarget.value);
                      resetSaveState();
                    }}
                    placeholder="customer@example.com"
                  />
                </label>
              </div>

              <div className="portal-empty-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={processing || Boolean(savingMode)}
                  onClick={() => {
                    void handleSave("lead");
                  }}
                >
                  {savingMode === "lead" ? "Saving Lead..." : "Save as Lead"}
                </button>

                <button
                  className="btn secondary"
                  type="button"
                  disabled={processing || Boolean(savingMode)}
                  onClick={() => {
                    void handleSave("estimate");
                  }}
                >
                  {savingMode === "estimate" ? "Saving Estimate Draft..." : "Save as Estimate Draft"}
                </button>
              </div>
            </form>

            {savedLeadId && savedRedirectTo ? (
              <div className="field-notes-success-card">
                <div className="quick-meta">
                  <span className="badge status-success">
                    {savedMode === "estimate" ? "Estimate draft saved" : "Lead saved"}
                  </span>
                  <span className="badge">Lead ID: {savedLeadId}</span>
                </div>
                <div className="portal-empty-actions" style={{ marginTop: 12 }}>
                  <Link className="btn primary" href={savedRedirectTo}>
                    Open CRM Folder
                  </Link>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setPhone("");
                      setEmail("");
                      setParsedData(null);
                      setParseNotice(null);
                      setParseError(null);
                      resetSaveState();
                    }}
                  >
                    Scan Another Page
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
