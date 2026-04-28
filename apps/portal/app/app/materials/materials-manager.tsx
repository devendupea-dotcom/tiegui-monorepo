"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
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

function formatMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
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

function getMaterialsManagerCopy(locale: string) {
  const isSpanish = locale.startsWith("es");
  if (isSpanish) {
    return {
      errors: {
        load: "No se pudieron cargar los materiales.",
        save: "No se pudo guardar el material.",
        updateActive: "No se pudo actualizar el estado activo.",
        update: "No se pudo actualizar el material.",
        delete: "No se pudo eliminar el material.",
      },
      notices: {
        updated: "Material actualizado.",
        added: "Material agregado.",
        statusChanged: (name: string, active: boolean) => `${name} ahora está ${active ? "activo" : "inactivo"}.`,
        deleted: (name: string) => `${name} eliminado.`,
      },
      confirmDelete: (name: string) => `¿Eliminar ${name}? Esta acción no se puede deshacer.`,
      title: "Materiales",
      subtitle: (orgName: string) =>
        `Crea un catálogo limpio de costos para ${orgName} y mantén consistencia en estimados, cuadrillas y trabajos.`,
      addMaterial: "Agregar material",
      summary: {
        total: "Total",
        active: "Activos",
        inactive: "Inactivos",
        categories: "Categorías",
      },
      filters: {
        search: "Buscar",
        searchPlaceholder: "Buscar por nombre, categoría, unidad o nota",
        category: "Categoría",
        status: "Estado",
        all: "Todos",
        activeOnly: "Solo activos",
        inactiveOnly: "Solo inactivos",
        reset: "Restablecer",
      },
      readOnly: "Los trabajadores pueden ver el catálogo, pero solo owners y admins pueden agregar o cambiar materiales.",
      editor: {
        editTitle: "Editar material",
        addTitle: "Agregar material",
        subtitle: "Guarda costo base, markup y precio de venta en un solo lugar para cotizar más rápido.",
        cancel: "Cancelar",
        materialName: "Nombre del material",
        materialNamePlaceholder: "Grava triturada limpia 3/4",
        category: "Categoría",
        categoryPlaceholder: "Agregado",
        unit: "Unidad",
        unitPlaceholder: "yarda",
        active: "Activo",
        activeStatus: "Activo",
        inactiveStatus: "Inactivo",
        baseCost: "Costo base",
        markup: "Markup %",
        sellPrice: "Precio de venta",
        notes: "Notas",
        notesPlaceholder: "Proveedor preferido, cobertura o nota de instalación",
        autoPrice: "Precio automático",
        overridden: "Precio de venta ajustado manualmente",
        saving: "Guardando...",
        save: "Guardar material",
        add: "Agregar material",
        clear: "Limpiar",
      },
      states: {
        loadingTitle: "Cargando materiales...",
        loadingBody: "Obteniendo el catálogo más reciente de este espacio.",
        emptyTitle: "Aún no hay materiales.",
        emptyBody: "Empieza agregando los artículos que tu equipo cotiza cada semana.",
      },
      labels: {
        base: "Base",
        markup: "Markup",
        sell: "Venta",
        edit: "Editar",
        deactivate: "Desactivar",
        activate: "Activar",
        delete: "Eliminar",
        name: "Nombre",
        unit: "Unidad",
        baseCost: "Costo base",
        sellPrice: "Precio de venta",
        actions: "Acciones",
      },
      status: {
        active: "Activo",
        inactive: "Inactivo",
      },
      emptyValue: "-",
    };
  }

  return {
    errors: {
      load: "Failed to load materials.",
      save: "Failed to save material.",
      updateActive: "Failed to update active status.",
      update: "Failed to update material.",
      delete: "Failed to delete material.",
    },
    notices: {
      updated: "Material updated.",
      added: "Material added.",
      statusChanged: (name: string, active: boolean) => `${name} is now ${active ? "active" : "inactive"}.`,
      deleted: (name: string) => `${name} deleted.`,
    },
    confirmDelete: (name: string) => `Delete ${name}? This cannot be undone.`,
    title: "Materials",
    subtitle: (orgName: string) =>
      `Build a clean cost catalog for ${orgName} so estimating stays consistent across crews and jobs.`,
    addMaterial: "Add Material",
    summary: {
      total: "Total",
      active: "Active",
      inactive: "Inactive",
      categories: "Categories",
    },
    filters: {
      search: "Search",
      searchPlaceholder: "Search by name, category, unit, or note",
      category: "Category",
      status: "Status",
      all: "All",
      activeOnly: "Active only",
      inactiveOnly: "Inactive only",
      reset: "Reset",
    },
    readOnly: "Workers can view the catalog, but only owners and admins can add or change materials.",
    editor: {
      editTitle: "Edit Material",
      addTitle: "Add Material",
      subtitle: "Store base cost, markup, and sell price in one place for faster estimate building.",
      cancel: "Cancel",
      materialName: "Material name",
      materialNamePlaceholder: "3/4 Clean Crushed Rock",
      category: "Category",
      categoryPlaceholder: "Aggregate",
      unit: "Unit",
      unitPlaceholder: "yard",
      active: "Active",
      activeStatus: "Active",
      inactiveStatus: "Inactive",
      baseCost: "Base cost",
      markup: "Markup %",
      sellPrice: "Sell price",
      notes: "Notes",
      notesPlaceholder: "Preferred vendor, coverage assumptions, or install note",
      autoPrice: "Auto price",
      overridden: "Sell price overridden",
      saving: "Saving...",
      save: "Save Material",
      add: "Add Material",
      clear: "Clear",
    },
    states: {
      loadingTitle: "Loading materials...",
      loadingBody: "Pulling the latest catalog for this workspace.",
      emptyTitle: "No materials yet.",
      emptyBody: "Start by adding the most common items your estimators quote every week.",
    },
    labels: {
      base: "Base",
      markup: "Markup",
      sell: "Sell",
      edit: "Edit",
      deactivate: "Deactivate",
      activate: "Activate",
      delete: "Delete",
      name: "Name",
      unit: "Unit",
      baseCost: "Base Cost",
      sellPrice: "Sell Price",
      actions: "Actions",
    },
    status: {
      active: "Active",
      inactive: "Inactive",
    },
    emptyValue: "-",
  };
}

