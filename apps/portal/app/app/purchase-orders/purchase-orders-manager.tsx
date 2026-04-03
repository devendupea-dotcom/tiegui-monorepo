"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/invoices";
import type { JobListItem } from "@/lib/job-records";
import type { MaterialListItem } from "@/lib/materials";
import {
  computePurchaseOrderLineTotal,
  createEmptyPurchaseOrderLineItem,
  purchaseOrderStatusOptions,
  type PurchaseOrderDetail,
  type PurchaseOrderLineItemRow,
  type PurchaseOrderListItem,
} from "@/lib/purchase-orders";

type PurchaseOrdersManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialJobId: string | null;
};

type PurchaseOrdersResponse =
  | {
      ok?: boolean;
      purchaseOrders?: PurchaseOrderListItem[];
      error?: string;
    }
  | null;

type PurchaseOrderResponse =
  | {
      ok?: boolean;
      purchaseOrder?: PurchaseOrderDetail;
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

type JobsResponse =
  | {
      ok?: boolean;
      jobs?: JobListItem[];
      error?: string;
    }
  | null;

type SendDraftResponse =
  | {
      ok?: boolean;
      delivery?: "outlook" | "manual-draft";
      recipientEmail?: string | null;
      subject?: string;
      body?: string;
      mailtoUrl?: string | null;
      message?: string;
      purchaseOrder?: PurchaseOrderDetail;
      error?: string;
    }
  | null;

type PurchaseOrderFormState = {
  jobId: string;
  vendorName: string;
  vendorEmail: string;
  vendorPhone: string;
  vendorAddress: string;
  title: string;
  notes: string;
  taxRatePercent: string;
  status: (typeof purchaseOrderStatusOptions)[number];
  lineItems: PurchaseOrderLineItemRow[];
};

const defaultFormState: PurchaseOrderFormState = {
  jobId: "",
  vendorName: "",
  vendorEmail: "",
  vendorPhone: "",
  vendorAddress: "",
  title: "",
  notes: "",
  taxRatePercent: "0",
  status: "DRAFT",
  lineItems: [createEmptyPurchaseOrderLineItem()],
};

function applyLineTotal(row: PurchaseOrderLineItemRow): PurchaseOrderLineItemRow {
  return {
    ...row,
    total: computePurchaseOrderLineTotal({
      quantity: row.quantity,
      unitCost: row.unitCost,
    }),
  };
}

function applyDetailToForm(order: PurchaseOrderDetail): PurchaseOrderFormState {
  return {
    jobId: order.job?.id || "",
    vendorName: order.vendorName,
    vendorEmail: order.vendorEmail || "",
    vendorPhone: order.vendorPhone || "",
    vendorAddress: order.vendorAddress || "",
    title: order.title,
    notes: order.notes || "",
    taxRatePercent: order.taxRatePercent,
    status: order.status,
    lineItems: order.lineItems.map(applyLineTotal),
  };
}

function buildScopedQuery(input: {
  internalUser: boolean;
  orgId: string;
  search: string;
  status: string;
  jobId: string;
}): string {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.search.trim()) {
    params.set("q", input.search.trim());
  }
  if (input.status) {
    params.set("status", input.status);
  }
  if (input.jobId) {
    params.set("jobId", input.jobId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function PurchaseOrdersManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialJobId,
}: PurchaseOrdersManagerProps) {
  const router = useRouter();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderListItem[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string | null>(null);
  const [selectedCatalogMaterialId, setSelectedCatalogMaterialId] = useState("");
  const [form, setForm] = useState<PurchaseOrderFormState>({
    ...defaultFormState,
    jobId: initialJobId || "",
  });

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [jobFilter, setJobFilter] = useState(initialJobId || "");
  const [loadingList, setLoadingList] = useState(true);
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
        if (internalUser) {
          params.set("orgId", orgId);
        }

        const materialParams = new URLSearchParams(params);
        materialParams.set("active", "true");

        const [jobsResponse, materialsResponse] = await Promise.all([
          fetch(`/api/jobs?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/materials?${materialParams.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const jobsPayload = (await jobsResponse.json().catch(() => null)) as JobsResponse;
        const materialsPayload = (await materialsResponse.json().catch(() => null)) as MaterialsResponse;

        if (!jobsResponse.ok || !jobsPayload?.ok || !Array.isArray(jobsPayload.jobs)) {
          throw new Error(jobsPayload?.error || "Failed to load jobs.");
        }
        if (!materialsResponse.ok || !materialsPayload?.ok || !Array.isArray(materialsPayload.materials)) {
          throw new Error(materialsPayload?.error || "Failed to load materials.");
        }

        if (cancelled) return;
        setJobs(jobsPayload.jobs);
        setMaterials(materialsPayload.materials);
      } catch (loadError) {
        if (cancelled) return;
        setJobs([]);
        setMaterials([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load purchase order references.");
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

    async function loadPurchaseOrders() {
      setLoadingList(true);

      try {
        const response = await fetch(
          `/api/purchase-orders${buildScopedQuery({
            internalUser,
            orgId,
            search: deferredSearch,
            status: statusFilter,
            jobId: jobFilter,
          })}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response.json().catch(() => null)) as PurchaseOrdersResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.purchaseOrders)) {
          throw new Error(payload?.error || "Failed to load purchase orders.");
        }

        if (cancelled) return;
        setPurchaseOrders(payload.purchaseOrders);
      } catch (loadError) {
        if (cancelled) return;
        setPurchaseOrders([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load purchase orders.");
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    }

    void loadPurchaseOrders();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, internalUser, jobFilter, orgId, refreshToken, statusFilter]);

  useEffect(() => {
    if (!selectedPurchaseOrderId) return;

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);

      try {
        const response = await fetch(`/api/purchase-orders/${selectedPurchaseOrderId}`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as PurchaseOrderResponse;
        if (!response.ok || !payload?.ok || !payload.purchaseOrder) {
          throw new Error(payload?.error || "Failed to load purchase order.");
        }

        if (cancelled) return;
        setForm(applyDetailToForm(payload.purchaseOrder));
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load purchase order.");
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
  }, [selectedPurchaseOrderId]);

  const totals = useMemo(() => {
    const subtotal = form.lineItems.reduce((sum, item) => sum + item.total, 0);
    const taxRate = Number.parseFloat(form.taxRatePercent || "0");
    const safeTaxRate = Number.isFinite(taxRate) ? Math.max(0, taxRate) : 0;
    const taxAmount = subtotal * (safeTaxRate / 100);
    return {
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
    };
  }, [form.lineItems, form.taxRatePercent]);

  const summary = useMemo(() => {
    const draftCount = purchaseOrders.filter((order) => order.status === "DRAFT").length;
    const sentCount = purchaseOrders.filter((order) => order.status === "SENT").length;
    const totalOpen = purchaseOrders
      .filter((order) => order.status !== "CANCELLED")
      .reduce((sum, order) => sum + order.total, 0);

    return {
      totalCount: purchaseOrders.length,
      draftCount,
      sentCount,
      totalOpen,
    };
  }, [purchaseOrders]);

  function resetEditor(nextJobId = jobFilter || initialJobId || "") {
    setSelectedPurchaseOrderId(null);
    setSelectedCatalogMaterialId("");
    setForm({
      ...defaultFormState,
      jobId: nextJobId,
    });
  }

  function beginCreate() {
    resetEditor();
    setNotice(null);
    setError(null);
  }

  function updateForm<K extends keyof PurchaseOrderFormState>(field: K, value: PurchaseOrderFormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addCustomLine() {
    updateForm("lineItems", [...form.lineItems, createEmptyPurchaseOrderLineItem()]);
  }

  function addCatalogMaterial() {
    const material = materials.find((entry) => entry.id === selectedCatalogMaterialId);
    if (!material) {
      setError("Select a material first.");
      return;
    }

    updateForm("lineItems", [
      ...form.lineItems,
      applyLineTotal({
        ...createEmptyPurchaseOrderLineItem(),
        materialId: material.id,
        name: material.name,
        quantity: "1",
        unit: material.unit,
        unitCost: material.baseCost.toFixed(2),
      }),
    ]);
    setSelectedCatalogMaterialId("");
    setError(null);
  }

  function updateLineItem(index: number, patch: Partial<PurchaseOrderLineItemRow>) {
    updateForm(
      "lineItems",
      form.lineItems.map((lineItem, lineIndex) =>
        lineIndex === index
          ? applyLineTotal({
              ...lineItem,
              ...patch,
            })
          : lineItem,
      ),
    );
  }

  function removeLineItem(index: number) {
    updateForm(
      "lineItems",
      form.lineItems.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  async function savePurchaseOrder() {
    if (!canManage) {
      setError("Read-only users cannot save purchase orders.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const body = {
        ...(internalUser && !selectedPurchaseOrderId ? { orgId } : {}),
        jobId: form.jobId || null,
        vendorName: form.vendorName,
        vendorEmail: form.vendorEmail,
        vendorPhone: form.vendorPhone,
        vendorAddress: form.vendorAddress,
        title: form.title,
        notes: form.notes,
        taxRatePercent: form.taxRatePercent,
        status: form.status,
        lineItems: form.lineItems.map((item) => ({
          materialId: item.materialId,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.unitCost,
        })),
      };

      const response = await fetch(selectedPurchaseOrderId ? `/api/purchase-orders/${selectedPurchaseOrderId}` : "/api/purchase-orders", {
        method: selectedPurchaseOrderId ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as PurchaseOrderResponse;
      if (!response.ok || !payload?.ok || !payload.purchaseOrder) {
        throw new Error(payload?.error || "Failed to save purchase order.");
      }

      setSelectedPurchaseOrderId(payload.purchaseOrder.id);
      setForm(applyDetailToForm(payload.purchaseOrder));
      setNotice(selectedPurchaseOrderId ? "Purchase order updated." : "Purchase order created.");
      setRefreshToken((current) => current + 1);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save purchase order.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelSelectedPurchaseOrder() {
    if (!selectedPurchaseOrderId || !canManage) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/purchase-orders/${selectedPurchaseOrderId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to cancel purchase order.");
      }

      setNotice("Purchase order cancelled.");
      resetEditor();
      setRefreshToken((current) => current + 1);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Failed to cancel purchase order.");
    } finally {
      setSaving(false);
    }
  }

  async function prepareEmailDraft() {
    if (!selectedPurchaseOrderId) {
      setError("Save the purchase order before preparing the email.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/purchase-orders/${selectedPurchaseOrderId}/send`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as SendDraftResponse;
      if (!response.ok || !payload?.ok || !payload.purchaseOrder) {
        throw new Error(payload?.error || "Failed to prepare purchase order email.");
      }

      setForm(applyDetailToForm(payload.purchaseOrder));

      if (payload.delivery === "outlook") {
        setNotice(payload.message || "Purchase order sent through Outlook.");
      } else if (payload.mailtoUrl) {
        window.location.href = payload.mailtoUrl;
        setNotice(payload.message || "Email draft opened in your mail app. Update the PO status to Sent once you deliver it.");
      } else {
        setNotice(payload.message || "Email draft prepared, but no vendor email is attached.");
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to prepare purchase order email.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="job-records-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Purchase Orders</h2>
            <p className="muted">
              Create supplier orders for {orgName}, tie them to jobs, and send from Outlook when connected. Without
              Outlook, the portal falls back to a vendor email draft.
            </p>
          </div>
          <div className="portal-empty-actions">
            <button className="btn secondary" type="button" onClick={beginCreate}>
              New PO
            </button>
          </div>
        </div>

        <div className="grid three-col" style={{ marginTop: 16 }}>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">Total POs</p>
            <h3 style={{ marginTop: 6 }}>{summary.totalCount}</h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">Draft / Sent</p>
            <h3 style={{ marginTop: 6 }}>
              {summary.draftCount} / {summary.sentCount}
            </h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">Open Commitments</p>
            <h3 style={{ marginTop: 6 }}>{formatCurrency(summary.totalOpen)}</h3>
          </article>
        </div>

        {notice ? <p className="form-status" style={{ marginTop: 12 }}>{notice}</p> : null}
        {error ? <p className="form-status" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>

      <div className="job-records-grid">
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>PO Folder</h3>
              <p className="muted">Search by PO number, vendor, or title. Filter by job or status.</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="PO number, vendor, title"
              />
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
                <option value="">All</option>
                {purchaseOrderStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Job
              <select value={jobFilter} onChange={(event) => setJobFilter(event.currentTarget.value)}>
                <option value="">All jobs</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.customerName} • {job.projectType}
                  </option>
                ))}
              </select>
            </label>
          </form>

          <div className="table-shell" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {loadingList ? (
                  <tr>
                    <td colSpan={5}>Loading purchase orders…</td>
                  </tr>
                ) : purchaseOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No purchase orders yet.</td>
                  </tr>
                ) : (
                  purchaseOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedPurchaseOrderId(order.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <strong>{order.poNumber}</strong>
                        <div className="muted">{order.title}</div>
                      </td>
                      <td>{order.vendorName}</td>
                      <td>{order.job ? `${order.job.customerName} • ${order.job.projectType}` : "-"}</td>
                      <td>{order.status.replace(/_/g, " ")}</td>
                      <td>{formatCurrency(order.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>{selectedPurchaseOrderId ? "Edit Purchase Order" : "New Purchase Order"}</h3>
              <p className="muted">
                Save the PO first, then send from Outlook or prepare a mail draft if Outlook is not connected for this
                org.
              </p>
            </div>
          </div>

          {loadingDetail || loadingReferences ? <p className="form-status">Loading…</p> : null}

          <div className="auth-form" style={{ marginTop: 12 }}>
            <div className="grid two-col">
              <label>
                Job
                <select value={form.jobId} onChange={(event) => updateForm("jobId", event.currentTarget.value)} disabled={!canManage}>
                  <option value="">Standalone PO</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.customerName} • {job.projectType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(event) =>
                    updateForm(
                      "status",
                      event.currentTarget.value as (typeof purchaseOrderStatusOptions)[number],
                    )
                  }
                  disabled={!canManage}
                >
                  {purchaseOrderStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Vendor name
                <input value={form.vendorName} onChange={(event) => updateForm("vendorName", event.currentTarget.value)} disabled={!canManage} />
              </label>
              <label>
                PO title
                <input value={form.title} onChange={(event) => updateForm("title", event.currentTarget.value)} disabled={!canManage} />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Vendor email
                <input value={form.vendorEmail} onChange={(event) => updateForm("vendorEmail", event.currentTarget.value)} disabled={!canManage} />
              </label>
              <label>
                Vendor phone
                <input value={form.vendorPhone} onChange={(event) => updateForm("vendorPhone", event.currentTarget.value)} disabled={!canManage} />
              </label>
            </div>

            <label>
              Vendor address
              <textarea
                rows={2}
                value={form.vendorAddress}
                onChange={(event) => updateForm("vendorAddress", event.currentTarget.value)}
                disabled={!canManage}
              />
            </label>

            <label>
              Notes
              <textarea rows={3} value={form.notes} onChange={(event) => updateForm("notes", event.currentTarget.value)} disabled={!canManage} />
            </label>

            <div className="grid two-col">
              <label>
                Tax rate %
                <input
                  inputMode="decimal"
                  value={form.taxRatePercent}
                  onChange={(event) => updateForm("taxRatePercent", event.currentTarget.value)}
                  disabled={!canManage}
                />
              </label>
              <div className="stack-cell" style={{ justifyContent: "flex-end" }}>
                <p className="mini-label">Current totals</p>
                <p className="muted">
                  Subtotal {formatCurrency(totals.subtotal)} • Tax {formatCurrency(totals.taxAmount)} • Total{" "}
                  {formatCurrency(totals.total)}
                </p>
              </div>
            </div>
          </div>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>Line Items</h3>
                <p className="muted">Build the PO from catalog materials or add custom supplier items.</p>
              </div>
              <div className="portal-empty-actions">
                <select
                  value={selectedCatalogMaterialId}
                  onChange={(event) => setSelectedCatalogMaterialId(event.currentTarget.value)}
                  disabled={!canManage}
                >
                  <option value="">Add catalog material</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} • {material.category}
                    </option>
                  ))}
                </select>
                <button className="btn secondary" type="button" onClick={addCatalogMaterial} disabled={!canManage}>
                  Add Catalog Item
                </button>
                <button className="btn secondary" type="button" onClick={addCustomLine} disabled={!canManage}>
                  Add Custom Line
                </button>
              </div>
            </div>

            <div className="table-shell" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Unit Cost</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {form.lineItems.map((item, index) => (
                    <tr key={item.id}>
                      <td style={{ minWidth: 220 }}>
                        <input
                          value={item.name}
                          onChange={(event) => updateLineItem(index, { name: event.currentTarget.value })}
                          placeholder="Drain rock / block / freight"
                          disabled={!canManage}
                        />
                        <textarea
                          rows={2}
                          value={item.description}
                          onChange={(event) => updateLineItem(index, { description: event.currentTarget.value })}
                          placeholder="Optional spec or vendor note"
                          disabled={!canManage}
                          style={{ marginTop: 8 }}
                        />
                      </td>
                      <td>
                        <input
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={(event) => updateLineItem(index, { quantity: event.currentTarget.value })}
                          disabled={!canManage}
                        />
                      </td>
                      <td>
                        <input
                          value={item.unit}
                          onChange={(event) => updateLineItem(index, { unit: event.currentTarget.value })}
                          disabled={!canManage}
                        />
                      </td>
                      <td>
                        <input
                          inputMode="decimal"
                          value={item.unitCost}
                          onChange={(event) => updateLineItem(index, { unitCost: event.currentTarget.value })}
                          disabled={!canManage}
                        />
                      </td>
                      <td>{formatCurrency(item.total)}</td>
                      <td>
                        <button className="btn secondary" type="button" onClick={() => removeLineItem(index)} disabled={!canManage}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="portal-empty-actions" style={{ marginTop: 16 }}>
            <button className="btn primary" type="button" onClick={() => void savePurchaseOrder()} disabled={saving || !canManage}>
              {saving ? "Saving..." : selectedPurchaseOrderId ? "Save PO" : "Create PO"}
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => void prepareEmailDraft()}
              disabled={saving || !selectedPurchaseOrderId}
            >
              Send / Draft Email
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => void cancelSelectedPurchaseOrder()}
              disabled={saving || !selectedPurchaseOrderId || !canManage}
            >
              Cancel PO
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
