"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { formatJobReferenceLabel, type JobListItem } from "@/lib/job-records";
import {
  businessExpenseCategorySuggestions,
  formatExpenseAmountInput,
  type BusinessExpenseListItem,
} from "@/lib/business-expenses";
import type { PurchaseOrderListItem } from "@/lib/purchase-orders";

type BusinessExpensesManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialJobId: string | null;
};

type ExpensesResponse = {
  ok?: boolean;
  expenses?: BusinessExpenseListItem[];
  error?: string;
} | null;

type ExpenseResponse = {
  ok?: boolean;
  expense?: BusinessExpenseListItem;
  error?: string;
} | null;

type JobsResponse = {
  ok?: boolean;
  jobs?: JobListItem[];
  error?: string;
} | null;

type PurchaseOrdersResponse = {
  ok?: boolean;
  purchaseOrders?: PurchaseOrderListItem[];
  error?: string;
} | null;

type SignedUrlResponse = {
  ok?: boolean;
  url?: string | null;
  error?: string;
} | null;

type ExpenseFormState = {
  jobId: string;
  purchaseOrderId: string;
  expenseDate: string;
  vendorName: string;
  category: string;
  description: string;
  amount: string;
  notes: string;
};

const defaultFormState: ExpenseFormState = {
  jobId: "",
  purchaseOrderId: "",
  expenseDate: new Date().toISOString().slice(0, 10),
  vendorName: "",
  category: "Materials",
  description: "",
  amount: "0.00",
  notes: "",
};

function formatMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function applyExpenseToForm(
  expense: BusinessExpenseListItem,
): ExpenseFormState {
  return {
    jobId: expense.job?.id || "",
    purchaseOrderId: expense.purchaseOrder?.id || "",
    expenseDate: expense.expenseDate.slice(0, 10),
    vendorName: expense.vendorName || "",
    category: expense.category,
    description: expense.description,
    amount: formatExpenseAmountInput(expense.amount),
    notes: expense.notes || "",
  };
}

