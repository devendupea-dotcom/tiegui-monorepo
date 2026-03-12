import "server-only";

import { Buffer } from "node:buffer";
import { Prisma, type BillingInvoiceStatus, type InvoiceTerms } from "@prisma/client";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { DEFAULT_INVOICE_TERMS, formatCurrency, normalizeInvoiceTerms, taxRateToPercent, toMoneyDecimal } from "@/lib/invoices";

export type InvoicePdfImageSource = string | { data: Buffer; format: "png" | "jpg" };

type PdfOrgBranding = {
  name: string;
  legalName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  licenseNumber?: string | null;
  ein?: string | null;
  invoicePaymentInstructions?: string | null;
  logo?: InvoicePdfImageSource | null;
};

type PdfCustomer = {
  name: string;
  addressLine?: string | null;
  phoneE164?: string | null;
  email?: string | null;
};

type PdfLineItem = {
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  estimatedHeight: number;
};

export type InvoicePdfV2Input = {
  invoiceNumber: string;
  status: BillingInvoiceStatus;
  terms?: InvoiceTerms | null;
  issueDate: Date;
  dueDate: Date;
  org: PdfOrgBranding;
  customer: PdfCustomer;
  jobLabel?: string | null;
  lineItems: Array<{
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }>;
  subtotal: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  balanceDue: Prisma.Decimal;
  notes?: string | null;
};

const PAGE_SIZE = "LETTER";
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 48; // per spec
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_MARGIN * 2;

// Layout reserves (pt). These are used for deterministic page splitting.
const HEADER_RESERVE = 140;
const BILL_TO_RESERVE = 74;
const TABLE_HEADER_RESERVE = 22;
const FOOTER_RESERVE = 28;
const TOTALS_RESERVE = 128;

const BASE_FONT = 10;
const LINE_HEIGHT = 14;
const DESCRIPTION_MAX_LINES = 6;
const DESCRIPTION_CHARS_PER_LINE = 56;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(value);
}

function formatTerms(terms: InvoiceTerms | null | undefined): string {
  const resolvedTerms = normalizeInvoiceTerms(terms ?? DEFAULT_INVOICE_TERMS);

  switch (resolvedTerms) {
    case "NET_7":
      return "Net 7";
    case "NET_15":
      return "Net 15";
    case "NET_30":
      return "Net 30";
    case "DUE_ON_RECEIPT":
    default:
      return "Due on receipt";
  }
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = "\n"): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(separator);
}

function formatOrgAddress(org: PdfOrgBranding): string {
  const line2Parts: string[] = [];
  if (org.city) line2Parts.push(org.city);
  if (org.state) line2Parts.push(org.state);
  if (org.zip) line2Parts.push(org.zip);

  const line2 = line2Parts.length > 0 ? line2Parts.join(", ").replace(", ", ", ") : "";

  return joinNonEmpty([org.addressLine1, org.addressLine2, line2]);
}

function estimateDescriptionLines(description: string): number {
  const normalized = description.replace(/\r\n/g, "\n").trim();
  if (!normalized) return 1;
  const hardLines = normalized.split("\n").filter(Boolean);
  let lines = 0;
  for (const line of hardLines) {
    const len = line.trim().length;
    lines += Math.max(1, Math.ceil(len / DESCRIPTION_CHARS_PER_LINE));
  }
  return clampInt(lines, 1, DESCRIPTION_MAX_LINES);
}

