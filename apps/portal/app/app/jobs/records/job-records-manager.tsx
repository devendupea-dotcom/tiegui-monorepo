"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatEstimateCurrency } from "@/lib/estimates";
import {
  computeJobLineTotal,
  createEmptyJobLabor,
  createEmptyJobMaterial,
  createEmptyJobMeasurement,
  jobStatusOptions,
  type JobDetail,
  type JobEstimateSummary,
  type JobLaborRow,
  type JobListItem,
  type JobMaterialRow,
  type JobMeasurementRow,
} from "@/lib/job-records";
import type { MaterialListItem } from "@/lib/materials";

type JobRecordsManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
};

type JobsResponse =
  | {
      ok?: boolean;
      jobs?: JobListItem[];
      error?: string;
    }
  | null;

type JobResponse =
  | {
      ok?: boolean;
      job?: JobDetail;
      error?: string;
    }
  | null;

type MaterialsResponse =
  | {
      ok?: boolean;
      materials?: MaterialListItem[];
      error?: string;
    }
  | null;

type EstimateDraftsResponse =
  | {
      ok?: boolean;
      drafts?: JobEstimateSummary[];
      error?: string;
    }
  | null;

type JobFormState = {
  customerName: string;
  address: string;
  projectType: string;
  notes: string;
  status: (typeof jobStatusOptions)[number];
  estimateDraftId: string;
  measurements: JobMeasurementRow[];
  materials: JobMaterialRow[];
  labor: JobLaborRow[];
};

const emptyJobForm: JobFormState = {
  customerName: "",
  address: "",
  projectType: "",
  notes: "",
  status: "DRAFT",
  estimateDraftId: "",
  measurements: [],
  materials: [],
  labor: [],
};

function computeMaterialRow(row: JobMaterialRow): JobMaterialRow {
  return {
    ...row,
    total: computeJobLineTotal({
      quantity: row.quantity,
      cost: row.cost,
      markupPercent: row.markupPercent,
    }),
  };
}

function computeLaborRow(row: JobLaborRow): JobLaborRow {
  return {
    ...row,
    total: computeJobLineTotal({
      quantity: row.quantity,
      cost: row.cost,
      markupPercent: row.markupPercent,
    }),
  };
}

function applyJobDetailToForm(job: JobDetail): JobFormState {
  return {
    customerName: job.customerName,
    address: job.address,
    projectType: job.projectType,
    notes: job.notes || "",
    status: job.status,
    estimateDraftId: job.estimateDraft?.id || "",
    measurements: job.measurements,
    materials: job.materials.map(computeMaterialRow),
    labor: job.labor.map(computeLaborRow),
  };
}