export default function MaterialsManager({
  orgId,
  orgName,
  internalUser,
  canManage,
}: MaterialsManagerProps) {
  const locale = useLocale();
  const displayLocale = locale.startsWith("es") ? "es-US" : "en-US";
  const copy = useMemo(() => getMaterialsManagerCopy(locale), [locale]);
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

  const buildQuery = useCallback(() => {
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
  }, [activeFilter, categoryFilter, deferredSearch, internalUser, orgId]);

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
          throw new Error(payload?.error || copy.errors.load);
        }

        if (cancelled) return;
        setMaterials(payload.materials);
        setCategories(payload.categories);
      } catch (err) {
        if (cancelled) return;
        setMaterials([]);
        setCategories([]);
        setError(err instanceof Error ? err.message : copy.errors.load);
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
  }, [buildQuery, copy.errors.load, refreshToken]);

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
        throw new Error(payload?.error || copy.errors.save);
      }

      setNotice(editingId ? copy.notices.updated : copy.notices.added);
      resetEditor();
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.save);
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
        throw new Error(payload?.error || copy.errors.updateActive);
      }

      setNotice(copy.notices.statusChanged(payload.material.name, payload.material.active));
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.update);
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleDelete(material: MaterialListItem) {
    const confirmed = window.confirm(copy.confirmDelete(material.name));
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
        throw new Error(payload?.error || copy.errors.delete);
      }

      if (editingId === material.id) {
        resetEditor();
      }
      setNotice(copy.notices.deleted(material.name));
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.delete);
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <>
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>{copy.title}</h2>
            <p className="muted">{copy.subtitle(orgName)}</p>
          </div>
          {canManage ? (
            <button className="btn primary" type="button" onClick={beginCreate}>
              {copy.addMaterial}
            </button>
          ) : null}
        </div>

        <div className="quick-meta" style={{ marginTop: 12 }}>
          <span className="badge">{copy.summary.total}: {totalCount}</span>
          <span className="badge status-paid">{copy.summary.active}: {activeCount}</span>
          <span className="badge status-draft">{copy.summary.inactive}: {inactiveCount}</span>
          <span className="badge">{copy.summary.categories}: {categories.length}</span>
        </div>

        <form className="filters" style={{ marginTop: 12 }}>
          <label>
            {copy.filters.search}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={copy.filters.searchPlaceholder}
            />
          </label>

          <label>
            {copy.filters.category}
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)}>
              <option value="">{copy.filters.all}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            {copy.filters.status}
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.currentTarget.value)}>
              <option value="all">{copy.filters.all}</option>
              <option value="true">{copy.filters.activeOnly}</option>
              <option value="false">{copy.filters.inactiveOnly}</option>
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
            {copy.filters.reset}
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
            {copy.readOnly}
          </p>
        ) : null}
        {notice ? <p className="form-status">{notice}</p> : null}
        {error ? <p className="form-status">{error}</p> : null}
      </section>

      {canManage ? (
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h2>{editingId ? copy.editor.editTitle : copy.editor.addTitle}</h2>
              <p className="muted">{copy.editor.subtitle}</p>
            </div>
            {editingId ? (
              <button className="btn secondary" type="button" onClick={resetEditor}>
                {copy.editor.cancel}
              </button>
            ) : null}
          </div>

          <form className="auth-form" style={{ marginTop: 12 }} onSubmit={handleSubmit}>
            <div className="grid two-col">
              <label>
                {copy.editor.materialName}
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.currentTarget.value)}
                  placeholder={copy.editor.materialNamePlaceholder}
                  required
                />
              </label>

              <label>
                {copy.editor.category}
                <input
                  list="materials-category-list"
                  value={form.category}
                  onChange={(event) => updateForm("category", event.currentTarget.value)}
                  placeholder={copy.editor.categoryPlaceholder}
                  required
                />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                {copy.editor.unit}
                <input
                  list="materials-unit-list"
                  value={form.unit}
                  onChange={(event) => updateForm("unit", event.currentTarget.value)}
                  placeholder={copy.editor.unitPlaceholder}
                  required
                />
              </label>

              <label>
                {copy.editor.active}
                <select
                  value={form.active ? "true" : "false"}
                  onChange={(event) => updateForm("active", event.currentTarget.value === "true")}
                >
                  <option value="true">{copy.editor.activeStatus}</option>
                  <option value="false">{copy.editor.inactiveStatus}</option>
                </select>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                {copy.editor.baseCost}
                <input
                  inputMode="decimal"
                  value={form.baseCost}
                  onChange={(event) => updateForm("baseCost", event.currentTarget.value)}
                  placeholder="0.00"
                  required
                />
              </label>

              <label>
                {copy.editor.markup}
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
                {copy.editor.sellPrice}
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
                {copy.editor.notes}
                <textarea
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.currentTarget.value)}
                  placeholder={copy.editor.notesPlaceholder}
                  rows={3}
                />
              </label>
            </div>

            <div className="quick-meta">
              <span className="badge">
                {copy.editor.autoPrice}:{" "}
                {formatMoney(
                  calculateMaterialSellPrice(
                    Number.parseFloat(form.baseCost || "0") || 0,
                    Number.parseFloat(form.markupPercent || "0") || 0,
                  ),
                  displayLocale,
                )}
              </span>
              {sellPriceDirty ? <span className="badge status-draft">{copy.editor.overridden}</span> : null}
            </div>

            <div className="portal-empty-actions">
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? copy.editor.saving : editingId ? copy.editor.save : copy.editor.add}
              </button>
              <button className="btn secondary" type="button" onClick={resetEditor} disabled={saving}>
                {copy.editor.clear}
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
            <strong>{copy.states.loadingTitle}</strong>
            <p className="muted">{copy.states.loadingBody}</p>
          </div>
        ) : materials.length === 0 ? (
          <div className="portal-empty-state">
            <strong>{copy.states.emptyTitle}</strong>
            <p className="muted">{copy.states.emptyBody}</p>
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
                      {material.active ? copy.status.active : copy.status.inactive}
                    </span>
                  </div>
                  <div className="stack-cell">
                    <span className="muted">{copy.labels.base}: {formatMoney(material.baseCost, displayLocale)}</span>
                    <span className="muted">{copy.labels.markup}: {material.markupPercent.toFixed(2)}%</span>
                    <span className="muted">{copy.labels.sell}: {formatMoney(material.sellPrice, displayLocale)}</span>
                    {material.notes ? <span className="muted">{material.notes}</span> : null}
                  </div>
                  {canManage ? (
                    <div className="mobile-list-card-actions">
                      <button className="btn secondary" type="button" onClick={() => beginEdit(material)} disabled={rowBusyId === material.id}>
                        {copy.labels.edit}
                      </button>
                      <button className="btn secondary" type="button" onClick={() => void handleToggle(material)} disabled={rowBusyId === material.id}>
                        {material.active ? copy.labels.deactivate : copy.labels.activate}
                      </button>
                      <button className="btn secondary" type="button" onClick={() => void handleDelete(material)} disabled={rowBusyId === material.id}>
                        {copy.labels.delete}
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
                    <th>{copy.labels.name}</th>
                    <th>{copy.filters.category}</th>
                    <th>{copy.labels.unit}</th>
                    <th>{copy.labels.baseCost}</th>
                    <th>{copy.labels.markup}</th>
                    <th>{copy.labels.sellPrice}</th>
                    <th>{copy.filters.status}</th>
                    <th>{copy.editor.notes}</th>
                    {canManage ? <th>{copy.labels.actions}</th> : null}
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
                      <td>{formatMoney(material.baseCost, displayLocale)}</td>
                      <td>{material.markupPercent.toFixed(2)}%</td>
                      <td>{formatMoney(material.sellPrice, displayLocale)}</td>
                      <td>
                        <span className={`badge ${material.active ? "status-paid" : "status-draft"}`}>
                          {material.active ? copy.status.active : copy.status.inactive}
                        </span>
                      </td>
                      <td>{material.notes || copy.emptyValue}</td>
                      {canManage ? (
                        <td>
                          <div className="quick-actions">
                            <button className="btn secondary" type="button" onClick={() => beginEdit(material)} disabled={rowBusyId === material.id}>
                              {copy.labels.edit}
                            </button>
                            <button className="btn secondary" type="button" onClick={() => void handleToggle(material)} disabled={rowBusyId === material.id}>
                              {material.active ? copy.labels.deactivate : copy.labels.activate}
                            </button>
                            <button className="btn secondary" type="button" onClick={() => void handleDelete(material)} disabled={rowBusyId === material.id}>
                              {copy.labels.delete}
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
