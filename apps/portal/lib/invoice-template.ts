export const invoiceTemplateOptions = ["classic", "bold", "minimal"] as const;

export type InvoiceTemplate = (typeof invoiceTemplateOptions)[number];

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = "classic";

export function isInvoiceTemplate(value: unknown): value is InvoiceTemplate {
  return typeof value === "string" && invoiceTemplateOptions.includes(value as InvoiceTemplate);
}

export function normalizeInvoiceTemplate(value: unknown): InvoiceTemplate {
  return isInvoiceTemplate(value) ? value : DEFAULT_INVOICE_TEMPLATE;
}