export default function JobRecordsManager({
  orgId,
  orgName,
  internalUser,
  canManage,
}: JobRecordsManagerProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [estimateDrafts, setEstimateDrafts] = useState<JobEstimateSummary[]>([]);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedCatalogMaterialId, setSelectedCatalogMaterialId] = useState("");
  const [form, setForm] = useState<JobFormState>(emptyJobForm);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");

  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      setLoadingReferences(true);
      try {
        const params = new URLSearchParams();
        params.set("active", "true");
        if (internalUser) {
          params.set("orgId", orgId);
        }

        const draftsParams = new URLSearchParams();
        if (internalUser) {
          draftsParams.set("orgId", orgId);
        }

        const [materialsResponse, draftsResponse] = await Promise.all([
          fetch(`/api/materials?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/estimates/drafts?${draftsParams.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const materialsPayload = (await materialsResponse.json().catch(() => null)) as MaterialsResponse;
        const draftsPayload = (await draftsResponse.json().catch(() => null)) as EstimateDraftsResponse;

        if (!materialsResponse.ok || !materialsPayload?.ok || !Array.isArray(materialsPayload.materials)) {
          throw new Error(materialsPayload?.error || "Failed to load materials.");
        }
        if (!draftsResponse.ok || !draftsPayload?.ok || !Array.isArray(draftsPayload.drafts)) {
          throw new Error(draftsPayload?.error || "Failed to load estimate drafts.");
        }

        if (cancelled) return;
        setMaterials(materialsPayload.materials);
        setEstimateDrafts(draftsPayload.drafts);
      } catch (loadError) {
        if (cancelled) return;
        setMaterials([]);
        setEstimateDrafts([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load job references.");
      } finally {
        if (!cancelled) {
          setLoadingReferences(false);
        }
      }
    }

    void loadReferences();

    return () => {
      cancelled = true;
    };
  }, [internalUser, orgId]);

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      setLoadingJobs(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (internalUser) {
          params.set("orgId", orgId);
        }
        if (deferredSearch.trim()) {
          params.set("q", deferredSearch.trim());
        }
        if (statusFilter) {
          params.set("status", statusFilter);
        }

        const response = await fetch(`/api/jobs?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as JobsResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.jobs)) {
          throw new Error(payload?.error || "Failed to load jobs.");
        }

        if (cancelled) return;
        setJobs(payload.jobs);
      } catch (loadError) {
        if (cancelled) return;
        setJobs([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load jobs.");
      } finally {
        if (!cancelled) {
          setLoadingJobs(false);
        }
      }
    }

    void loadJobs();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, statusFilter, internalUser, orgId, refreshToken]);

  useEffect(() => {
    if (!selectedJobId) return;

    let cancelled = false;
    async function loadJobDetail() {
      setLoadingDetail(true);
      setError(null);
      setNotice(null);

      try {
        const response = await fetch(`/api/jobs/${selectedJobId}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as JobResponse;
        if (!response.ok || !payload?.ok || !payload.job) {
          throw new Error(payload?.error || "Failed to load job details.");
        }

        if (cancelled) return;
        setForm(applyJobDetailToForm(payload.job));
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load job details.");
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadJobDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedJobId]);

  function beginCreateJob() {
    setSelectedJobId(null);
    setForm(emptyJobForm);
    setSelectedCatalogMaterialId("");
    setError(null);
    setNotice(null);
  }

  function updateForm<K extends keyof JobFormState>(field: K, value: JobFormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addMeasurement() {
    updateForm("measurements", [...form.measurements, createEmptyJobMeasurement()]);
  }

  function addCustomMaterial() {
    updateForm("materials", [...form.materials, computeMaterialRow(createEmptyJobMaterial())]);
  }

  function addCatalogMaterial() {
    const material = materials.find((entry) => entry.id === selectedCatalogMaterialId);
    if (!material) {
      setError("Select a catalog material first.");
      return;
    }

    updateForm("materials", [
      ...form.materials,
      computeMaterialRow({
        ...createEmptyJobMaterial(),
        materialId: material.id,
        name: material.name,
        quantity: "1",
        unit: material.unit,
        cost: material.baseCost.toFixed(2),
        markupPercent: material.markupPercent.toFixed(2).replace(/\.00$/, ""),
      }),
    ]);
    setSelectedCatalogMaterialId("");
    setError(null);
  }

  function addLabor() {
    updateForm("labor", [...form.labor, computeLaborRow(createEmptyJobLabor())]);
  }

  function updateMeasurement(index: number, patch: Partial<JobMeasurementRow>) {
    updateForm(
      "measurements",
      form.measurements.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function updateMaterial(index: number, patch: Partial<JobMaterialRow>) {
    updateForm(
      "materials",
      form.materials.map((row, rowIndex) =>
        rowIndex === index
          ? computeMaterialRow({
              ...row,
              ...patch,
            })
          : row,
      ),
    );
  }

  function updateLabor(index: number, patch: Partial<JobLaborRow>) {
    updateForm(
      "labor",
      form.labor.map((row, rowIndex) =>
        rowIndex === index
          ? computeLaborRow({
              ...row,
              ...patch,
            })
          : row,
      ),
    );
  }

  function removeMeasurement(index: number) {
    updateForm(
      "measurements",
      form.measurements.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  function removeMaterial(index: number) {
    updateForm(
      "materials",
      form.materials.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  function removeLabor(index: number) {
    updateForm(
      "labor",
      form.labor.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  async function saveJob() {
    if (!canManage) {
      setError("Read-only users cannot save job records.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const body = {
        ...(internalUser && !selectedJobId ? { orgId } : {}),
        customerName: form.customerName,
        address: form.address,
        projectType: form.projectType,
        notes: form.notes,
        status: form.status,
        estimateDraftId: form.estimateDraftId || null,
        measurements: form.measurements.map((row) => ({
          label: row.label,
          value: row.value,
          unit: row.unit,
          notes: row.notes,
        })),
        materials: form.materials.map((row) => ({
          materialId: row.materialId,
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          cost: row.cost,
          markupPercent: row.markupPercent,
          notes: row.notes,
        })),
        labor: form.labor.map((row) => ({
          description: row.description,
          quantity: row.quantity,
          unit: row.unit,
          cost: row.cost,
          markupPercent: row.markupPercent,
          notes: row.notes,
        })),
      };

      const response = await fetch(selectedJobId ? `/api/jobs/${selectedJobId}` : "/api/jobs", {
        method: selectedJobId ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to save job.");
      }

      setSelectedJobId(payload.job.id);
      setForm(applyJobDetailToForm(payload.job));
      setNotice(selectedJobId ? "Job updated." : "Job created.");
      setRefreshToken((current) => current + 1);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save job.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="job-records-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Structured Job Records</h2>
            <p className="muted">
              Organize contractor job data for {orgName} with measurements, materials, labor, attached estimates, and job
              notes.
            </p>
          </div>
          <div className="portal-empty-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => router.push(internalUser ? `/app/jobs/records/costing?orgId=${orgId}` : "/app/jobs/records/costing")}
            >
              Job Costing
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                router.push(
                  internalUser
                    ? `/app/purchase-orders?orgId=${orgId}${selectedJobId ? `&jobId=${selectedJobId}` : ""}`
                    : `/app/purchase-orders${selectedJobId ? `?jobId=${selectedJobId}` : ""}`,
                )
              }
            >
              Purchase Orders
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() =>
                router.push(
                  internalUser
                    ? `/app/expenses?orgId=${orgId}${selectedJobId ? `&jobId=${selectedJobId}` : ""}`
                    : `/app/expenses${selectedJobId ? `?jobId=${selectedJobId}` : ""}`,
                )
              }
            >
              Expenses
            </button>
            <button className="btn primary" type="button" onClick={beginCreateJob}>
              New Job
            </button>
          </div>
        </div>

        {notice ? <p className="form-status" style={{ marginTop: 12 }}>{notice}</p> : null}
        {error ? <p className="form-status" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>

      <div className="job-records-grid">
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>Jobs</h3>
              <p className="muted">List jobs, open a record, or filter by status.</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Customer, address, project type"
              />
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
                <option value="">All</option>
                {jobStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </form>

          {loadingJobs ? (
            <div className="portal-empty-state job-records-empty">
              <strong>Loading jobs...</strong>
            </div>
          ) : jobs.length === 0 ? (
            <div className="portal-empty-state job-records-empty">
              <strong>No structured jobs yet.</strong>
              <p className="muted">Create your first job record to track measurements, materials, labor, and estimate links.</p>
            </div>
          ) : (
            <div className="job-records-list">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  className={`job-records-list-item ${selectedJobId === job.id ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSelectedJobId(job.id);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <div className="stack-cell">
                    <strong>{job.customerName}</strong>
                    <span className="muted">{job.projectType}</span>
                    <span className="muted">{job.address}</span>
                  </div>
                  <div className="quick-meta">
                    <span className="badge">{job.status.replace(/_/g, " ")}</span>
                    {job.estimateDraft ? <span className="badge status-success">Estimate linked</span> : null}
                  </div>
                  <span className="muted">
                    {job.counts.measurements} measurements • {job.counts.materials} materials • {job.counts.labor} labor
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>{selectedJobId ? "Job Details" : "New Job"}</h3>
              <p className="muted">Edit job info, attach an estimate, and maintain notes plus structured production data.</p>
            </div>
          </div>

          {loadingDetail ? (
            <div className="portal-empty-state job-records-empty">
              <strong>Loading job details...</strong>
            </div>
          ) : (
            <>
              <form className="auth-form" style={{ marginTop: 14 }} onSubmit={(event) => event.preventDefault()}>
                <div className="grid two-col">
                  <label>
                    Customer name
                    <input
                      value={form.customerName}
                      onChange={(event) => updateForm("customerName", event.currentTarget.value)}
                      placeholder="Maria Ramirez"
                    />
                  </label>

                  <label>
                    Status
                    <select
                      value={form.status}
                      onChange={(event) => updateForm("status", event.currentTarget.value as JobFormState["status"])}
                    >
                      {jobStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid two-col">
                  <label>
                    Address
                    <input
                      value={form.address}
                      onChange={(event) => updateForm("address", event.currentTarget.value)}
                      placeholder="123 Cedar Ave, Tacoma, WA"
                    />
                  </label>

                  <label>
                    Project type
                    <input
                      value={form.projectType}
                      onChange={(event) => updateForm("projectType", event.currentTarget.value)}
                      placeholder="Landscape install"
                    />
                  </label>
                </div>

                <label>
                  Attach estimate
                  <select
                    value={form.estimateDraftId}
                    onChange={(event) => updateForm("estimateDraftId", event.currentTarget.value)}
                    disabled={loadingReferences}
                  >
                    <option value="">No estimate attached</option>
                    {estimateDrafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>
                        {draft.projectName} · {draft.customerName || "No customer"} · {formatEstimateCurrency(draft.finalTotal)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Notes
                  <textarea
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.currentTarget.value)}
                    rows={4}
                    placeholder="Crew access notes, scope reminders, punch items, or customer requests."
                  />
                </label>
              </form>

              <section className="job-records-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Measurements</h4>
                  </div>
                  <button className="btn secondary" type="button" onClick={addMeasurement}>
                    Add Measurement
                  </button>
                </div>

                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>Value</th>
                        <th>Unit</th>
                        <th>Notes</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {form.measurements.length === 0 ? (
                        <tr>
                          <td className="muted" colSpan={5}>
                            No measurements attached yet.
                          </td>
                        </tr>
                      ) : (
                        form.measurements.map((row, index) => (
                          <tr key={row.id}>
                            <td>
                              <input value={row.label} onChange={(event) => updateMeasurement(index, { label: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.value} onChange={(event) => updateMeasurement(index, { value: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.unit} onChange={(event) => updateMeasurement(index, { unit: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.notes} onChange={(event) => updateMeasurement(index, { notes: event.currentTarget.value })} />
                            </td>
                            <td>
                              <button className="btn secondary" type="button" onClick={() => removeMeasurement(index)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="job-records-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Job Materials</h4>
                  </div>
                  <div className="portal-empty-actions">
                    <select
                      value={selectedCatalogMaterialId}
                      onChange={(event) => setSelectedCatalogMaterialId(event.currentTarget.value)}
                      disabled={loadingReferences}
                    >
                      <option value="">Select catalog material</option>
                      {materials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.category} · {material.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn primary" type="button" onClick={addCatalogMaterial} disabled={!selectedCatalogMaterialId}>
                      Add Catalog
                    </button>
                    <button className="btn secondary" type="button" onClick={addCustomMaterial}>
                      Add Custom
                    </button>
                  </div>
                </div>

                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Qty</th>
                        <th>Unit</th>
                        <th>Cost</th>
                        <th>Markup</th>
                        <th>Total</th>
                        <th>Notes</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {form.materials.length === 0 ? (
                        <tr>
                          <td className="muted" colSpan={8}>
                            No materials attached yet.
                          </td>
                        </tr>
                      ) : (
                        form.materials.map((row, index) => (
                          <tr key={row.id}>
                            <td>
                              <input value={row.name} onChange={(event) => updateMaterial(index, { name: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.quantity} onChange={(event) => updateMaterial(index, { quantity: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.unit} onChange={(event) => updateMaterial(index, { unit: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.cost} onChange={(event) => updateMaterial(index, { cost: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input
                                value={row.markupPercent}
                                onChange={(event) => updateMaterial(index, { markupPercent: event.currentTarget.value })}
                              />
                            </td>
                            <td>
                              <strong>{formatEstimateCurrency(row.total)}</strong>
                            </td>
                            <td>
                              <input value={row.notes} onChange={(event) => updateMaterial(index, { notes: event.currentTarget.value })} />
                            </td>
                            <td>
                              <button className="btn secondary" type="button" onClick={() => removeMaterial(index)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="job-records-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Job Labor</h4>
                  </div>
                  <button className="btn secondary" type="button" onClick={addLabor}>
                    Add Labor
                  </button>
                </div>

                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Unit</th>
                        <th>Cost</th>
                        <th>Markup</th>
                        <th>Total</th>
                        <th>Notes</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {form.labor.length === 0 ? (
                        <tr>
                          <td className="muted" colSpan={8}>
                            No labor attached yet.
                          </td>
                        </tr>
                      ) : (
                        form.labor.map((row, index) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                value={row.description}
                                onChange={(event) => updateLabor(index, { description: event.currentTarget.value })}
                              />
                            </td>
                            <td>
                              <input value={row.quantity} onChange={(event) => updateLabor(index, { quantity: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.unit} onChange={(event) => updateLabor(index, { unit: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input value={row.cost} onChange={(event) => updateLabor(index, { cost: event.currentTarget.value })} />
                            </td>
                            <td>
                              <input
                                value={row.markupPercent}
                                onChange={(event) => updateLabor(index, { markupPercent: event.currentTarget.value })}
                              />
                            </td>
                            <td>
                              <strong>{formatEstimateCurrency(row.total)}</strong>
                            </td>
                            <td>
                              <input value={row.notes} onChange={(event) => updateLabor(index, { notes: event.currentTarget.value })} />
                            </td>
                            <td>
                              <button className="btn secondary" type="button" onClick={() => removeLabor(index)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="portal-empty-actions" style={{ marginTop: 18 }}>
                <button className="btn primary" type="button" disabled={saving || !canManage} onClick={() => void saveJob()}>
                  {saving ? "Saving..." : selectedJobId ? "Save Job" : "Create Job"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