function sanitizeDescription(description: string): string {
  const normalized = String(description || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "-";

  // Cap height deterministically by limiting lines and characters.
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const cappedLines = lines.slice(0, DESCRIPTION_MAX_LINES);
  const capped = cappedLines.join("\n");
  if (capped.length > 320) {
    return `${capped.slice(0, 317).trimEnd()}...`;
  }
  return capped;
}

function estimateRowHeight(description: string): number {
  const lines = estimateDescriptionLines(description);
  const paddingY = 6;
  return paddingY * 2 + lines * LINE_HEIGHT;
}

function toPdfLineItems(
  items: InvoicePdfV2Input["lineItems"],
): PdfLineItem[] {
  return items.map((item) => {
    const description = sanitizeDescription(item.description);
    return {
      description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      estimatedHeight: estimateRowHeight(description),
    };
  });
}

function sumHeights(items: PdfLineItem[]): number {
  return items.reduce((sum, item) => sum + item.estimatedHeight, 0);
}

function pageItemCapacity(input: { firstPage: boolean }): number {
  return (
    CONTENT_HEIGHT -
    HEADER_RESERVE -
    TABLE_HEADER_RESERVE -
    FOOTER_RESERVE -
    (input.firstPage ? BILL_TO_RESERVE : 0)
  );
}

function notesReserve(notes: string | null | undefined, paymentInstructions: string | null | undefined): number {
  const blocks: string[] = [];
  if (notes && notes.trim()) blocks.push(notes.trim());
  if (paymentInstructions && paymentInstructions.trim()) blocks.push(paymentInstructions.trim());
  if (blocks.length === 0) return 0;

  const joined = blocks.join("\n\n");
  const lines = joined.split("\n").map((line) => line.trim()).filter(Boolean);
  const capped = clampInt(lines.length, 2, 10);
  return 10 + capped * LINE_HEIGHT;
}

function splitIntoPages(items: PdfLineItem[]): PdfLineItem[][] {
  const pages: PdfLineItem[][] = [];
  let current: PdfLineItem[] = [];
  let remaining = pageItemCapacity({ firstPage: true });
  let firstPage = true;

  for (const item of items) {
    const itemHeight = item.estimatedHeight;
    if (current.length > 0 && itemHeight > remaining) {
      pages.push(current);
      current = [];
      firstPage = false;
      remaining = pageItemCapacity({ firstPage: false });
    }

    current.push(item);
    remaining -= itemHeight;
  }

  if (current.length > 0) {
    pages.push(current);
  }

  return pages.length > 0 ? pages : [[]];
}

function ensureLastPageFits(input: {
  pages: PdfLineItem[][];
  notes: string | null | undefined;
  paymentInstructions: string | null | undefined;
}): PdfLineItem[][] {
  const pages = input.pages.map((page) => [...page]);
  const extraReserve = TOTALS_RESERVE + notesReserve(input.notes, input.paymentInstructions);

  // Split until the last page can fit totals + notes.
  while (pages.length > 0) {
    const lastIndex = pages.length - 1;
    const last = pages[lastIndex] || [];
    const cap = pageItemCapacity({ firstPage: lastIndex === 0 }) - extraReserve;

    if (sumHeights(last) <= cap) break;

    const working = pages.pop() || [];
    const tail: PdfLineItem[] = [];

    // Move items from the end until the remaining items fit on the (future) last page.
    while (working.length > 0 && sumHeights(working) > cap) {
      const moved = working.pop();
      if (!moved) break;
      tail.unshift(moved);
    }

    pages.push(working);
    pages.push(tail);

    // Guard: if a single massive row can't fit, stop splitting.
    const newLast = pages[pages.length - 1] || [];
    if (newLast.length === 1 && sumHeights(newLast) > cap) {
      break;
    }
  }

  return pages.filter((page) => page.length > 0 || pages.length === 1);
}

const styles = StyleSheet.create({
  page: {
    padding: PAGE_MARGIN,
    fontSize: BASE_FONT,
    fontFamily: "Helvetica",
    color: "#111111",
    backgroundColor: "#FFFFFF",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  headerLeft: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 320,
    gap: 4,
  },
  headerRight: {
    width: 200,
    alignItems: "flex-end",
    gap: 4,
  },
  logo: {
    maxHeight: 60,
    maxWidth: 180,
    marginBottom: 6,
    objectFit: "contain",
  },
  orgName: {
    fontSize: 14,
    fontWeight: 700,
  },
  invoiceTitle: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 0.4,
  },
  muted: {
    color: "#6B7280",
  },
  divider: {
    marginTop: 14,
    marginBottom: 14,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  billToWrap: {
    marginBottom: 14,
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: 600,
    color: "#111111",
    marginBottom: 2,
  },
  table: {
    width: "100%",
    borderTopWidth: 0,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    borderBottomStyle: "solid",
  },
  th: {
    fontSize: 10,
    fontWeight: 600,
    color: "#111111",
  },
  row: {
    flexDirection: "row",
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    borderBottomStyle: "solid",
  },
  colDesc: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 10,
  },
  colQty: {
    width: 46,
  },
  colUnit: {
    width: 78,
  },
  colAmount: {
    width: 78,
  },
  textRight: {
    textAlign: "right",
  },
  totalsWrap: {
    marginTop: 14,
    alignSelf: "flex-end",
    width: 240,
    gap: 6,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalsLabel: {
    color: "#111111",
  },
  totalsValue: {
    textAlign: "right",
  },
  totalDueRow: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    borderTopStyle: "solid",
  },
  totalDueLabel: {
    fontSize: 14,
    fontWeight: 700,
  },
  totalDueValue: {
    fontSize: 14,
    fontWeight: 700,
  },
  notesWrap: {
    marginTop: 16,
    gap: 8,
  },
  watermark: {
    position: "absolute",
    top: PAGE_HEIGHT / 2 - 60,
    left: 0,
    width: PAGE_WIDTH,
    textAlign: "center",
    fontSize: 72,
    fontWeight: 700,
    color: "#D1D5DB",
    opacity: 0.18,
    transform: "rotate(-28deg)",
  },
  footer: {
    position: "absolute",
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    bottom: PAGE_MARGIN - 10,
    fontSize: 9,
    color: "#6B7280",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function InvoicePdfPage(props: {
  pageIndex: number;
  totalPages: number;
  lineItems: PdfLineItem[];
  showBillTo: boolean;
  showTotals: boolean;
  paid: boolean;
  input: InvoicePdfV2Input;
}) {
  const { input } = props;
  const orgName = input.org.legalName || input.org.name;
  const orgAddress = formatOrgAddress(input.org);
  const contactLine = joinNonEmpty(
    [
      input.org.phone ? input.org.phone.trim() : null,
      input.org.email ? input.org.email.trim() : null,
    ],
    " • ",
  );

  const paidLabel = props.paid ? "PAID" : null;
  const showTax = toMoneyDecimal(input.taxAmount).gt(0) || toMoneyDecimal(input.taxRate).gt(0);

  return (
    <Page size={PAGE_SIZE} style={styles.page}>
      {paidLabel ? <Text style={styles.watermark}>{paidLabel}</Text> : null}

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {input.org.logo ? <Image style={styles.logo} src={input.org.logo} /> : null}
          <Text style={styles.orgName}>{orgName}</Text>
          {orgAddress ? <Text style={styles.muted}>{orgAddress}</Text> : null}
          {contactLine ? <Text style={styles.muted}>{contactLine}</Text> : null}
          {input.org.website ? <Text style={styles.muted}>{input.org.website}</Text> : null}
          {input.org.licenseNumber ? (
            <Text style={styles.muted}>License: {input.org.licenseNumber}</Text>
          ) : null}
          {input.org.ein ? <Text style={styles.muted}>EIN: {input.org.ein}</Text> : null}
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.invoiceTitle}>INVOICE</Text>
          <View style={styles.totalsRow}>
            <Text style={styles.label}>Invoice #</Text>
            <Text style={{ fontWeight: 700 }}>{input.invoiceNumber}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>Invoice Date</Text>
            <Text>{formatDate(input.issueDate)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>Due Date</Text>
            <Text>{formatDate(input.dueDate)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>Terms</Text>
            <Text>{formatTerms(input.terms)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      {props.showBillTo ? (
        <View style={styles.billToWrap}>
          <Text style={styles.label}>Bill To</Text>
          <Text style={{ fontWeight: 700 }}>{input.customer.name}</Text>
          {input.customer.addressLine ? <Text style={styles.muted}>{input.customer.addressLine}</Text> : null}
          {input.jobLabel ? <Text style={styles.muted}>Job: {input.jobLabel}</Text> : null}
          {input.customer.phoneE164 ? <Text style={styles.muted}>Phone: {input.customer.phoneE164}</Text> : null}
          {input.customer.email ? <Text style={styles.muted}>Email: {input.customer.email}</Text> : null}
        </View>
      ) : null}

      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <View style={styles.colDesc}>
            <Text style={styles.th}>Description</Text>
          </View>
          <View style={styles.colQty}>
            <Text style={[styles.th, styles.textRight]}>Qty</Text>
          </View>
          <View style={styles.colUnit}>
            <Text style={[styles.th, styles.textRight]}>Unit</Text>
          </View>
          <View style={styles.colAmount}>
            <Text style={[styles.th, styles.textRight]}>Amount</Text>
          </View>
        </View>

        {props.lineItems.map((item, index) => (
          <View key={`${props.pageIndex}-${index}`} style={styles.row} wrap={false}>
            <View style={styles.colDesc}>
              <Text>{item.description}</Text>
            </View>
            <View style={styles.colQty}>
              <Text style={styles.textRight}>{item.quantity.toString()}</Text>
            </View>
            <View style={styles.colUnit}>
              <Text style={styles.textRight}>{formatCurrency(item.unitPrice)}</Text>
            </View>
            <View style={styles.colAmount}>
              <Text style={styles.textRight}>{formatCurrency(item.lineTotal)}</Text>
            </View>
          </View>
        ))}
      </View>

      {props.showTotals ? (
        <>
          <View style={styles.totalsWrap}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatCurrency(input.subtotal)}</Text>
            </View>
            {showTax ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax ({taxRateToPercent(input.taxRate)}%)</Text>
                <Text style={styles.totalsValue}>{formatCurrency(input.taxAmount)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Total</Text>
              <Text style={styles.totalsValue}>{formatCurrency(input.total)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Amount Paid</Text>
              <Text style={styles.totalsValue}>{formatCurrency(input.amountPaid)}</Text>
            </View>
            <View style={[styles.totalsRow, styles.totalDueRow]}>
              <Text style={styles.totalDueLabel}>Balance Due</Text>
              <Text style={styles.totalDueValue}>{formatCurrency(input.balanceDue)}</Text>
            </View>
          </View>

          {input.notes?.trim() || input.org.invoicePaymentInstructions?.trim() ? (
            <View style={styles.notesWrap}>
              {input.notes?.trim() ? (
                <View>
                  <Text style={styles.label}>Notes</Text>
                  <Text style={styles.muted}>{input.notes.trim()}</Text>
                </View>
              ) : null}
              {input.org.invoicePaymentInstructions?.trim() ? (
                <View>
                  <Text style={styles.label}>Payment Instructions</Text>
                  <Text style={styles.muted}>{input.org.invoicePaymentInstructions.trim()}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.footer} fixed>
        <Text>
          {props.pageIndex + 1} / {props.totalPages}
        </Text>
        <Text>{orgName}</Text>
      </View>
    </Page>
  );
}

function InvoicePdfDocument(props: { input: InvoicePdfV2Input; pages: PdfLineItem[][] }) {
  const paid = props.input.status === "PAID" || toMoneyDecimal(props.input.balanceDue).lte(0);
  const totalPages = props.pages.length;

  return (
    <Document>
      {props.pages.map((pageItems, pageIndex) => (
        <InvoicePdfPage
          key={`page-${pageIndex}`}
          pageIndex={pageIndex}
          totalPages={totalPages}
          lineItems={pageItems}
          showBillTo={pageIndex === 0}
          showTotals={pageIndex === totalPages - 1}
          paid={paid}
          input={props.input}
        />
      ))}
    </Document>
  );
}

export async function buildInvoicePdfV2(input: InvoicePdfV2Input): Promise<Buffer> {
  const items = toPdfLineItems(input.lineItems);
  const initialPages = splitIntoPages(items);
  const pages = ensureLastPageFits({
    pages: initialPages,
    notes: input.notes,
    paymentInstructions: input.org.invoicePaymentInstructions,
  });

  try {
    const buffer = await renderToBuffer(<InvoicePdfDocument input={input} pages={pages} />);
    return Buffer.from(buffer);
  } catch (error) {
    if (!input.org.logo) {
      throw error;
    }

    console.warn("Invoice PDF render failed with branding logo. Retrying without logo.", {
      error: error instanceof Error ? error.message : "unknown",
      invoiceNumber: input.invoiceNumber,
      logoSourceType: typeof input.org.logo === "string" ? "url" : input.org.logo.format,
    });

    const fallbackBuffer = await renderToBuffer(
      <InvoicePdfDocument
        input={{
          ...input,
          org: {
            ...input.org,
            logo: null,
          },
        }}
        pages={pages}
      />,
    );

    return Buffer.from(fallbackBuffer);
  }
}
