"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  calculateMaterialSellPrice,
  materialUnitSuggestions,
  type MaterialListItem,
} from "@/lib/materials";

type MaterialsManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
};

type MaterialsResponse =
  | {
      ok?: boolean;
      materials?: MaterialListItem[];
      categories?: string[];
      error?: string;
    }
  | null;

type MaterialMutationResponse =
  | {
      ok?: boolean;
      material?: MaterialListItem;
      error?: string;
    }
  | null;

type MaterialFormState = {
  name: string;
  category: string;
  unit: string;
  baseCost: string;
  markupPercent: string;
  sellPrice: string;
  notes: string;
  active: boolean;
};

const defaultFormState: MaterialFormState = {
  name: "",
  category: "",
  unit: "each",
  baseCost: "",
  markupPercent: "35",
  sellPrice: "",
  notes: "",
  active: true,
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toInputNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function categoryBadgeClass(category: string): string {
  const normalized = category.trim().toLowerCase();
  if (normalized.includes("concrete") || normalized.includes("stone")) return "status-partial";
  if (normalized.includes("mulch") || normalized.includes("soil")) return "status-organic";
  if (normalized.includes("paver") || normalized.includes("hardscape")) return "status-paid";
  return "status-unknown";
}

export default function MaterialsManager({
  orgId,
  orgName,
  internalUser,
  canManage,
}: MaterialsManagerProps) {
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialFormState>(defaultFormState);
  const [sellPriceDirty, setSellPriceDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const totalCount = materials.length;
  const activeCount = materials.filter((material) => material.active).length;
  const inactiveCount = totalCount - activeCount;

  const categorySummary = useMemo(() => {
    return materials.reduce<Record<string, number>>((acc, material) => {
      acc[material.category] = (acc[material.category] || 0) + 1;
      return acc;
    }, {});
  }, [materials]);

  function buildQuery() {
    const params = new URLSearchParams();
    if (internalUser) {
      params.set("orgId", orgId);
    }
    if (deferredSearch.trim()) {
      params.set("q", deferredSearch.trim());
    }
    if (categoryFilter) {
      params.set("category", categoryFilter);
    }
    if (activeFilter !== "all") {
      params.set("active", activeFilter);
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/materials${buildQuery()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as MaterialsResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.materials) || !Array.isArray(payload.categories)) {
          throw new Error(payload?.error || "Failed to load materials.");
        }

        if (cancelled) return;
        setMaterials(payload.materials);
        setCategories(payload.categories);
      } catch (err) {
        if (cancelled) return;
        setMaterials([]);
        setCategories([]);
        setError(err instanceof Error ? err.message : "Failed to load materials.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMaterials();
    return () => {
      cancelled = true;
    };
  }, [orgId, internalUser, deferredSearch, categoryFilter, activeFilter, refreshToken]);

  function resetEditor() {
    setEditingId(null);
    setForm(defaultFormState);
    setSellPriceDirty(false);
  }

  function applySellPriceDraft(nextState: MaterialFormState) {
    const baseCost = Number.parseFloat(nextState.baseCost || "0");
    const markupPercent = Number.parseFloat(nextState.markupPercent || "0");
    if (!Number.isFinite(baseCost) || !Number.isFinite(markupPercent)) {
      return nextState;
    }
    return {
      ...nextState,
      sellPrice: toInputNumber(calculateMaterialSellPrice(baseCost, markupPercent)),
    };
  }

  function updateForm<K extends keyof MaterialFormState>(field: K, value: MaterialFormState[K]) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if ((field === "baseCost" || field === "markupPercent") && !sellPriceDirty) {
        return applySellPriceDraft(next);
      }
      return next;
    });
  }

  function beginCreate() {
    resetEditor();
    setNotice(null);
    setError(null);
  }

  function beginEdit(material: MaterialListItem) {
    setEditingId(material.id);
    setForm({
      name: material.name,
      category: material.category,
      unit: material.unit,
      baseCost: toInputNumber(material.baseCost),
      markupPercent: toInputNumber(material.markupPercent),
      sellPrice: toInputNumber(material.sellPrice),
      notes: material.notes || "",
      active: material.active,
    });
    setSellPriceDirty(false);
    setNotice(null);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const body = {
        ...(internalUser ? { orgId } : {}),
        ...form,
      };

      const response = await fetch(editingId ? `/api/materials/${editingId}` : "/api/materials", {
        method: editingId ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as MaterialMutationResponse;
      if (!response.ok || !payload?.ok || !payload.material) {
        throw new Error(payload?.error || "Failed to save material.");
      }

      setNotice(editingId ? "Material updated." : "Material added.");
      resetEditor();
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save material.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(material: MaterialListItem) {
    setRowBusyId(material.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/materials/${material.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          active: !material.active,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MaterialMutationResponse;
      if (!response.ok || !payload?.ok || !payload.material) {
        throw new Error(payload?.error || "Failed to update active status.");
      }

      setNotice(`${payload.material.name} is now ${payload.material.active ? "active" : "inactive"}.`);
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update material.");
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleDelete(material: MaterialListItem) {
    const confirmed = window.confirm(`Delete ${material.name}? This cannot be undone.`);
    if (!confirmed) return;

    setRowBusyId(material.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/materials/${material.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to delete material.");
      }

      if (editingId === material.id) {
        resetEditor();
      }
      setNotice(`${material.name} deleted.`);
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete material.");
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <>
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Materials</h2>
            <p className="muted">
              Build a clean cost catalog for {orgName} so estimating stays consistent across crews and jobs.
            </p>
          </div>
          {canManage ? (
            <button className="btn primary" type="button" onClick={beginCreate}>
              Add Material
            </button>
          ) : null}
        </div>

        <div className="quick-meta" style={{ marginTop: 12 }}>
          <span className="badge">Total: {totalCount}</span>
          <span className="badge status-paid">Active: {activeCount}</span>
          <span className="badge status-draft">Inactive: {inactiveCount}</span>
          <span className="badge">Categories: {categories.length}</span>
        </div>

        <form className="filters" style={{ marginTop: 12 }}>
          <label>
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search by name, category, unit, or note"
            />
          </label>

          <label>
            Category
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)}>
              <option value="">All</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.currentTarget.value)}>
              <option value="all">All</option>
              <option value="true">Active only</option>
              <option value="false">Inactive only</option>
            </select>
          </label>

          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setSearch("");
              setCategoryFilter("");
              setActiveFilter("all");
            }}
          >
            Reset
          </button>
        </form>

        {categories.length > 0 ? (
          <div className="quick-meta" style={{ marginTop: 12 }}>
            {Object.entries(categorySummary)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([category, count]) => (
                <span key={category} className={`badge ${categoryBadgeClass(category)}`}>
                  {category}: {count}
                </span>
              ))}
          </div>
        ) : null}

        {!canManage ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            Workers can view the catalog, but only owners and admins can add or change materials.
          </p>
        ) : null}
        {notice ? <p className="form-status">{notice}</p> : null}
        {error ? <p className="form-status">{error}</p> : null}
      </section>

      {canManage ? (
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h2>{editingId ? "Edit Material" : "Add Material"}</h2>
              <p className="muted">Store base cost, markup, and sell price in one place for faster estimate building.</p>
            </div>
            {editingId ? (
              <button className="btn secondary" type="button" onClick={resetEditor}>
                Cancel
              </button>
            ) : null}
          </div>

          <form className="auth-form" style={{ marginTop: 12 }} onSubmit={handleSubmit}>
            <div className="grid two-col">
              <label>
                Material name
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.currentTarget.value)}
                  placeholder="3/4 Clean Crushed Rock"
                  required
                />
              </label>

              <label>
                Category
                <input
                  list="materials-category-list"
                  value={form.category}
                  onChange={(event) => updateForm("category", event.currentTarget.value)}
                  placeholder="Aggregate"
                  required
                />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Unit
                <input
                  list="materials-unit-list"
                  value={form.unit}
                  onChange={(event) => updateForm("unit", event.currentTarget.value)}
                  placeholder="yard"
                  required
                />
              </label>

              <label>
                Active
                <select
                  value={form.active ? "true" : "false"}
                  onChange={(event) => updateForm("active", event.currentTarget.value === "true")}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Base cost
                <input
                  inputMode="decimal"
                  value={form.baseCost}
                  onChange={(event) => updateForm("baseCost", event.currentTarget.value)}
                  placeholder="0.00"
                  required
                />
              </label>

              <label>
                Markup %
                <input
                  inputMode="decimal"
                  value={form.markupPercent}
                  onChange={(event) => updateForm("markupPercent", event.currentTarget.value)}
                  placeholder="35"
                  required
                />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Sell price
                <input
                  inputMode="decimal"
                  value={form.sellPrice}
                  onChange={(event) => {
                    setSellPriceDirty(true);
                    updateForm("sellPrice", event.currentTarget.value);
                  }}
                  placeholder="0.00"
                  required
                />
              </label>

              <label>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.currentTarget.value)}
                  placeholder="Preferred vendor, coverage assumptions, or install note"
                  rows={3}
                />
              </label>
            </div>

            <div className="quick-meta">
              <span className="badge">Auto price: {formatMoney(calculateMaterialSellPrice(Number.parseFloat(form.baseCost || "0") || 0, Number.parseFloat(form.markupPercent || "0") || 0))}</span>
              {sellPriceDirty ? <span className="badge status-draft">Sell price overridden</span> : null}
            </div>

            <div className="portal-empty-actions">
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Save Material" : "Add Material"}
              </button>
              <button className="btn secondary" type="button" onClick={resetEditor} disabled={saving}>
                Clear
              </button>
            </div>
          </form>

          <datalist id="materials-category-list">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <datalist id="materials-unit-list">
            {materialUnitSuggestions.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </section>
      ) : null}

      <section className="card">
        {loading ? (
          <div className="portal-empty-state">
            <strong>Loading materials...</strong>
            <p className="muted">Pulling the latest catalog for this workspace.</p>
          </div>
        ) : materials.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No materials yet.</strong>
            <p className="muted">
              Start by adding the most common items your estimators quote every week.
            </p>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {materials.map((material) => (
                <li key={material.id} className="mobile-list-card">
                  <div className="stack-cell">
                    <strong>{material.name}</strong>
                    <span className="muted">
                      {material.category} • {material.unit}
                    </span>
                  </div>
                  <div className="quick-meta">
                    <span className={`badge ${categoryBadgeClass(material.category)}`}>{material.category}</span>
                    <span className={`badge ${material.active ? "status-paid" : "status-draft"}`}>
                      {material.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="stack-cell">
                    <span className="muted">Base: {formatMoney(material.baseCost)}</span>
                    <span className="muted">Markup: {material.markupPercent.toFixed(2)}%</span>
                    <span className="muted">Sell: {formatMoney(material.sellPrice)}</span>
                    {material.notes ? <span className="muted">{material.notes}</span> : null}
                  </div>
                  {canManage ? (
                    <div className="mobile-list-card-actions">
                      <button className="btn secondary" type="button" onClick={() => beginEdit(material)} disabled={rowBusyId === material.id}>
                        Edit
                      </button>
                      <button className="btn secondary" type="button" onClick={() => void handleToggle(material)} disabled={rowBusyId === material.id}>
                        {material.active ? "Deactivate" : "Activate"}
                      </button>
                      <button className="btn secondary" type="button" onClick={() => void handleDelete(material)} disabled={rowBusyId === material.id}>
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="table-wrap desktop-table-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Base Cost</th>
                    <th>Markup</th>
                    <th>Sell Price</th>
                    <th>Status</th>
                    <th>Notes</th>
                    {canManage ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material) => (
                    <tr key={material.id}>
                      <td>{material.name}</td>
                      <td>
                        <span className={`badge ${categoryBadgeClass(material.category)}`}>{material.category}</span>
                      </td>
                      <td>{material.unit}</td>
                      <td>{formatMoney(material.baseCost)}</td>
                      <td>{material.markupPercent.toFixed(2)}%</td>
                      <td>{formatMoney(material.sellPrice)}</td>
                      <td>
                        <span className={`badge ${material.active ? "status-paid" : "status-draft"}`}>
                          {material.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>{material.notes || "-"}</td>
                      {canManage ? (
                        <td>
                          <div className="quick-actions">
                            <button className="btn secondary" type="button" onClick={() => beginEdit(material)} disabled={rowBusyId === material.id}>
                              Edit
                            </button>
                            <button className="btn secondary" type="button" onClick={() => void handleToggle(material)} disabled={rowBusyId === material.id}>
                              {material.active ? "Deactivate" : "Activate"}
                            </button>
                            <button className="btn secondary" type="button" onClick={() => void handleDelete(material)} disabled={rowBusyId === material.id}>
                              Delete
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
