"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  computeActualJobCost,
  computePlannedJobCost,
  formatJobCostingCurrency,
  formatJobCostingMargin,
  formatJobCostingProfitBasis,
  summarizeJobCosting,
  type JobCostingDetail,
  type JobCostingLaborRow,
  type JobCostingListItem,
  type JobCostingMaterialRow,
} from "@/lib/job-costing";
import { jobStatusOptions } from "@/lib/job-records";
import type { MaterialListItem } from "@/lib/materials";

type JobCostingManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialJobId: string | null;
};

type JobsResponse = {
  ok?: boolean;
  jobs?: JobCostingListItem[];
  error?: string;
} | null;

type JobResponse = {
  ok?: boolean;
  job?: JobCostingDetail | null;
  error?: string;
} | null;

type MaterialsResponse = {
  ok?: boolean;
  materials?: MaterialListItem[];
  error?: string;
} | null;

function buildJobPath(input: {
  orgId: string;
  internalUser: boolean;
  mobileMode: boolean;
  jobId: string | null;
}) {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.mobileMode) {
    params.set("mobile", "1");
  }
  const query = params.toString();
  const base = input.jobId
    ? `/app/jobs/records/${input.jobId}/costing`
    : "/app/jobs/records/costing";
  return query ? `${base}?${query}` : base;
}

function buildLinkPath(input: {
  orgId: string;
  internalUser: boolean;
  mobileMode: boolean;
  href: string;
}) {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.mobileMode) {
    params.set("mobile", "1");
  }
  const query = params.toString();
  return query ? `${input.href}?${query}` : input.href;
}

function hydrateMaterialRow(row: JobCostingMaterialRow): JobCostingMaterialRow {
  return {
    ...row,
    plannedTotal: computePlannedJobCost({
      quantity: row.plannedQuantity,
      unitCost: row.plannedUnitCost,
    }),
    actualTotal: computeActualJobCost({
      quantity: row.actualQuantity,
      unitCost: row.actualUnitCost,
    }),
  };
}

function hydrateLaborRow(row: JobCostingLaborRow): JobCostingLaborRow {
  return {
    ...row,
    plannedTotal: computePlannedJobCost({
      quantity: row.plannedQuantity,
      unitCost: row.plannedUnitCost,
    }),
    actualTotal: computeActualJobCost({
      quantity: row.actualHours,
      unitCost: row.actualHourlyCost,
    }),
  };
}

