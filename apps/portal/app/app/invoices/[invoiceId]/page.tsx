import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { BillingInvoiceStatus, InvoicePaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  billingInvoiceStatusOptions,
  computeLineTotal,
  formatCurrency,
  formatInvoiceNumber,
  invoicePaymentMethodOptions,
  parseMoneyInput,
  parseTaxRatePercent,
  recomputeInvoiceTotals,
  taxRateToPercent,
  toMoneyDecimal,
} from "@/lib/invoices";
import { sendMetaCapiPurchaseForInvoice } from "@/lib/meta-capi";
import { formatDateTime, formatLabel } from "@/lib/hq";
import { canAccessOrg, isInternalRole, requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    invoiceId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

function appendQuery(path: string, key: string, value: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function toDateInputValue(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function parseDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isAllowedManualStatus(value: string): value is BillingInvoiceStatus {
  return value === "DRAFT" || value === "SENT";
}

function isPaymentMethod(value: string): value is InvoicePaymentMethod {
  return invoicePaymentMethodOptions.some((option) => option === value);
}

async function requireInvoiceActionAccess(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") || "").trim();
  const orgId = String(formData.get("orgId") || "").trim();
  const returnPathRaw = String(formData.get("returnPath") || "").trim();
  const fallbackPath = "/app/invoices";

  if (!invoiceId || !orgId) {
    redirect(fallbackPath);
  }

  const sessionUser = await requireSessionUser(`/app/invoices/${invoiceId}`);
  const internalUser = isInternalRole(sessionUser.role);

  if (!canAccessOrg(sessionUser, orgId)) {
    redirect("/app");
  }

  const currentUser =
    sessionUser.id && !internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  if (!internalUser && currentUser?.calendarAccessRole === "READ_ONLY") {
    redirect(appendQuery(returnPathRaw || fallbackPath, "error", "readonly"));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      orgId,
    },
    select: {
      id: true,
      orgId: true,
      jobId: true,
      status: true,
      dueDate: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
    },
  });

  if (!invoice) {
    redirect(fallbackPath);
  }

  if (!internalUser && currentUser?.calendarAccessRole === "WORKER") {
    if (!invoice.jobId) {
      redirect(appendQuery(returnPathRaw || fallbackPath, "error", "worker-permission"));
    }

    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: invoice.jobId,
        orgId,
        OR: [
          { assignedToUserId: currentUser.id },
          { createdByUserId: currentUser.id },
          { events: { some: { assignedToUserId: currentUser.id } } },
          { events: { some: { workerAssignments: { some: { workerUserId: currentUser.id } } } } },
          { invoices: { some: { id: invoice.id } } },
        ],
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      redirect(appendQuery(returnPathRaw || fallbackPath, "error", "worker-permission"));
    }
  }

  const returnPath = returnPathRaw.startsWith("/app/invoices/") ? returnPathRaw : fallbackPath;
  return {
    invoice,
    orgId,
    returnPath,
    actorId: sessionUser.id ?? null,
    internalUser,
  };
}

async function saveInvoiceMetaAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const issueDateRaw = String(formData.get("issueDate") || "").trim();
  const dueDateRaw = String(formData.get("dueDate") || "").trim();
  const statusRaw = String(formData.get("status") || "").trim().toUpperCase();
  const taxRatePercentRaw = String(formData.get("taxRatePercent") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const issueDate = parseDateInput(issueDateRaw);
  const dueDate = parseDateInput(dueDateRaw);
  const taxRate = parseTaxRatePercent(taxRatePercentRaw);

  if (!issueDate || !dueDate) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-date"));
  }

  if (dueDate < issueDate) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-due"));
  }

  if (!taxRate) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-tax"));
  }

  if (!isAllowedManualStatus(statusRaw)) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-status"));
  }

  if (notes.length > 8000) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-notes"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: scoped.invoice.id },
      data: {
        issueDate,
        dueDate,
        status: statusRaw,
        taxRate,
        notes: notes || null,
      },
    });
    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await sendMetaCapiPurchaseForInvoice({ invoiceId: scoped.invoice.id });

  revalidatePath(`/app/invoices/${scoped.invoice.id}`);
  revalidatePath("/app/invoices");
  if (scoped.invoice.jobId) {
    revalidatePath(`/app/jobs/${scoped.invoice.jobId}`);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "meta"));
}

