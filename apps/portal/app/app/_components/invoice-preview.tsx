"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { formatDateForDisplay } from "@/lib/calendar/dates";
import type { InvoiceTemplate } from "@/lib/invoice-template";

export type InvoicePreviewData = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status?: string | null;
  jobTitle?: string | null;
  termsLabel?: string | null;
  business: {
    name: string;
    logoUrl?: string | null;
    addressLines?: string[];
    phone?: string | null;
  };
  customer: {
    name: string;
    addressLines?: string[];
  };
  lineItems: Array<{
    description: string;
    quantity: string | number;
    unitPrice: string | number;
    subtotal: string | number;
  }>;
  subtotal: string | number;
  taxLabel?: string | null;
  taxAmount?: string | number | null;
  total: string | number;
  notes?: string | null;
  paymentTerms?: string | null;
};

type InvoicePreviewProps = {
  template: InvoiceTemplate;
  invoice: InvoicePreviewData;
  className?: string;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: string | number | null | undefined): string {
  return currencyFormatter.format(toNumber(value));
}

function formatDate(value: string): string {
  return formatDateForDisplay(value, { fallback: value });
}

function formatQuantity(value: string | number): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(value);
  }
  return Number.isInteger(parsed)
    ? String(parsed)
    : parsed.toFixed(2).replace(/\.00$/, "");
}

function nonEmptyLines(values?: string[]): string[] {
  return (values || []).map((value) => value.trim()).filter(Boolean);
}