export default function JobCostingManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialJobId,
}: JobCostingManagerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mobileMode = searchParams.get("mobile") === "1";

  const [jobs, setJobs] = useState<JobCostingListItem[]>([]);
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    initialJobId,
  );
  const [selectedJob, setSelectedJob] = useState<JobCostingDetail | null>(null);
  const [costingNotes, setCostingNotes] = useState("");
  const [materialRows, setMaterialRows] = useState<JobCostingMaterialRow[]>([]);
  const [laborRows, setLaborRows] = useState<JobCostingLaborRow[]>([]);
  const [selectedCatalogMaterialId, setSelectedCatalogMaterialId] =
    useState("");

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(Boolean(initialJobId));
  const [loadingMaterials, setLoadingMaterials] = useState(
    Boolean(initialJobId),
  );
  const [savingNotes, setSavingNotes] = useState(false);
  const [busyMaterialId, setBusyMaterialId] = useState<string | null>(null);
  const [busyLaborId, setBusyLaborId] = useState<string | null>(null);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [addingLabor, setAddingLabor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const selectedOperationalJobHref = selectedJobId
    ? buildLinkPath({
        orgId,
        internalUser,
        mobileMode,
        href: `/app/jobs/records/${selectedJobId}`,
      })
    : null;

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

        const response = await fetch(`/api/jobs/costing?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response
          .json()
          .catch(() => null)) as JobsResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.jobs)) {
          throw new Error(
            payload?.error || "Failed to load job costing overview.",
          );
        }

        if (cancelled) return;
        setJobs(payload.jobs);
      } catch (loadError) {
        if (cancelled) return;
        setJobs([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load job costing overview.",
        );
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
  }, [deferredSearch, internalUser, orgId, refreshToken, statusFilter]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      setCostingNotes("");
      setMaterialRows([]);
      setLaborRows([]);
      setLoadingDetail(false);
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);
      setError(null);

      try {
        const response = await fetch(`/api/jobs/${selectedJobId}/costing`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response
          .json()
          .catch(() => null)) as JobResponse;
        if (!response.ok || !payload?.ok || !payload.job) {
          throw new Error(payload?.error || "Failed to load job costing.");
        }

        if (cancelled) return;
        setSelectedJob(payload.job);
        setCostingNotes(payload.job.costingNotes || "");
        setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
        setLaborRows(payload.job.labor.map(hydrateLaborRow));
      } catch (loadError) {
        if (cancelled) return;
        setSelectedJob(null);
        setMaterialRows([]);
        setLaborRows([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load job costing.",
        );
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedJobId, refreshToken]);

  useEffect(() => {
    if (!selectedJobId) return;

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
        const payload = (await response
          .json()
          .catch(() => null)) as MaterialsResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.materials)) {
          throw new Error(payload?.error || "Failed to load materials.");
        }
        if (cancelled) return;
        setMaterials(payload.materials);
      } catch (loadError) {
        if (cancelled) return;
        setMaterials([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load materials.",
        );
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
  }, [internalUser, orgId, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) {
      router.replace(
        buildJobPath({
          orgId,
          internalUser,
          mobileMode,
          jobId: null,
        }),
      );
      return;
    }

    router.replace(
      buildJobPath({
        orgId,
        internalUser,
        mobileMode,
        jobId: selectedJobId,
      }),
    );
  }, [selectedJobId, orgId, internalUser, mobileMode, router]);

  const localSummary = useMemo(
    () =>
      summarizeJobCosting({
        quotedRevenue: selectedJob?.quotedRevenue || 0,
        invoicedRevenue: selectedJob?.invoicedRevenue || 0,
        materials: materialRows,
        labor: laborRows,
      }),
    [
      laborRows,
      materialRows,
      selectedJob?.invoicedRevenue,
      selectedJob?.quotedRevenue,
    ],
  );

  function selectJob(jobId: string | null) {
    setSelectedJobId(jobId);
    setNotice(null);
    setError(null);
  }

  function updateMaterialRow(
    index: number,
    updater: (row: JobCostingMaterialRow) => JobCostingMaterialRow,
  ) {
    setMaterialRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? hydrateMaterialRow(updater(row)) : row,
      ),
    );
  }

  function updateLaborRow(
    index: number,
    updater: (row: JobCostingLaborRow) => JobCostingLaborRow,
  ) {
    setLaborRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? hydrateLaborRow(updater(row)) : row,
      ),
    );
  }

  async function saveNotes() {
    if (!selectedJobId || !canManage) return;

    setSavingNotes(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/jobs/${selectedJobId}/costing`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          costingNotes,
        }),
      });
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to save costing notes.");
      }
      setSelectedJob(payload.job);
      setCostingNotes(payload.job.costingNotes || "");
      setNotice("Costing notes saved.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save costing notes.",
      );
    } finally {
      setSavingNotes(false);
    }
  }

  async function addCatalogMaterial() {
    if (!selectedJobId || !selectedCatalogMaterialId || !canManage) return;

    setAddingMaterial(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/jobs/${selectedJobId}/costing/materials`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            materialId: selectedCatalogMaterialId,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to add material.");
      }

      setSelectedCatalogMaterialId("");
      setSelectedJob(payload.job);
      setCostingNotes(payload.job.costingNotes || "");
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Material added.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to add material.",
      );
    } finally {
      setAddingMaterial(false);
    }
  }

  async function addCustomMaterial() {
    if (!selectedJobId || !canManage) return;

    setAddingMaterial(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/jobs/${selectedJobId}/costing/materials`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Custom material",
            unit: "each",
            plannedQuantity: "1",
            plannedUnitCost: "0",
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to add custom material.");
      }

      setSelectedJob(payload.job);
      setCostingNotes(payload.job.costingNotes || "");
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Custom material row added.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to add custom material.",
      );
    } finally {
      setAddingMaterial(false);
    }
  }

  async function saveMaterialRow(row: JobCostingMaterialRow) {
    if (!selectedJobId || !canManage) return;

    setBusyMaterialId(row.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/jobs/${selectedJobId}/costing/materials/${row.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            materialId: row.materialId,
            name: row.name,
            unit: row.unit,
            plannedQuantity: row.plannedQuantity,
            plannedUnitCost: row.plannedUnitCost,
            actualQuantity: row.actualQuantity,
            actualUnitCost: row.actualUnitCost,
            varianceNotes: row.varianceNotes,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to save material row.");
      }

      setSelectedJob(payload.job);
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Material row saved.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save material row.",
      );
    } finally {
      setBusyMaterialId(null);
    }
  }

  async function deleteMaterialRow(rowId: string) {
    if (!selectedJobId || !canManage) return;

    setBusyMaterialId(rowId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/jobs/${selectedJobId}/costing/materials/${rowId}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to delete material row.");
      }

      setSelectedJob(payload.job);
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Material row deleted.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to delete material row.",
      );
    } finally {
      setBusyMaterialId(null);
    }
  }

  async function addLaborRow() {
    if (!selectedJobId || !canManage) return;

    setAddingLabor(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/jobs/${selectedJobId}/costing/labor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "Labor",
          unit: "hours",
          plannedQuantity: "1",
          plannedUnitCost: "0",
        }),
      });
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to add labor row.");
      }

      setSelectedJob(payload.job);
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Labor row added.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to add labor row.",
      );
    } finally {
      setAddingLabor(false);
    }
  }

  async function saveLaborRow(row: JobCostingLaborRow) {
    if (!selectedJobId || !canManage) return;

    setBusyLaborId(row.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/jobs/${selectedJobId}/costing/labor/${row.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description: row.description,
            unit: row.unit,
            plannedQuantity: row.plannedQuantity,
            plannedUnitCost: row.plannedUnitCost,
            actualHours: row.actualHours,
            actualHourlyCost: row.actualHourlyCost,
            varianceNotes: row.varianceNotes,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to save labor row.");
      }

      setSelectedJob(payload.job);
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Labor row saved.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save labor row.",
      );
    } finally {
      setBusyLaborId(null);
    }
  }

  async function deleteLaborRow(rowId: string) {
    if (!selectedJobId || !canManage) return;

    setBusyLaborId(rowId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/jobs/${selectedJobId}/costing/labor/${rowId}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => null)) as JobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to delete labor row.");
      }

      setSelectedJob(payload.job);
      setMaterialRows(payload.job.materials.map(hydrateMaterialRow));
      setLaborRows(payload.job.labor.map(hydrateLaborRow));
      setNotice("Labor row deleted.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to delete labor row.",
      );
    } finally {
      setBusyLaborId(null);
    }
  }

  return (
    <div className="job-costing-shell">
      <section className="card">
        <div className="stack" style={{ gap: 8 }}>
          <div
            className="inline"
            style={{
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={{ marginBottom: 4 }}>
                {selectedJobId ? "Costing Workspace" : "Job Profitability"}
              </h2>
              <p className="muted">
                {selectedJobId
                  ? "Track planned vs actual costs, revenue, and margin for this operational job."
                  : `See profitability across operational jobs in ${orgName}.`}
              </p>
              <p className="muted">
                Use the Operational Job page for dispatch, schedule, tracking,
                and customer communication.
              </p>
            </div>
            <div className="portal-empty-actions">
              {selectedOperationalJobHref ? (
                <Link className="btn primary" href={selectedOperationalJobHref}>
                  Open Operational Job
                </Link>
              ) : null}
              <Link
                className="btn secondary"
                href={buildLinkPath({
                  orgId,
                  internalUser,
                  mobileMode,
                  href: "/app/jobs/records",
                })}
              >
                Operational Jobs
              </Link>
              {selectedJobId ? (
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => selectJob(null)}
                >
                  Costing Overview
                </button>
              ) : null}
            </div>
          </div>
          {error ? <p className="text-red-600">{error}</p> : null}
          {notice ? <p className="text-green-700">{notice}</p> : null}
        </div>
      </section>

      {!selectedJobId ? (
        <>
          <section className="card">
            <form
              className="filters"
              onSubmit={(event) => event.preventDefault()}
            >
              <label>
                Search
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Customer, address, estimate, invoice"
                />
              </label>
              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {jobStatusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          </section>

          <section className="card">
            {loadingJobs ? (
              <div className="portal-empty-state job-costing-empty">
                <strong>Loading job profitability...</strong>
              </div>
            ) : jobs.length === 0 ? (
              <div className="portal-empty-state job-costing-empty">
                <strong>No operational jobs yet.</strong>
                <p className="muted">
                  Create or convert an operational job first, then open costing
                  to track profitability.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th>Quoted</th>
                      <th>Invoiced</th>
                      <th>Planned Cost</th>
                      <th>Actual Cost</th>
                      <th>Gross Profit</th>
                      <th>Gross Margin</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <div className="stack-cell">
                            <strong>{job.customerName}</strong>
                            <span className="muted">
                              {job.projectType || "Project"}
                            </span>
                            <span className="muted">{job.address}</span>
                            {job.sourceEstimate ? (
                              <span className="muted">
                                Quote: {job.sourceEstimate.label}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge status-${job.status.toLowerCase()}`}
                          >
                            {job.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>{formatJobCostingCurrency(job.quotedRevenue)}</td>
                        <td>{formatJobCostingCurrency(job.invoicedRevenue)}</td>
                        <td>{formatJobCostingCurrency(job.plannedCost)}</td>
                        <td>{formatJobCostingCurrency(job.actualCost)}</td>
                        <td>{formatJobCostingCurrency(job.grossProfit)}</td>
                        <td>
                          <div className="stack-cell">
                            <strong>
                              {formatJobCostingMargin(job.grossMarginPercent)}
                            </strong>
                            <span className="muted">
                              {formatJobCostingProfitBasis(job.profitBasis)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => selectJob(job.id)}
                          >
                            Open Costing
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="job-costing-detail-grid">
          <section className="card">
            {loadingDetail || !selectedJob ? (
              <div className="portal-empty-state job-costing-empty">
                <strong>Loading costing workspace...</strong>
              </div>
            ) : (
              <div className="stack" style={{ gap: 18 }}>
                <div
                  className="inline"
                  style={{
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h3 style={{ marginBottom: 4 }}>
                      {selectedJob.customerName}
                    </h3>
                    <p className="muted">
                      {selectedJob.projectType || "Project"} ·{" "}
                      {selectedJob.address}
                    </p>
                  </div>
                  <div className="quick-meta">
                    <span
                      className={`badge status-${selectedJob.status.toLowerCase()}`}
                    >
                      {selectedJob.status.replace(/_/g, " ")}
                    </span>
                    <span className="badge">
                      {selectedJob.sourceInvoices.length} invoice(s)
                    </span>
                  </div>
                </div>

                <div className="job-costing-summary-grid">
                  <article className="card estimate-summary-card">
                    <span className="muted">Quoted Revenue</span>
                    <strong>
                      {formatJobCostingCurrency(localSummary.quotedRevenue)}
                    </strong>
                  </article>
                  <article className="card estimate-summary-card">
                    <span className="muted">Invoiced Revenue</span>
                    <strong>
                      {formatJobCostingCurrency(localSummary.invoicedRevenue)}
                    </strong>
                  </article>
                  <article className="card estimate-summary-card">
                    <span className="muted">Planned Cost</span>
                    <strong>
                      {formatJobCostingCurrency(localSummary.plannedCost)}
                    </strong>
                  </article>
                  <article className="card estimate-summary-card">
                    <span className="muted">Actual Cost</span>
                    <strong>
                      {formatJobCostingCurrency(localSummary.actualCost)}
                    </strong>
                  </article>
                  <article className="card estimate-summary-card estimate-summary-card--final">
                    <span className="muted">Gross Profit</span>
                    <strong>
                      {formatJobCostingCurrency(localSummary.grossProfit)}
                    </strong>
                    <small className="muted">
                      {formatJobCostingProfitBasis(localSummary.profitBasis)}
                    </small>
                  </article>
                  <article className="card estimate-summary-card estimate-summary-card--final">
                    <span className="muted">Gross Margin</span>
                    <strong>
                      {formatJobCostingMargin(localSummary.grossMarginPercent)}
                    </strong>
                    <small className="muted">
                      Variance{" "}
                      {formatJobCostingCurrency(localSummary.costVariance)}
                    </small>
                  </article>
                </div>

                <section className="job-costing-section">
                  <div
                    className="inline"
                    style={{
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h4 style={{ marginBottom: 4 }}>Revenue Links</h4>
                      <p className="muted">
                        Track the quote that created the work and the invoices
                        attached to this job.
                      </p>
                    </div>
                    <Link
                      className="btn secondary"
                      href={buildLinkPath({
                        orgId,
                        internalUser,
                        mobileMode,
                        href: `/app/jobs/records`,
                      })}
                    >
                      Back to Records
                    </Link>
                  </div>
                  <div className="job-costing-link-grid">
                    <article className="card">
                      <strong>Source Estimate</strong>
                      {selectedJob.sourceEstimate ? (
                        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                          <Link
                            className="table-link"
                            href={buildLinkPath({
                              orgId,
                              internalUser,
                              mobileMode,
                              href: `/app/estimates/${selectedJob.sourceEstimate.id}`,
                            })}
                          >
                            {selectedJob.sourceEstimate.label}
                          </Link>
                          <span className="muted">
                            {formatJobCostingCurrency(
                              selectedJob.sourceEstimate.total,
                            )}
                          </span>
                        </div>
                      ) : (
                        <p className="muted" style={{ marginTop: 8 }}>
                          No linked estimate yet.
                        </p>
                      )}
                    </article>
                    <article className="card">
                      <strong>Invoices</strong>
                      {selectedJob.sourceInvoices.length === 0 ? (
                        <p className="muted" style={{ marginTop: 8 }}>
                          No invoices linked to this job yet.
                        </p>
                      ) : (
                        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                          {selectedJob.sourceInvoices.map((invoice) => (
                            <div
                              key={invoice.id}
                              className="inline"
                              style={{
                                justifyContent: "space-between",
                                gap: 12,
                              }}
                            >
                              <div className="stack-cell">
                                <Link
                                  className="table-link"
                                  href={buildLinkPath({
                                    orgId,
                                    internalUser,
                                    mobileMode,
                                    href: `/app/invoices/${invoice.id}`,
                                  })}
                                >
                                  {invoice.invoiceNumber}
                                </Link>
                                <span className="muted">{invoice.status}</span>
                              </div>
                              <strong>
                                {formatJobCostingCurrency(invoice.total)}
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  </div>
                </section>

                <section className="job-costing-section">
                  <div
                    className="inline"
                    style={{
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h4 style={{ marginBottom: 4 }}>Costing Notes</h4>
                      <p className="muted">
                        Capture job-wide margin risks, change orders, and
                        variance context.
                      </p>
                    </div>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!canManage || savingNotes}
                      onClick={saveNotes}
                    >
                      {savingNotes ? "Saving..." : "Save Notes"}
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={costingNotes}
                    disabled={!canManage}
                    onChange={(event) => setCostingNotes(event.target.value)}
                    placeholder="Document profitability risks, supplier changes, or crew overruns."
                  />
                </section>

                <section className="job-costing-section">
                  <div
                    className="inline"
                    style={{
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h4 style={{ marginBottom: 4 }}>Materials</h4>
                      <p className="muted">
                        Track planned cost against actual purchased quantity and
                        unit cost.
                      </p>
                    </div>
                    <div className="portal-empty-actions">
                      <select
                        value={selectedCatalogMaterialId}
                        disabled={!canManage || loadingMaterials}
                        onChange={(event) =>
                          setSelectedCatalogMaterialId(event.target.value)
                        }
                      >
                        <option value="">
                          {loadingMaterials
                            ? "Loading materials..."
                            : "Select catalog material"}
                        </option>
                        {materials.map((material) => (
                          <option key={material.id} value={material.id}>
                            {material.category} · {material.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={
                          !canManage ||
                          !selectedCatalogMaterialId ||
                          addingMaterial
                        }
                        onClick={addCatalogMaterial}
                      >
                        Add Catalog
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={!canManage || addingMaterial}
                        onClick={addCustomMaterial}
                      >
                        Add Custom
                      </button>
                    </div>
                  </div>
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table className="data-table job-costing-table">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th>Planned Qty</th>
                          <th>Unit</th>
                          <th>Planned Unit Cost</th>
                          <th>Planned Cost</th>
                          <th>Actual Qty</th>
                          <th>Actual Unit Cost</th>
                          <th>Actual Cost</th>
                          <th>Variance Notes</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialRows.length === 0 ? (
                          <tr>
                            <td colSpan={10}>
                              <div className="portal-empty-state job-costing-empty">
                                <strong>No material rows yet.</strong>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          materialRows.map((row, index) => (
                            <tr key={row.id}>
                              <td>
                                <div className="stack-cell">
                                  <input
                                    value={row.name}
                                    disabled={!canManage}
                                    onChange={(event) =>
                                      updateMaterialRow(index, (current) => ({
                                        ...current,
                                        name: event.target.value,
                                      }))
                                    }
                                  />
                                  {row.notes ? (
                                    <small className="muted">{row.notes}</small>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <input
                                  value={row.plannedQuantity}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateMaterialRow(index, (current) => ({
                                      ...current,
                                      plannedQuantity: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  value={row.unit}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateMaterialRow(index, (current) => ({
                                      ...current,
                                      unit: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  value={row.plannedUnitCost}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateMaterialRow(index, (current) => ({
                                      ...current,
                                      plannedUnitCost: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <strong>
                                  {formatJobCostingCurrency(row.plannedTotal)}
                                </strong>
                              </td>
                              <td>
                                <input
                                  value={row.actualQuantity}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateMaterialRow(index, (current) => ({
                                      ...current,
                                      actualQuantity: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  value={row.actualUnitCost}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateMaterialRow(index, (current) => ({
                                      ...current,
                                      actualUnitCost: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <strong>
                                  {formatJobCostingCurrency(row.actualTotal)}
                                </strong>
                              </td>
                              <td>
                                <input
                                  value={row.varianceNotes}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateMaterialRow(index, (current) => ({
                                      ...current,
                                      varianceNotes: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <div className="estimate-module-line-actions">
                                  <button
                                    className="btn secondary"
                                    type="button"
                                    disabled={
                                      !canManage || busyMaterialId === row.id
                                    }
                                    onClick={() => saveMaterialRow(row)}
                                  >
                                    {busyMaterialId === row.id
                                      ? "Saving..."
                                      : "Save"}
                                  </button>
                                  <button
                                    className="btn secondary"
                                    type="button"
                                    disabled={
                                      !canManage || busyMaterialId === row.id
                                    }
                                    onClick={() => deleteMaterialRow(row.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="job-costing-section">
                  <div
                    className="inline"
                    style={{
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h4 style={{ marginBottom: 4 }}>Labor</h4>
                      <p className="muted">
                        Track planned crew cost against actual hours and hourly
                        cost.
                      </p>
                    </div>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={!canManage || addingLabor}
                      onClick={addLaborRow}
                    >
                      {addingLabor ? "Adding..." : "Add Labor"}
                    </button>
                  </div>
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table className="data-table job-costing-table">
                      <thead>
                        <tr>
                          <th>Labor</th>
                          <th>Planned Hours</th>
                          <th>Unit</th>
                          <th>Planned Hourly Cost</th>
                          <th>Planned Cost</th>
                          <th>Actual Hours</th>
                          <th>Actual Hourly Cost</th>
                          <th>Actual Cost</th>
                          <th>Variance Notes</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {laborRows.length === 0 ? (
                          <tr>
                            <td colSpan={10}>
                              <div className="portal-empty-state job-costing-empty">
                                <strong>No labor rows yet.</strong>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          laborRows.map((row, index) => (
                            <tr key={row.id}>
                              <td>
                                <div className="stack-cell">
                                  <input
                                    value={row.description}
                                    disabled={!canManage}
                                    onChange={(event) =>
                                      updateLaborRow(index, (current) => ({
                                        ...current,
                                        description: event.target.value,
                                      }))
                                    }
                                  />
                                  {row.notes ? (
                                    <small className="muted">{row.notes}</small>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <input
                                  value={row.plannedQuantity}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateLaborRow(index, (current) => ({
                                      ...current,
                                      plannedQuantity: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  value={row.unit}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateLaborRow(index, (current) => ({
                                      ...current,
                                      unit: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  value={row.plannedUnitCost}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateLaborRow(index, (current) => ({
                                      ...current,
                                      plannedUnitCost: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <strong>
                                  {formatJobCostingCurrency(row.plannedTotal)}
                                </strong>
                              </td>
                              <td>
                                <input
                                  value={row.actualHours}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateLaborRow(index, (current) => ({
                                      ...current,
                                      actualHours: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  value={row.actualHourlyCost}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateLaborRow(index, (current) => ({
                                      ...current,
                                      actualHourlyCost: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <strong>
                                  {formatJobCostingCurrency(row.actualTotal)}
                                </strong>
                              </td>
                              <td>
                                <input
                                  value={row.varianceNotes}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    updateLaborRow(index, (current) => ({
                                      ...current,
                                      varianceNotes: event.target.value,
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <div className="estimate-module-line-actions">
                                  <button
                                    className="btn secondary"
                                    type="button"
                                    disabled={
                                      !canManage || busyLaborId === row.id
                                    }
                                    onClick={() => saveLaborRow(row)}
                                  >
                                    {busyLaborId === row.id
                                      ? "Saving..."
                                      : "Save"}
                                  </button>
                                  <button
                                    className="btn secondary"
                                    type="button"
                                    disabled={
                                      !canManage || busyLaborId === row.id
                                    }
                                    onClick={() => deleteLaborRow(row.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}
          </section>
        </section>
      )}
    </div>
  );
}