async function addLineItemAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const description = String(formData.get("description") || "").trim();
  const quantityRaw = String(formData.get("quantity") || "").trim();
  const unitPriceRaw = String(formData.get("unitPrice") || "").trim();

  if (!description || description.length > 200) {
    redirect(appendQuery(scoped.returnPath, "error", "line-description"));
  }

  const quantity = parseMoneyInput(quantityRaw);
  const unitPrice = parseMoneyInput(unitPriceRaw);

  if (!quantity || quantity.lte(0) || quantity.gt(10000) || !unitPrice || unitPrice.lt(0)) {
    redirect(appendQuery(scoped.returnPath, "error", "line-values"));
  }

  await prisma.$transaction(async (tx) => {
    const maxSort = await tx.invoiceLineItem.aggregate({
      where: { invoiceId: scoped.invoice.id },
      _max: { sortOrder: true },
    });

    await tx.invoiceLineItem.create({
      data: {
        invoiceId: scoped.invoice.id,
        description,
        quantity,
        unitPrice,
        lineTotal: computeLineTotal(quantity, unitPrice),
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await sendMetaCapiPurchaseForInvoice({ invoiceId: scoped.invoice.id });

  revalidatePath(`/app/invoices/${scoped.invoice.id}`);
  revalidatePath("/app/invoices");
  if (scoped.invoice.jobId) {
    revalidatePath(`/app/jobs/${scoped.invoice.jobId}`);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "line"));
}

async function updateLineItemAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const lineItemId = String(formData.get("lineItemId") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const quantityRaw = String(formData.get("quantity") || "").trim();
  const unitPriceRaw = String(formData.get("unitPrice") || "").trim();

  if (!lineItemId || !description || description.length > 200) {
    redirect(appendQuery(scoped.returnPath, "error", "line-update"));
  }

  const quantity = parseMoneyInput(quantityRaw);
  const unitPrice = parseMoneyInput(unitPriceRaw);

  if (!quantity || quantity.lte(0) || quantity.gt(10000) || !unitPrice || unitPrice.lt(0)) {
    redirect(appendQuery(scoped.returnPath, "error", "line-values"));
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceLineItem.findFirst({
      where: {
        id: lineItemId,
        invoiceId: scoped.invoice.id,
      },
      select: { id: true },
    });
    if (!existing) {
      throw new Error("Line item not found.");
    }

    await tx.invoiceLineItem.update({
      where: { id: lineItemId },
      data: {
        description,
        quantity,
        unitPrice,
        lineTotal: computeLineTotal(quantity, unitPrice),
      },
    });

    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  revalidatePath(`/app/invoices/${scoped.invoice.id}`);
  revalidatePath("/app/invoices");
  if (scoped.invoice.jobId) {
    revalidatePath(`/app/jobs/${scoped.invoice.jobId}`);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "line-update"));
}

async function deleteLineItemAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const lineItemId = String(formData.get("lineItemId") || "").trim();

  if (!lineItemId) {
    redirect(appendQuery(scoped.returnPath, "error", "line-delete"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({
      where: {
        id: lineItemId,
        invoiceId: scoped.invoice.id,
      },
    });
    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  revalidatePath(`/app/invoices/${scoped.invoice.id}`);
  revalidatePath("/app/invoices");
  if (scoped.invoice.jobId) {
    revalidatePath(`/app/jobs/${scoped.invoice.jobId}`);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "line-delete"));
}

async function recordPaymentAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const amountRaw = String(formData.get("amount") || "").trim();
  const dateRaw = String(formData.get("date") || "").trim();
  const methodRaw = String(formData.get("method") || "").trim().toUpperCase();
  const note = String(formData.get("note") || "").trim();

  const amount = parseMoneyInput(amountRaw);
  const date = parseDateInput(dateRaw);

  if (!amount || amount.lte(0)) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-amount"));
  }

  if (!date) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-date"));
  }

  if (!isPaymentMethod(methodRaw)) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-method"));
  }

  if (note.length > 500) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-note"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.create({
      data: {
        invoiceId: scoped.invoice.id,
        amount,
        date,
        method: methodRaw,
        note: note || null,
      },
    });
    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  revalidatePath(`/app/invoices/${scoped.invoice.id}`);
  revalidatePath("/app/invoices");
  if (scoped.invoice.jobId) {
    revalidatePath(`/app/jobs/${scoped.invoice.jobId}`);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "payment"));
}

async function markInvoicePaidAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const note = String(formData.get("note") || "").trim();

  await prisma.$transaction(async (tx) => {
    const current = await tx.invoice.findUnique({
      where: { id: scoped.invoice.id },
      select: {
        id: true,
        balanceDue: true,
      },
    });

    if (!current || current.balanceDue.lte(0)) {
      return;
    }

    await tx.invoicePayment.create({
      data: {
        invoiceId: scoped.invoice.id,
        amount: current.balanceDue,
        date: new Date(),
        method: "OTHER",
        note: note || "Marked paid in portal",
      },
    });

    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  revalidatePath(`/app/invoices/${scoped.invoice.id}`);
  revalidatePath("/app/invoices");
  if (scoped.invoice.jobId) {
    revalidatePath(`/app/jobs/${scoped.invoice.jobId}`);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "paid"));
}