export default function InvoicePreview({
  template,
  invoice,
  className,
}: InvoicePreviewProps) {
  const t = useTranslations("invoicePreview");
  const businessLines = nonEmptyLines(invoice.business.addressLines);
  const customerLines = nonEmptyLines(invoice.customer.addressLines);
  const notes = invoice.notes?.trim() || null;
  const paymentTerms = invoice.paymentTerms?.trim() || null;
  const isPaid = (invoice.status || "").trim().toLowerCase() === "paid";

  let accentClass = "invoice-preview--classic";
  let accentStyle: CSSProperties | undefined;
  let titleLabel = t("title");
  let headline = invoice.jobTitle || invoice.customer.name;

  switch (template) {
    case "bold":
      accentClass = "invoice-preview--bold";
      accentStyle = {
        ["--invoice-accent" as string]: "#f97316",
        ["--invoice-accent-soft" as string]: "rgba(249, 115, 22, 0.12)",
      };
      titleLabel = t("projectTitle");
      headline =
        invoice.jobTitle || t("jobFor", { name: invoice.customer.name });
      break;
    case "minimal":
      accentClass = "invoice-preview--minimal";
      accentStyle = {
        ["--invoice-accent" as string]: "#5b6470",
        ["--invoice-accent-soft" as string]: "#f2f4f7",
      };
      titleLabel = t("title");
      break;
    case "classic":
    default:
      accentClass = "invoice-preview--classic";
      accentStyle = {
        ["--invoice-accent" as string]: "#111827",
        ["--invoice-accent-soft" as string]: "#f3f4f6",
      };
      titleLabel = t("title");
      break;
  }

  return (
    <article
      className={`invoice-preview ${accentClass}${className ? ` ${className}` : ""}`}
      style={accentStyle}
    >
      {isPaid ? (
        <div className="invoice-preview__watermark">{t("paidWatermark")}</div>
      ) : null}

      {template === "bold" ? (
        <header className="invoice-preview__header invoice-preview__header--bold">
          <div className="invoice-preview__brand-block">
            <div className="invoice-preview__brand">
              {invoice.business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="invoice-preview__logo"
                  src={invoice.business.logoUrl}
                  alt={`${invoice.business.name} logo`}
                />
              ) : null}
              <div>
                <p className="invoice-preview__eyebrow">{titleLabel}</p>
                <h2 className="invoice-preview__business-name">
                  {invoice.business.name}
                </h2>
              </div>
            </div>
            <div className="invoice-preview__contact-list invoice-preview__contact-list--inverse">
              {businessLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {invoice.business.phone ? <p>{invoice.business.phone}</p> : null}
            </div>
          </div>

          <div className="invoice-preview__hero">
            <div>
              <p className="invoice-preview__eyebrow">{t("job")}</p>
              <h1 className="invoice-preview__headline">{headline}</h1>
            </div>
            <div className="invoice-preview__total-pill">
              <span>{t("totalDue")}</span>
              <strong>{formatCurrency(invoice.total)}</strong>
            </div>
          </div>
        </header>
      ) : (
        <header className="invoice-preview__header">
          <div className="invoice-preview__brand-block">
            <div className="invoice-preview__brand">
              {invoice.business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="invoice-preview__logo"
                  src={invoice.business.logoUrl}
                  alt={`${invoice.business.name} logo`}
                />
              ) : null}
              <div>
                <p className="invoice-preview__eyebrow">{titleLabel}</p>
                <h2 className="invoice-preview__business-name">
                  {invoice.business.name}
                </h2>
                {invoice.jobTitle ? (
                  <p className="invoice-preview__job-label">
                    {invoice.jobTitle}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="invoice-preview__contact-list">
              {businessLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {invoice.business.phone ? <p>{invoice.business.phone}</p> : null}
            </div>
          </div>

          <div className="invoice-preview__meta-card">
            <h3>{titleLabel}</h3>
            <dl>
              <div>
                <dt>{t("invoiceNumber")}</dt>
                <dd>{invoice.invoiceNumber}</dd>
              </div>
              <div>
                <dt>{t("issueDate")}</dt>
                <dd>{formatDate(invoice.issueDate)}</dd>
              </div>
              <div>
                <dt>{t("dueDate")}</dt>
                <dd>{formatDate(invoice.dueDate)}</dd>
              </div>
              {invoice.termsLabel ? (
                <div>
                  <dt>{t("terms")}</dt>
                  <dd>{invoice.termsLabel}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </header>
      )}

      {template === "bold" ? (
        <section className="invoice-preview__meta-row">
          <div className="invoice-preview__bill-card">
            <span className="invoice-preview__section-label">
              {t("billTo")}
            </span>
            <strong>{invoice.customer.name}</strong>
            {customerLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          <div className="invoice-preview__bill-card">
            <span className="invoice-preview__section-label">
              {t("invoiceDetails")}
            </span>
            <p>
              <strong>{t("numberShort")}</strong> {invoice.invoiceNumber}
            </p>
            <p>
              <strong>{t("issuedShort")}</strong>{" "}
              {formatDate(invoice.issueDate)}
            </p>
            <p>
              <strong>{t("dueShort")}</strong> {formatDate(invoice.dueDate)}
            </p>
            {invoice.termsLabel ? (
              <p>
                <strong>{t("termsShort")}</strong> {invoice.termsLabel}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="invoice-preview__bill-row">
          <div className="invoice-preview__bill-card">
            <span className="invoice-preview__section-label">
              {t("billTo")}
            </span>
            <strong>{invoice.customer.name}</strong>
            {customerLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      )}

      <section className="invoice-preview__table-wrap">
        <table className="invoice-preview__table">
          <thead>
            <tr>
              <th>{t("description")}</th>
              <th className="right">{t("quantity")}</th>
              <th className="right">{t("unitPrice")}</th>
              <th className="right">{t("subtotal")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((lineItem, index) => (
              <tr key={`${lineItem.description}-${index}`}>
                <td>{lineItem.description}</td>
                <td className="right">{formatQuantity(lineItem.quantity)}</td>
                <td className="right">{formatCurrency(lineItem.unitPrice)}</td>
                <td className="right">{formatCurrency(lineItem.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="invoice-preview__footer">
        <div className="invoice-preview__notes">
          {notes ? (
            <div className="invoice-preview__note-block">
              <span className="invoice-preview__section-label">
                {t("notes")}
              </span>
              <p>{notes}</p>
            </div>
          ) : null}
          {paymentTerms ? (
            <div className="invoice-preview__note-block">
              <span className="invoice-preview__section-label">
                {t("paymentTerms")}
              </span>
              <p>{paymentTerms}</p>
            </div>
          ) : null}
        </div>

        <div className="invoice-preview__totals">
          <div>
            <span>{t("subtotal")}</span>
            <strong>{formatCurrency(invoice.subtotal)}</strong>
          </div>
          {invoice.taxLabel &&
          invoice.taxAmount !== null &&
          invoice.taxAmount !== undefined ? (
            <div>
              <span>{invoice.taxLabel}</span>
              <strong>{formatCurrency(invoice.taxAmount)}</strong>
            </div>
          ) : null}
          <div className="invoice-preview__total-row">
            <span>{t("totalDue")}</span>
            <strong>{formatCurrency(invoice.total)}</strong>
          </div>
        </div>
      </section>
    </article>
  );
}