function buildScopedQuery(input: {
  internalUser: boolean;
  orgId: string;
  search: string;
  category: string;
  jobId: string;
}): string {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.search.trim()) {
    params.set("q", input.search.trim());
  }
  if (input.category) {
    params.set("category", input.category);
  }
  if (input.jobId) {
    params.set("jobId", input.jobId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function getBusinessExpensesCopy(locale: string) {
  const isSpanish = locale.startsWith("es");
  if (isSpanish) {
    return {
      errors: {
        loadJobs: "No se pudieron cargar los trabajos.",
        loadPurchaseOrders: "No se pudieron cargar las órdenes de compra.",
        loadReferences: "No se pudieron cargar las referencias de gastos.",
        loadExpenses: "No se pudieron cargar los gastos.",
        readOnlySave: "Los usuarios en solo lectura no pueden guardar gastos.",
        save: "No se pudo guardar el gasto.",
        delete: "No se pudo eliminar el gasto.",
        saveBeforeReceipt: "Guarda el gasto antes de adjuntar un recibo.",
        chooseReceipt: "Elige primero una imagen del recibo.",
        uploadReceipt: "No se pudo subir el recibo.",
        removeReceipt: "No se pudo quitar el recibo.",
        noReceipt: "Todavía no hay un recibo adjunto.",
        openReceipt: "No se pudo abrir el recibo.",
      },
      notices: {
        updated: "Gasto actualizado.",
        created: "Gasto creado.",
        deleted: "Gasto eliminado.",
        receiptAttached: "Recibo adjuntado.",
        receiptRemoved: "Recibo eliminado.",
      },
      title: "Libro de gastos",
      subtitle: (orgName: string) =>
        `Registra recibos, proveedores, órdenes de compra y gastos por trabajo para ${orgName}.`,
      operationalJobHint:
        "Usa la página de trabajo operativo para despacho, agenda, seguimiento y comunicación con el cliente.",
      openOperationalJob: "Abrir trabajo operativo",
      newExpense: "Registrar gasto",
      summary: {
        expenseCount: "Gastos",
        receiptsAttached: "Recibos adjuntos",
        trackedSpend: "Gasto registrado",
      },
      lookup: {
        title: "Buscar gastos",
        subtitle:
          "Encuentra costos ligados al trabajo cuando necesites recibos, OC o detalle de costos.",
        search: "Buscar",
        searchPlaceholder: "Proveedor, categoría, descripción",
        category: "Categoría",
        allCategories: "Todas las categorías",
        job: "Trabajo",
        allJobs: "Todos los trabajos",
        table: {
          date: "Fecha",
          description: "Descripción",
          category: "Categoría",
          jobPo: "Trabajo / OC",
          amount: "Monto",
          loading: "Cargando gastos...",
          empty: "Aún no hay gastos.",
          noVendor: "Sin proveedor",
          noJob: "-",
        },
      },
      editor: {
        editTitle: "Editar gasto",
        addTitle: "Registrar gasto",
        subtitle:
          "Adjunta el recibo después de guardar. Actualmente las subidas soportan archivos de imagen.",
        loading: "Cargando...",
        expenseDate: "Fecha del gasto",
        category: "Categoría",
        job: "Trabajo",
        noLinkedJob: "Sin trabajo vinculado",
        purchaseOrder: "Orden de compra",
        noLinkedPo: "Sin OC vinculada",
        vendor: "Proveedor",
        amount: "Monto",
        description: "Descripción",
        notes: "Notas",
        saving: "Guardando...",
        save: "Guardar gasto",
        create: "Crear gasto",
        delete: "Eliminar gasto",
      },
      receipt: {
        title: "Recibo",
        subtitle: "Sube una imagen del recibo después de guardar el gasto.",
        image: "Imagen del recibo",
        uploading: "Subiendo...",
        upload: "Subir recibo",
        open: "Abrir recibo",
        remove: "Quitar recibo",
        attached: "Recibo adjuntado.",
        empty: "Todavía no hay un recibo adjunto.",
      },
    };
  }

  return {
    errors: {
      loadJobs: "Failed to load jobs.",
      loadPurchaseOrders: "Failed to load purchase orders.",
      loadReferences: "Failed to load expense references.",
      loadExpenses: "Failed to load expenses.",
      readOnlySave: "Read-only users cannot save expenses.",
      save: "Failed to save expense.",
      delete: "Failed to delete expense.",
      saveBeforeReceipt: "Save the expense first before attaching a receipt.",
      chooseReceipt: "Choose a receipt image first.",
      uploadReceipt: "Failed to upload receipt.",
      removeReceipt: "Failed to remove receipt.",
      noReceipt: "No receipt attached yet.",
      openReceipt: "Failed to open receipt.",
    },
    notices: {
      updated: "Expense updated.",
      created: "Expense created.",
      deleted: "Expense deleted.",
      receiptAttached: "Receipt attached.",
      receiptRemoved: "Receipt removed.",
    },
    title: "Expense Ledger",
    subtitle: (orgName: string) =>
      `Track receipts, vendors, purchase orders, and job-level expenses for ${orgName}.`,
    operationalJobHint:
      "Use the Operational Job page for dispatch, schedule, tracking, and customer communication.",
    openOperationalJob: "Open Operational Job",
    newExpense: "Log Expense",
    summary: {
      expenseCount: "Expenses",
      receiptsAttached: "Receipts Attached",
      trackedSpend: "Tracked Spend",
    },
    lookup: {
      title: "Find Expenses",
      subtitle:
        "Find job-linked spend when you need receipts, PO linkage, or cost detail.",
      search: "Search",
      searchPlaceholder: "Vendor, category, description",
      category: "Category",
      allCategories: "All categories",
      job: "Job",
      allJobs: "All jobs",
      table: {
        date: "Date",
        description: "Description",
        category: "Category",
        jobPo: "Job / PO",
        amount: "Amount",
        loading: "Loading expenses...",
        empty: "No expenses yet.",
        noVendor: "No vendor listed",
        noJob: "-",
      },
    },
    editor: {
      editTitle: "Edit Expense",
      addTitle: "Log Expense",
      subtitle:
        "Attach the receipt after saving. Receipt uploads currently support image files.",
      loading: "Loading...",
      expenseDate: "Expense date",
      category: "Category",
      job: "Job",
      noLinkedJob: "No linked job",
      purchaseOrder: "Purchase order",
      noLinkedPo: "No linked PO",
      vendor: "Vendor / supplier",
      amount: "Amount",
      description: "Description",
      notes: "Notes",
      saving: "Saving...",
      save: "Save Expense",
      create: "Create Expense",
      delete: "Delete Expense",
    },
    receipt: {
      title: "Receipt",
      subtitle: "Upload a receipt image after the expense is saved.",
      image: "Receipt image",
      uploading: "Uploading...",
      upload: "Upload Receipt",
      open: "Open Receipt",
      remove: "Remove Receipt",
      attached: "Receipt attached.",
      empty: "No receipt attached yet.",
    },
  };
}

export default function BusinessExpensesManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialJobId,
}: BusinessExpensesManagerProps) {
  const locale = useLocale();
  const displayLocale = locale.startsWith("es") ? "es-US" : "en-US";
  const copy = useMemo(() => getBusinessExpensesCopy(locale), [locale]);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [expenses, setExpenses] = useState<BusinessExpenseListItem[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderListItem[]>(
    [],
  );
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(
    null,
  );
  const [selectedExpense, setSelectedExpense] =
    useState<BusinessExpenseListItem | null>(null);
  const [form, setForm] = useState<ExpenseFormState>({
    ...defaultFormState,
    jobId: initialJobId || "",
  });

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [jobFilter, setJobFilter] = useState(initialJobId || "");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const currentOperationalJobId = selectedExpenseId
    ? form.jobId || ""
    : jobFilter || form.jobId || "";
  const selectedOperationalJobHref = currentOperationalJobId
    ? internalUser
      ? `/app/jobs/records/${currentOperationalJobId}?orgId=${orgId}`
      : `/app/jobs/records/${currentOperationalJobId}`
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      setLoadingReferences(true);
      try {
        const params = new URLSearchParams();
        if (internalUser) {
          params.set("orgId", orgId);
        }

        const [jobsResponse, purchaseOrdersResponse] = await Promise.all([
          fetch(`/api/jobs?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/purchase-orders?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const jobsPayload = (await jobsResponse
          .json()
          .catch(() => null)) as JobsResponse;
        const purchaseOrdersPayload = (await purchaseOrdersResponse
          .json()
          .catch(() => null)) as PurchaseOrdersResponse;

        if (
          !jobsResponse.ok ||
          !jobsPayload?.ok ||
          !Array.isArray(jobsPayload.jobs)
        ) {
          throw new Error(jobsPayload?.error || copy.errors.loadJobs);
        }
        if (
          !purchaseOrdersResponse.ok ||
          !purchaseOrdersPayload?.ok ||
          !Array.isArray(purchaseOrdersPayload.purchaseOrders)
        ) {
          throw new Error(
            purchaseOrdersPayload?.error || copy.errors.loadPurchaseOrders,
          );
        }

        if (cancelled) return;
        setJobs(jobsPayload.jobs);
        setPurchaseOrders(
          purchaseOrdersPayload.purchaseOrders.filter(
            (purchaseOrder) => purchaseOrder.status !== "CANCELLED",
          ),
        );
      } catch (loadError) {
        if (cancelled) return;
        setJobs([]);
        setPurchaseOrders([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.errors.loadReferences,
        );
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
  }, [
    copy.errors.loadJobs,
    copy.errors.loadPurchaseOrders,
    copy.errors.loadReferences,
    internalUser,
    orgId,
    refreshToken,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadExpenses() {
      setLoadingList(true);

      try {
        const response = await fetch(
          `/api/business-expenses${buildScopedQuery({
            internalUser,
            orgId,
            search: deferredSearch,
            category: categoryFilter,
            jobId: jobFilter,
          })}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response
          .json()
          .catch(() => null)) as ExpensesResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.expenses)) {
          throw new Error(payload?.error || copy.errors.loadExpenses);
        }

        if (cancelled) return;
        setExpenses(payload.expenses);
      } catch (loadError) {
        if (cancelled) return;
        setExpenses([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.errors.loadExpenses,
        );
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    }

    void loadExpenses();
    return () => {
      cancelled = true;
    };
  }, [
    categoryFilter,
    copy.errors.loadExpenses,
    deferredSearch,
    internalUser,
    jobFilter,
    orgId,
    refreshToken,
  ]);

  const categories = useMemo(() => {
    const dynamic = Array.from(
      new Set(expenses.map((expense) => expense.category)),
    ).sort((a, b) => a.localeCompare(b));
    return Array.from(
      new Set([...businessExpenseCategorySuggestions, ...dynamic]),
    );
  }, [expenses]);
  const purchaseOrderOptions = useMemo(() => {
    const currentCancelledPurchaseOrder =
      selectedExpense?.purchaseOrder &&
      selectedExpense.purchaseOrder.status === "CANCELLED" &&
      selectedExpense.purchaseOrder.id === form.purchaseOrderId
        ? selectedExpense.purchaseOrder
        : null;

    if (
      currentCancelledPurchaseOrder &&
      !purchaseOrders.some(
        (purchaseOrder) =>
          purchaseOrder.id === currentCancelledPurchaseOrder.id,
      )
    ) {
      return [currentCancelledPurchaseOrder, ...purchaseOrders];
    }

    return purchaseOrders;
  }, [form.purchaseOrderId, purchaseOrders, selectedExpense?.purchaseOrder]);

  const summary = useMemo(() => {
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const withReceipts = expenses.filter(
      (expense) => expense.receiptPhotoId,
    ).length;
    return {
      totalCount: expenses.length,
      total,
      withReceipts,
    };
  }, [expenses]);

  function resetEditor(nextJobId = jobFilter || initialJobId || "") {
    setSelectedExpenseId(null);
    setSelectedExpense(null);
    setForm({
      ...defaultFormState,
      jobId: nextJobId,
    });
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }

  function beginCreate() {
    resetEditor();
    setNotice(null);
    setError(null);
  }

  function updateForm<K extends keyof ExpenseFormState>(
    field: K,
    value: ExpenseFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveExpense() {
    if (!canManage) {
      setError(copy.errors.readOnlySave);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const body = {
        ...(internalUser && !selectedExpenseId ? { orgId } : {}),
        jobId: form.jobId || null,
        purchaseOrderId: form.purchaseOrderId || null,
        expenseDate: form.expenseDate,
        vendorName: form.vendorName,
        category: form.category,
        description: form.description,
        amount: form.amount,
        notes: form.notes,
      };

      const response = await fetch(
        selectedExpenseId
          ? `/api/business-expenses/${selectedExpenseId}`
          : "/api/business-expenses",
        {
          method: selectedExpenseId ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as ExpenseResponse;
      if (!response.ok || !payload?.ok || !payload.expense) {
        throw new Error(payload?.error || copy.errors.save);
      }

      setSelectedExpenseId(payload.expense.id);
      setSelectedExpense(payload.expense);
      setForm(applyExpenseToForm(payload.expense));
      setNotice(
        selectedExpenseId ? copy.notices.updated : copy.notices.created,
      );
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : copy.errors.save,
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedExpense() {
    if (!selectedExpenseId || !canManage) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/business-expenses/${selectedExpenseId}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.errors.delete);
      }

      setNotice(copy.notices.deleted);
      resetEditor();
      setRefreshToken((current) => current + 1);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : copy.errors.delete,
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadReceipt() {
    if (!selectedExpenseId) {
      setError(copy.errors.saveBeforeReceipt);
      return;
    }

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(copy.errors.chooseReceipt);
      return;
    }

    setUploadingReceipt(true);
    setError(null);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.set("receipt", file);

      const response = await fetch(
        `/api/business-expenses/${selectedExpenseId}/receipt`,
        {
          method: "POST",
          body: formData,
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as ExpenseResponse;
      if (!response.ok || !payload?.ok || !payload.expense) {
        throw new Error(payload?.error || copy.errors.uploadReceipt);
      }

      setSelectedExpense(payload.expense);
      setNotice(copy.notices.receiptAttached);
      setRefreshToken((current) => current + 1);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : copy.errors.uploadReceipt,
      );
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function removeReceipt() {
    if (!selectedExpenseId) return;

    setUploadingReceipt(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/business-expenses/${selectedExpenseId}/receipt`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ clear: true }),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as ExpenseResponse;
      if (!response.ok || !payload?.ok || !payload.expense) {
        throw new Error(payload?.error || copy.errors.removeReceipt);
      }

      setSelectedExpense(payload.expense);
      setNotice(copy.notices.receiptRemoved);
      setRefreshToken((current) => current + 1);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : copy.errors.removeReceipt,
      );
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function openReceipt() {
    if (!selectedExpense?.receiptPhotoId) {
      setError(copy.errors.noReceipt);
      return;
    }

    try {
      const response = await fetch(
        `/api/photos/${selectedExpense.receiptPhotoId}/signed-url`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as SignedUrlResponse;
      if (!response.ok || !payload?.ok || !payload.url) {
        throw new Error(payload?.error || copy.errors.openReceipt);
      }

      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (receiptError) {
      setError(
        receiptError instanceof Error
          ? receiptError.message
          : copy.errors.openReceipt,
      );
    }
  }

  return (
    <div className="job-records-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>{copy.title}</h2>
            <p className="muted">{copy.subtitle(orgName)}</p>
            <p className="muted">{copy.operationalJobHint}</p>
          </div>
          <div className="portal-empty-actions">
            {selectedOperationalJobHref ? (
              <button
                className="btn primary"
                type="button"
                onClick={() => router.push(selectedOperationalJobHref)}
              >
                {copy.openOperationalJob}
              </button>
            ) : null}
            <button
              className={
                selectedOperationalJobHref ? "btn secondary" : "btn primary"
              }
              type="button"
              onClick={beginCreate}
            >
              {copy.newExpense}
            </button>
          </div>
        </div>

        <div className="grid three-col" style={{ marginTop: 16 }}>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">{copy.summary.expenseCount}</p>
            <h3 style={{ marginTop: 6 }}>{summary.totalCount}</h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">{copy.summary.receiptsAttached}</p>
            <h3 style={{ marginTop: 6 }}>{summary.withReceipts}</h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">{copy.summary.trackedSpend}</p>
            <h3 style={{ marginTop: 6 }}>
              {formatMoney(summary.total, displayLocale)}
            </h3>
          </article>
        </div>

        {notice ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {error}
          </p>
        ) : null}
      </section>

      <div className="job-records-grid">
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>{copy.lookup.title}</h3>
              <p className="muted">{copy.lookup.subtitle}</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              {copy.lookup.search}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={copy.lookup.searchPlaceholder}
              />
            </label>
            <label>
              {copy.lookup.category}
              <select
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.currentTarget.value)
                }
              >
                <option value="">{copy.lookup.allCategories}</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.lookup.job}
              <select
                value={jobFilter}
                onChange={(event) => setJobFilter(event.currentTarget.value)}
              >
                <option value="">{copy.lookup.allJobs}</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {formatJobReferenceLabel(job)}
                  </option>
                ))}
              </select>
            </label>
          </form>

          <div className="table-shell" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>{copy.lookup.table.date}</th>
                  <th>{copy.lookup.table.description}</th>
                  <th>{copy.lookup.table.category}</th>
                  <th>{copy.lookup.table.jobPo}</th>
                  <th>{copy.lookup.table.amount}</th>
                </tr>
              </thead>
              <tbody>
                {loadingList ? (
                  <tr>
                    <td colSpan={5}>{copy.lookup.table.loading}</td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{copy.lookup.table.empty}</td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr
                      key={expense.id}
                      onClick={() => {
                        setSelectedExpenseId(expense.id);
                        setSelectedExpense(expense);
                        setForm(applyExpenseToForm(expense));
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{expense.expenseDate.slice(0, 10)}</td>
                      <td>
                        <strong>{expense.description}</strong>
                        <div className="muted">
                          {expense.vendorName || copy.lookup.table.noVendor}
                        </div>
                      </td>
                      <td>{expense.category}</td>
                      <td>
                        {expense.job
                          ? formatJobReferenceLabel(expense.job)
                          : copy.lookup.table.noJob}
                        {expense.purchaseOrder ? (
                          <div className="muted">
                            {expense.purchaseOrder.poNumber}
                          </div>
                        ) : null}
                      </td>
                      <td>{formatMoney(expense.amount, displayLocale)}</td>
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
              <h3>
                {selectedExpenseId
                  ? copy.editor.editTitle
                  : copy.editor.addTitle}
              </h3>
              <p className="muted">{copy.editor.subtitle}</p>
            </div>
          </div>

          {loadingReferences ? (
            <p className="form-status">{copy.editor.loading}</p>
          ) : null}

          <div className="auth-form" style={{ marginTop: 12 }}>
            <div className="grid two-col">
              <label>
                {copy.editor.expenseDate}
                <input
                  type="date"
                  value={form.expenseDate}
                  onChange={(event) =>
                    updateForm("expenseDate", event.currentTarget.value)
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                {copy.editor.category}
                <input
                  list="expense-category-options"
                  value={form.category}
                  onChange={(event) =>
                    updateForm("category", event.currentTarget.value)
                  }
                  disabled={!canManage}
                />
                <datalist id="expense-category-options">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                {copy.editor.job}
                <select
                  value={form.jobId}
                  onChange={(event) =>
                    updateForm("jobId", event.currentTarget.value)
                  }
                  disabled={!canManage}
                >
                  <option value="">{copy.editor.noLinkedJob}</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {formatJobReferenceLabel(job)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy.editor.purchaseOrder}
                <select
                  value={form.purchaseOrderId}
                  onChange={(event) =>
                    updateForm("purchaseOrderId", event.currentTarget.value)
                  }
                  disabled={!canManage}
                >
                  <option value="">{copy.editor.noLinkedPo}</option>
                  {purchaseOrderOptions.map((purchaseOrder) => (
                    <option key={purchaseOrder.id} value={purchaseOrder.id}>
                      {purchaseOrder.poNumber} • {purchaseOrder.title}
                      {purchaseOrder.status === "CANCELLED"
                        ? " (Cancelled)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                {copy.editor.vendor}
                <input
                  value={form.vendorName}
                  onChange={(event) =>
                    updateForm("vendorName", event.currentTarget.value)
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                {copy.editor.amount}
                <input
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) =>
                    updateForm("amount", event.currentTarget.value)
                  }
                  disabled={!canManage}
                />
              </label>
            </div>

            <label>
              {copy.editor.description}
              <input
                value={form.description}
                onChange={(event) =>
                  updateForm("description", event.currentTarget.value)
                }
                disabled={!canManage}
              />
            </label>

            <label>
              {copy.editor.notes}
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  updateForm("notes", event.currentTarget.value)
                }
                disabled={!canManage}
              />
            </label>
          </div>

          <div className="portal-empty-actions" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              type="button"
              onClick={() => void saveExpense()}
              disabled={saving || !canManage}
            >
              {saving
                ? copy.editor.saving
                : selectedExpenseId
                  ? copy.editor.save
                  : copy.editor.create}
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => void deleteSelectedExpense()}
              disabled={saving || !selectedExpenseId || !canManage}
            >
              {copy.editor.delete}
            </button>
          </div>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>{copy.receipt.title}</h3>
                <p className="muted">{copy.receipt.subtitle}</p>
              </div>
            </div>

            <div className="auth-form" style={{ marginTop: 12 }}>
              <label>
                {copy.receipt.image}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  disabled={!selectedExpenseId || uploadingReceipt}
                />
              </label>

              <div className="portal-empty-actions">
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => void uploadReceipt()}
                  disabled={
                    !selectedExpenseId || uploadingReceipt || !canManage
                  }
                >
                  {uploadingReceipt
                    ? copy.receipt.uploading
                    : copy.receipt.upload}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => void openReceipt()}
                  disabled={!selectedExpense?.receiptPhotoId}
                >
                  {copy.receipt.open}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => void removeReceipt()}
                  disabled={!selectedExpense?.receiptPhotoId || !canManage}
                >
                  {copy.receipt.remove}
                </button>
              </div>

              <p className="form-status">
                {selectedExpense?.receiptPhotoId
                  ? copy.receipt.attached
                  : copy.receipt.empty}
              </p>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