export default async function InvoiceDetailPage({ params, searchParams }: RouteParams) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);

  const scope = await resolveAppScope({
    nextPath: `/app/invoices/${params.invoiceId}`,
    requestedOrgId,
  });
  const sessionUser = await requireSessionUser(`/app/invoices/${params.invoiceId}`);
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: params.invoiceId,
      orgId: scope.orgId,
    },
    include: {
      org: {
        select: { id: true, name: true },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phoneE164: true,
          email: true,
          addressLine: true,
        },
      },
      job: {
        select: {
          id: true,
          contactName: true,
          businessName: true,
          phoneE164: true,
          city: true,
          status: true,
        },
      },
      lineItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      payments: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!invoice) {
    if (scope.internalUser && !requestedOrgId) {
      const fallback = await prisma.invoice.findUnique({
        where: { id: params.invoiceId },
        select: { orgId: true },
      });

      if (fallback) {
        redirect(`/app/invoices/${params.invoiceId}?orgId=${encodeURIComponent(fallback.orgId)}`);
      }
    }

    notFound();
  }

  if (!scope.internalUser && currentUser?.calendarAccessRole === "WORKER") {
    if (!invoice.jobId) {
      notFound();
    }
    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: invoice.jobId,
        orgId: scope.orgId,
        OR: [
          { assignedToUserId: currentUser.id },
          { createdByUserId: currentUser.id },
          { events: { some: { assignedToUserId: currentUser.id } } },
          { events: { some: { workerAssignments: { some: { workerUserId: currentUser.id } } } } },
          { invoices: { some: { id: invoice.id } } },
        ],
      },
      select: { id: true },
    });
    if (!workerAllowed) {
      notFound();
    }
  }

  const invoicePath = withOrgQuery(`/app/invoices/${invoice.id}`, scope.orgId, scope.internalUser);
  const invoicesPath = withOrgQuery("/app/invoices", scope.orgId, scope.internalUser);
  const jobPath = invoice.jobId ? withOrgQuery(`/app/jobs/${invoice.jobId}?tab=invoice`, scope.orgId, scope.internalUser) : null;
  const pdfPath = `/api/invoices/${invoice.id}/pdf`;
  const paymentDefault = Number(toMoneyDecimal(invoice.balanceDue).toString()).toFixed(2);

  return (
    <div className="invoice-detail-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <Link className="table-link" href={invoicesPath}>
              ← Back to Invoices
            </Link>
            <h2>{formatInvoiceNumber(invoice.invoiceNumber)}</h2>
            <p className="muted">
              {invoice.customer.name} • {invoice.org.name}
            </p>
            <div className="quick-meta">
              <span className={`badge status-${invoice.status.toLowerCase()}`}>{formatLabel(invoice.status)}</span>
              <span className="badge">Total {formatCurrency(invoice.total)}</span>
              <span className={`badge ${invoice.balanceDue.gt(0) ? "status-overdue" : "status-paid"}`}>
                Balance {formatCurrency(invoice.balanceDue)}
              </span>
            </div>
          </div>
          <div className="quick-links">
            {jobPath ? (
              <Link className="btn secondary" href={jobPath}>
                Open Job Folder
              </Link>
            ) : null}
            <a className="btn secondary" href={pdfPath}>
              Download PDF
            </a>
          </div>
        </div>
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>Invoice Details</h2>
          <form action={saveInvoiceMetaAction} className="auth-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="orgId" value={scope.orgId} />
            <input type="hidden" name="returnPath" value={invoicePath} />

            <label>
              Status
              <select name="status" defaultValue={invoice.status === "DRAFT" ? "DRAFT" : "SENT"}>
                <option value="DRAFT">Draft</option>
                <option value="SENT">Sent</option>
              </select>
            </label>

            <label>
              Issue Date
              <input type="date" name="issueDate" defaultValue={toDateInputValue(invoice.issueDate)} required />
            </label>

            <label>
              Due Date
              <input type="date" name="dueDate" defaultValue={toDateInputValue(invoice.dueDate)} required />
            </label>

            <label>
              Tax Rate (%)
              <input name="taxRatePercent" defaultValue={taxRateToPercent(invoice.taxRate)} inputMode="decimal" />
            </label>

            <label>
              Notes
              <textarea name="notes" rows={6} maxLength={8000} defaultValue={invoice.notes || ""} />
            </label>

            <button className="btn primary" type="submit">
              Save Invoice
            </button>
          </form>

          <form action={markInvoicePaidAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="orgId" value={scope.orgId} />
            <input type="hidden" name="returnPath" value={invoicePath} />
            <input type="hidden" name="note" value="Marked paid from invoice detail." />
            <button className="btn secondary" type="submit" disabled={invoice.balanceDue.lte(0)}>
              Mark Paid
            </button>
          </form>

          {saved === "meta" ? <p className="form-status">Invoice details saved.</p> : null}
          {saved === "paid" ? <p className="form-status">Invoice marked paid.</p> : null}
          {error ? <p className="form-status">Could not save invoice update ({error}).</p> : null}
        </article>

        <article className="card">
          <h2>Summary</h2>
          <dl className="detail-list" style={{ marginTop: 10 }}>
            <div>
              <dt>Customer</dt>
              <dd>{invoice.customer.name}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{invoice.customer.phoneE164 || "-"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{invoice.customer.email || "-"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{invoice.customer.addressLine || "-"}</dd>
            </div>
            <div>
              <dt>Issue</dt>
              <dd>{formatDateTime(invoice.issueDate)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{formatDateTime(invoice.dueDate)}</dd>
            </div>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCurrency(invoice.subtotal)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>
                {formatCurrency(invoice.taxAmount)} ({taxRateToPercent(invoice.taxRate)}%)
              </dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatCurrency(invoice.total)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{formatCurrency(invoice.amountPaid)}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{formatCurrency(invoice.balanceDue)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="card">
        <h2>Line Items</h2>
        {invoice.lineItems.length === 0 ? <p className="muted">No line items yet.</p> : null}
        <div className="invoice-line-list">
          {invoice.lineItems.map((lineItem) => (
            <form key={lineItem.id} action={updateLineItemAction} className="invoice-line-form">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="returnPath" value={invoicePath} />
              <input type="hidden" name="lineItemId" value={lineItem.id} />

              <input name="description" defaultValue={lineItem.description} maxLength={200} required />
              <input name="quantity" defaultValue={lineItem.quantity.toString()} inputMode="decimal" required />
              <input name="unitPrice" defaultValue={Number(lineItem.unitPrice.toString()).toFixed(2)} inputMode="decimal" required />
              <span className="invoice-line-total">{formatCurrency(lineItem.lineTotal)}</span>

              <button className="btn secondary" type="submit">
                Save
              </button>
              <button className="btn secondary" type="submit" formAction={deleteLineItemAction}>
                Remove
              </button>
            </form>
          ))}
        </div>

        <form action={addLineItemAction} className="auth-form" style={{ marginTop: 14 }}>
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="orgId" value={scope.orgId} />
          <input type="hidden" name="returnPath" value={invoicePath} />

          <label>
            Description
            <input name="description" maxLength={200} placeholder="Labor - driveway replacement" required />
          </label>
          <label>
            Quantity
            <input name="quantity" defaultValue="1" inputMode="decimal" required />
          </label>
          <label>
            Unit Price
            <input name="unitPrice" defaultValue="0.00" inputMode="decimal" required />
          </label>

          <button className="btn primary" type="submit">
            Add Line Item
          </button>
        </form>

        {saved === "line" ? <p className="form-status">Line item added.</p> : null}
        {saved === "line-update" ? <p className="form-status">Line item updated.</p> : null}
        {saved === "line-delete" ? <p className="form-status">Line item removed.</p> : null}
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>Record Payment</h2>
          <form action={recordPaymentAction} className="auth-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="orgId" value={scope.orgId} />
            <input type="hidden" name="returnPath" value={invoicePath} />

            <label>
              Amount
              <input name="amount" defaultValue={paymentDefault} inputMode="decimal" required />
            </label>
            <label>
              Date
              <input type="date" name="date" defaultValue={toDateInputValue(new Date())} required />
            </label>
            <label>
              Method
              <select name="method" defaultValue="OTHER">
                {invoicePaymentMethodOptions.map((method) => (
                  <option key={method} value={method}>
                    {formatLabel(method)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <textarea name="note" rows={3} maxLength={500} placeholder="Received after completion walkthrough." />
            </label>
            <button className="btn primary" type="submit">
              Record Payment
            </button>
          </form>

          {saved === "payment" ? <p className="form-status">Payment recorded.</p> : null}
        </article>

        <article className="card">
          <h2>Payment History</h2>
          {invoice.payments.length === 0 ? (
            <p className="muted">No payments recorded yet.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDateTime(payment.date)}</td>
                      <td>{formatCurrency(payment.amount)}</td>
                      <td>{formatLabel(payment.method)}</td>
                      <td>{payment.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
