"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/invoices";
import type { JobListItem } from "@/lib/job-records";
import {
  businessExpenseCategorySuggestions,
  formatExpenseAmountInput,
  type BusinessExpenseListItem,
  type BusinessExpensePurchaseOrderSummary,
} from "@/lib/business-expenses";
import type { PurchaseOrderListItem } from "@/lib/purchase-orders";

type BusinessExpensesManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialJobId: string | null;
};

type ExpensesResponse =
  | {
      ok?: boolean;
      expenses?: BusinessExpenseListItem[];
      error?: string;
    }
  | null;

type ExpenseResponse =
  | {
      ok?: boolean;
      expense?: BusinessExpenseListItem;
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

type PurchaseOrdersResponse =
  | {
      ok?: boolean;
      purchaseOrders?: PurchaseOrderListItem[];
      error?: string;
    }
  | null;

type SignedUrlResponse =
  | {
      ok?: boolean;
      url?: string | null;
      error?: string;
    }
  | null;

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

function applyExpenseToForm(expense: BusinessExpenseListItem): ExpenseFormState {
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

export default function BusinessExpensesManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialJobId,
}: BusinessExpensesManagerProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [expenses, setExpenses] = useState<BusinessExpenseListItem[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderListItem[]>([]);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<BusinessExpenseListItem | null>(null);
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
  const currentOperationalJobId = selectedExpenseId ? form.jobId || "" : jobFilter || form.jobId || "";
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

        const jobsPayload = (await jobsResponse.json().catch(() => null)) as JobsResponse;
        const purchaseOrdersPayload = (await purchaseOrdersResponse.json().catch(() => null)) as PurchaseOrdersResponse;

        if (!jobsResponse.ok || !jobsPayload?.ok || !Array.isArray(jobsPayload.jobs)) {
          throw new Error(jobsPayload?.error || "Failed to load jobs.");
        }
        if (
          !purchaseOrdersResponse.ok ||
          !purchaseOrdersPayload?.ok ||
          !Array.isArray(purchaseOrdersPayload.purchaseOrders)
        ) {
          throw new Error(purchaseOrdersPayload?.error || "Failed to load purchase orders.");
        }

        if (cancelled) return;
        setJobs(jobsPayload.jobs);
        setPurchaseOrders(purchaseOrdersPayload.purchaseOrders);
      } catch (loadError) {
        if (cancelled) return;
        setJobs([]);
        setPurchaseOrders([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load expense references.");
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
  }, [internalUser, orgId, refreshToken]);

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

        const payload = (await response.json().catch(() => null)) as ExpensesResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.expenses)) {
          throw new Error(payload?.error || "Failed to load expenses.");
        }

        if (cancelled) return;
        setExpenses(payload.expenses);
      } catch (loadError) {
        if (cancelled) return;
        setExpenses([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load expenses.");
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
  }, [categoryFilter, deferredSearch, internalUser, jobFilter, orgId, refreshToken]);

  const categories = useMemo(() => {
    const dynamic = Array.from(new Set(expenses.map((expense) => expense.category))).sort((a, b) => a.localeCompare(b));
    return Array.from(new Set([...businessExpenseCategorySuggestions, ...dynamic]));
  }, [expenses]);

  const summary = useMemo(() => {
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const withReceipts = expenses.filter((expense) => expense.receiptPhotoId).length;
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

  function updateForm<K extends keyof ExpenseFormState>(field: K, value: ExpenseFormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveExpense() {
    if (!canManage) {
      setError("Read-only users cannot save expenses.");
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

      const response = await fetch(selectedExpenseId ? `/api/business-expenses/${selectedExpenseId}` : "/api/business-expenses", {
        method: selectedExpenseId ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as ExpenseResponse;
      if (!response.ok || !payload?.ok || !payload.expense) {
        throw new Error(payload?.error || "Failed to save expense.");
      }

      setSelectedExpenseId(payload.expense.id);
      setSelectedExpense(payload.expense);
      setForm(applyExpenseToForm(payload.expense));
      setNotice(selectedExpenseId ? "Expense updated." : "Expense created.");
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save expense.");
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
      const response = await fetch(`/api/business-expenses/${selectedExpenseId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to delete expense.");
      }

      setNotice("Expense deleted.");
      resetEditor();
      setRefreshToken((current) => current + 1);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete expense.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadReceipt() {
    if (!selectedExpenseId) {
      setError("Save the expense first before attaching a receipt.");
      return;
    }

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a receipt image first.");
      return;
    }

    setUploadingReceipt(true);
    setError(null);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.set("receipt", file);

      const response = await fetch(`/api/business-expenses/${selectedExpenseId}/receipt`, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as ExpenseResponse;
      if (!response.ok || !payload?.ok || !payload.expense) {
        throw new Error(payload?.error || "Failed to upload receipt.");
      }

      setSelectedExpense(payload.expense);
      setNotice("Receipt attached.");
      setRefreshToken((current) => current + 1);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload receipt.");
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
      const response = await fetch(`/api/business-expenses/${selectedExpenseId}/receipt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ clear: true }),
      });

      const payload = (await response.json().catch(() => null)) as ExpenseResponse;
      if (!response.ok || !payload?.ok || !payload.expense) {
        throw new Error(payload?.error || "Failed to remove receipt.");
      }

      setSelectedExpense(payload.expense);
      setNotice("Receipt removed.");
      setRefreshToken((current) => current + 1);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove receipt.");
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function openReceipt() {
    if (!selectedExpense?.receiptPhotoId) {
      setError("No receipt attached yet.");
      return;
    }

    try {
      const response = await fetch(`/api/photos/${selectedExpense.receiptPhotoId}/signed-url`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as SignedUrlResponse;
      if (!response.ok || !payload?.ok || !payload.url) {
        throw new Error(payload?.error || "Failed to open receipt.");
      }

      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : "Failed to open receipt.");
    }
  }

  return (
    <div className="job-records-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Business Expenses</h2>
            <p className="muted">
              Track receipts, supplier spend, fuel, permits, and job-level expenses for {orgName} in one folder.
            </p>
            <p className="muted">Use the Operational Job page for dispatch, schedule, tracking, and customer communication.</p>
          </div>
          <div className="portal-empty-actions">
            {selectedOperationalJobHref ? (
              <button className="btn primary" type="button" onClick={() => router.push(selectedOperationalJobHref)}>
                Open Operational Job
              </button>
            ) : null}
            <button
              className={selectedOperationalJobHref ? "btn secondary" : "btn primary"}
              type="button"
              onClick={beginCreate}
            >
              New Expense
            </button>
          </div>
        </div>

        <div className="grid three-col" style={{ marginTop: 16 }}>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">Expense Count</p>
            <h3 style={{ marginTop: 6 }}>{summary.totalCount}</h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">Receipts Attached</p>
            <h3 style={{ marginTop: 6 }}>{summary.withReceipts}</h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">Tracked Spend</p>
            <h3 style={{ marginTop: 6 }}>{formatCurrency(summary.total)}</h3>
          </article>
        </div>

        {notice ? <p className="form-status" style={{ marginTop: 12 }}>{notice}</p> : null}
        {error ? <p className="form-status" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>

      <div className="job-records-grid">
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>Expense Lookup</h3>
              <p className="muted">Find job-linked spend when you need receipts, PO linkage, or cost detail.</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Vendor, category, description"
              />
            </label>
            <label>
              Category
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)}>
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
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
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Job / PO</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {loadingList ? (
                  <tr>
                    <td colSpan={5}>Loading expenses…</td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No expenses yet.</td>
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
                        <div className="muted">{expense.vendorName || "No vendor listed"}</div>
                      </td>
                      <td>{expense.category}</td>
                      <td>
                        {expense.job ? `${expense.job.customerName}` : "-"}
                        {expense.purchaseOrder ? <div className="muted">{expense.purchaseOrder.poNumber}</div> : null}
                      </td>
                      <td>{formatCurrency(expense.amount)}</td>
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
              <h3>{selectedExpenseId ? "Edit Expense" : "New Expense"}</h3>
              <p className="muted">Attach the receipt after saving. Receipt uploads currently support image files.</p>
            </div>
          </div>

          {loadingReferences ? <p className="form-status">Loading…</p> : null}

          <div className="auth-form" style={{ marginTop: 12 }}>
            <div className="grid two-col">
              <label>
                Expense date
                <input type="date" value={form.expenseDate} onChange={(event) => updateForm("expenseDate", event.currentTarget.value)} disabled={!canManage} />
              </label>
              <label>
                Category
                <input
                  list="expense-category-options"
                  value={form.category}
                  onChange={(event) => updateForm("category", event.currentTarget.value)}
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
                Job
                <select value={form.jobId} onChange={(event) => updateForm("jobId", event.currentTarget.value)} disabled={!canManage}>
                  <option value="">No linked job</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.customerName} • {job.projectType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Purchase order
                <select
                  value={form.purchaseOrderId}
                  onChange={(event) => updateForm("purchaseOrderId", event.currentTarget.value)}
                  disabled={!canManage}
                >
                  <option value="">No linked PO</option>
                  {purchaseOrders.map((purchaseOrder) => (
                    <option key={purchaseOrder.id} value={purchaseOrder.id}>
                      {purchaseOrder.poNumber} • {purchaseOrder.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Vendor / supplier
                <input value={form.vendorName} onChange={(event) => updateForm("vendorName", event.currentTarget.value)} disabled={!canManage} />
              </label>
              <label>
                Amount
                <input inputMode="decimal" value={form.amount} onChange={(event) => updateForm("amount", event.currentTarget.value)} disabled={!canManage} />
              </label>
            </div>

            <label>
              Description
              <input value={form.description} onChange={(event) => updateForm("description", event.currentTarget.value)} disabled={!canManage} />
            </label>

            <label>
              Notes
              <textarea rows={3} value={form.notes} onChange={(event) => updateForm("notes", event.currentTarget.value)} disabled={!canManage} />
            </label>
          </div>

          <div className="portal-empty-actions" style={{ marginTop: 16 }}>
            <button className="btn primary" type="button" onClick={() => void saveExpense()} disabled={saving || !canManage}>
              {saving ? "Saving..." : selectedExpenseId ? "Save Expense" : "Create Expense"}
            </button>
            <button className="btn secondary" type="button" onClick={() => void deleteSelectedExpense()} disabled={saving || !selectedExpenseId || !canManage}>
              Delete Expense
            </button>
          </div>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>Receipt</h3>
                <p className="muted">Upload a receipt image after the expense is saved.</p>
              </div>
            </div>

            <div className="auth-form" style={{ marginTop: 12 }}>
              <label>
                Receipt image
                <input ref={fileRef} type="file" accept="image/*" disabled={!selectedExpenseId || uploadingReceipt} />
              </label>

              <div className="portal-empty-actions">
                <button className="btn secondary" type="button" onClick={() => void uploadReceipt()} disabled={!selectedExpenseId || uploadingReceipt || !canManage}>
                  {uploadingReceipt ? "Uploading..." : "Upload Receipt"}
                </button>
                <button className="btn secondary" type="button" onClick={() => void openReceipt()} disabled={!selectedExpense?.receiptPhotoId}>
                  Open Receipt
                </button>
                <button className="btn secondary" type="button" onClick={() => void removeReceipt()} disabled={!selectedExpense?.receiptPhotoId || !canManage}>
                  Remove Receipt
                </button>
              </div>

              <p className="form-status">
                {selectedExpense?.receiptPhotoId ? "Receipt attached." : "No receipt attached yet."}
              </p>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
