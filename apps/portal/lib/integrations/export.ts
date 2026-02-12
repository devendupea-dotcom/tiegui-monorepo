import { Buffer } from "node:buffer";
import { prisma } from "@/lib/prisma";
import { toCsvRows } from "./csv";
import { buildZipArchive, bufferToReadableStream } from "./zip";

type ExportRows = {
  customers: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  invoiceLineItems: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  snapshot: Record<string, unknown>;
};

function asIso(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString();
}

async function collectExportRows(orgId: string): Promise<ExportRows> {
  const [
    portableCustomers,
    portableJobs,
    portableInvoices,
    portableInvoiceLineItems,
    portablePayments,
    portableNotes,
    leads,
    leadNotes,
    calls,
    messages,
    events,
    leadPhotos,
    leadMeasurements,
    smsTemplates,
    integrationAccounts,
    importRuns,
  ] = await Promise.all([
    prisma.portableCustomer.findMany({
      where: { orgId },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.portableJob.findMany({
      where: { orgId },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.portableInvoice.findMany({
      where: { orgId },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.portableInvoiceLineItem.findMany({
      where: { orgId },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.portablePayment.findMany({
      where: { orgId },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.portableNote.findMany({
      where: { orgId },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.lead.findMany({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        businessType: true,
        status: true,
        notes: true,
        nextFollowUpAt: true,
        invoiceStatus: true,
        invoiceDraftText: true,
        invoiceDueAt: true,
        estimatedRevenueCents: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.leadNote.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        leadId: true,
        body: true,
        createdAt: true,
      },
    }),
    prisma.call.findMany({
      where: { orgId },
      orderBy: { startedAt: "desc" },
    }),
    prisma.message.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.event.findMany({
      where: { orgId },
      orderBy: { startAt: "desc" },
    }),
    prisma.leadPhoto.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.leadMeasurement.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.smsTemplate.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.integrationAccount.findMany({
      where: { orgId },
      orderBy: { provider: "asc" },
    }),
    prisma.importRun.findMany({
      where: { orgId },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const customers = portableCustomers.map((item) => ({
    id: item.id,
    sourceSystem: "EXTERNAL_IMPORT",
    provider: String(item.provider),
    externalId: item.externalId,
    displayName: item.displayName,
    email: item.email || "",
    phone: item.phone || "",
    possibleDuplicate: item.possibleDuplicate,
    createdAtSource: asIso(item.createdAtSource),
    updatedAtSource: asIso(item.updatedAtSource),
    lastSyncedAt: asIso(item.lastSyncedAt),
    createdAt: asIso(item.createdAt),
    updatedAt: asIso(item.updatedAt),
  }));

  for (const lead of leads) {
    customers.push({
      id: lead.id,
      sourceSystem: "LOCAL_PORTAL",
      provider: "LOCAL",
      externalId: lead.id,
      displayName: lead.contactName || lead.businessName || lead.phoneE164,
      email: "",
      phone: lead.phoneE164,
      possibleDuplicate: false,
      createdAtSource: asIso(lead.createdAt),
      updatedAtSource: asIso(lead.updatedAt),
      lastSyncedAt: asIso(lead.updatedAt),
      createdAt: asIso(lead.createdAt),
      updatedAt: asIso(lead.updatedAt),
    });
  }

  const jobs = portableJobs.map((item) => ({
    id: item.id,
    sourceSystem: "EXTERNAL_IMPORT",
    provider: String(item.provider),
    externalId: item.externalId,
    customerExternalId: item.customerExternalId || "",
    title: item.title,
    status: item.status || "",
    description: item.description || "",
    startAt: asIso(item.startAt),
    endAt: asIso(item.endAt),
    createdAtSource: asIso(item.createdAtSource),
    updatedAtSource: asIso(item.updatedAtSource),
    lastSyncedAt: asIso(item.lastSyncedAt),
    createdAt: asIso(item.createdAt),
    updatedAt: asIso(item.updatedAt),
  }));

  for (const lead of leads) {
    jobs.push({
      id: lead.id,
      sourceSystem: "LOCAL_PORTAL",
      provider: "LOCAL",
      externalId: lead.id,
      customerExternalId: lead.id,
      title: lead.contactName || lead.businessName || lead.phoneE164,
      status: lead.status,
      description: lead.businessType || lead.city || "",
      startAt: asIso(lead.nextFollowUpAt),
      endAt: "",
      createdAtSource: asIso(lead.createdAt),
      updatedAtSource: asIso(lead.updatedAt),
      lastSyncedAt: asIso(lead.updatedAt),
      createdAt: asIso(lead.createdAt),
      updatedAt: asIso(lead.updatedAt),
    });
  }

  const invoices = portableInvoices.map((item) => ({
    id: item.id,
    sourceSystem: "EXTERNAL_IMPORT",
    provider: String(item.provider),
    externalId: item.externalId,
    customerExternalId: item.customerExternalId || "",
    jobExternalId: item.jobExternalId || "",
    invoiceNumber: item.invoiceNumber || "",
    status: item.status || "",
    issuedAt: asIso(item.issuedAt),
    dueAt: asIso(item.dueAt),
    currency: item.currency || "",
    subtotalCents: item.subtotalCents ?? "",
    taxCents: item.taxCents ?? "",
    totalCents: item.totalCents ?? "",
    balanceCents: item.balanceCents ?? "",
    createdAtSource: asIso(item.createdAtSource),
    updatedAtSource: asIso(item.updatedAtSource),
    lastSyncedAt: asIso(item.lastSyncedAt),
    createdAt: asIso(item.createdAt),
    updatedAt: asIso(item.updatedAt),
  }));

  for (const lead of leads) {
    if (lead.invoiceStatus === "NONE" && !lead.invoiceDraftText && !lead.invoiceDueAt) {
      continue;
    }

    invoices.push({
      id: `local-invoice-${lead.id}`,
      sourceSystem: "LOCAL_PORTAL",
      provider: "LOCAL",
      externalId: `local-invoice-${lead.id}`,
      customerExternalId: lead.id,
      jobExternalId: lead.id,
      invoiceNumber: "",
      status: lead.invoiceStatus,
      issuedAt: "",
      dueAt: asIso(lead.invoiceDueAt),
      currency: "USD",
      subtotalCents: lead.estimatedRevenueCents ?? "",
      taxCents: "",
      totalCents: lead.estimatedRevenueCents ?? "",
      balanceCents: lead.invoiceStatus === "SENT" ? "" : lead.estimatedRevenueCents ?? "",
      createdAtSource: asIso(lead.createdAt),
      updatedAtSource: asIso(lead.updatedAt),
      lastSyncedAt: asIso(lead.updatedAt),
      createdAt: asIso(lead.createdAt),
      updatedAt: asIso(lead.updatedAt),
    });
  }

  const invoiceLineItems = portableInvoiceLineItems.map((item) => ({
    id: item.id,
    sourceSystem: "EXTERNAL_IMPORT",
    provider: String(item.provider),
    externalId: item.externalId,
    invoiceExternalId: item.invoiceExternalId,
    description: item.description || "",
    quantityDecimal: item.quantityDecimal || "",
    unitPriceCents: item.unitPriceCents ?? "",
    amountCents: item.amountCents ?? "",
    position: item.position ?? "",
    createdAtSource: asIso(item.createdAtSource),
    updatedAtSource: asIso(item.updatedAtSource),
    lastSyncedAt: asIso(item.lastSyncedAt),
    createdAt: asIso(item.createdAt),
    updatedAt: asIso(item.updatedAt),
  }));

  const payments = portablePayments.map((item) => ({
    id: item.id,
    sourceSystem: "EXTERNAL_IMPORT",
    provider: String(item.provider),
    externalId: item.externalId,
    customerExternalId: item.customerExternalId || "",
    invoiceExternalId: item.invoiceExternalId || "",
    amountCents: item.amountCents ?? "",
    currency: item.currency || "",
    paidAt: asIso(item.paidAt),
    status: item.status || "",
    method: item.method || "",
    reference: item.reference || "",
    createdAtSource: asIso(item.createdAtSource),
    updatedAtSource: asIso(item.updatedAtSource),
    lastSyncedAt: asIso(item.lastSyncedAt),
    createdAt: asIso(item.createdAt),
    updatedAt: asIso(item.updatedAt),
  }));

  const notes = portableNotes.map((item) => ({
    id: item.id,
    sourceSystem: "EXTERNAL_IMPORT",
    provider: String(item.provider),
    externalId: item.externalId,
    customerExternalId: item.customerExternalId || "",
    jobExternalId: item.jobExternalId || "",
    invoiceExternalId: item.invoiceExternalId || "",
    body: item.body,
    authoredBy: item.authoredBy || "",
    notedAt: asIso(item.notedAt),
    createdAtSource: asIso(item.createdAtSource),
    updatedAtSource: asIso(item.updatedAtSource),
    lastSyncedAt: asIso(item.lastSyncedAt),
    createdAt: asIso(item.createdAt),
    updatedAt: asIso(item.updatedAt),
  }));

  for (const note of leadNotes) {
    notes.push({
      id: note.id,
      sourceSystem: "LOCAL_PORTAL",
      provider: "LOCAL",
      externalId: note.id,
      customerExternalId: note.leadId,
      jobExternalId: note.leadId,
      invoiceExternalId: "",
      body: note.body,
      authoredBy: "Portal User",
      notedAt: asIso(note.createdAt),
      createdAtSource: asIso(note.createdAt),
      updatedAtSource: asIso(note.createdAt),
      lastSyncedAt: asIso(note.createdAt),
      createdAt: asIso(note.createdAt),
      updatedAt: asIso(note.createdAt),
    });
  }

  for (const lead of leads) {
    if (!lead.notes) continue;
    notes.push({
      id: `lead-summary-note-${lead.id}`,
      sourceSystem: "LOCAL_PORTAL",
      provider: "LOCAL",
      externalId: `lead-summary-note-${lead.id}`,
      customerExternalId: lead.id,
      jobExternalId: lead.id,
      invoiceExternalId: "",
      body: lead.notes,
      authoredBy: "Portal Lead Note",
      notedAt: asIso(lead.updatedAt),
      createdAtSource: asIso(lead.createdAt),
      updatedAtSource: asIso(lead.updatedAt),
      lastSyncedAt: asIso(lead.updatedAt),
      createdAt: asIso(lead.createdAt),
      updatedAt: asIso(lead.updatedAt),
    });
  }

  return {
    customers,
    jobs,
    invoices,
    invoiceLineItems,
    payments,
    notes,
    snapshot: {
      calls,
      messages,
      events,
      leadPhotos,
      leadMeasurements,
      smsTemplates,
      integrationAccounts: integrationAccounts.map((item) => ({
        id: item.id,
        provider: item.provider,
        status: item.status,
        realmId: item.realmId,
        scopes: item.scopes,
        connectedAt: asIso(item.connectedAt),
        expiresAt: asIso(item.expiresAt),
        syncEnabled: item.syncEnabled,
        lastSyncedAt: asIso(item.lastSyncedAt),
        createdAt: asIso(item.createdAt),
        updatedAt: asIso(item.updatedAt),
      })),
      importRuns,
    },
  };
}

function buildReadme() {
  return [
    "TieGui Data Export",
    "",
    "This export includes customer-owned records from integrations and the local portal.",
    "",
    "Files included:",
    "- customers.(csv|json)",
    "- jobs.(csv|json)",
    "- invoices.(csv|json)",
    "- invoice_line_items.(csv|json)",
    "- payments.(csv|json)",
    "- notes.(csv|json)",
    "- org_snapshot.json",
    "",
    "Key portability fields:",
    "- provider: source provider (JOBBER, QBO, LOCAL)",
    "- externalId: stable source record ID",
    "- createdAtSource / updatedAtSource: source timestamps, when provided",
    "- lastSyncedAt: last time TieGui synced/imported this record",
    "",
    "Manual export fallback references:",
    "- Jobber: UI export supports client CSV/vCard exports.",
    "- QuickBooks Online: UI export supports list/report exports to Excel.",
  ].join("\n");
}

function makeCsvAndJsonEntries(rows: ExportRows) {
  const customerColumns = Object.keys(rows.customers[0] || { id: "", provider: "", externalId: "", displayName: "" });
  const jobColumns = Object.keys(rows.jobs[0] || { id: "", provider: "", externalId: "", title: "" });
  const invoiceColumns = Object.keys(rows.invoices[0] || {
    id: "",
    provider: "",
    externalId: "",
    invoiceNumber: "",
  });
  const invoiceLineColumns = Object.keys(rows.invoiceLineItems[0] || {
    id: "",
    provider: "",
    externalId: "",
    invoiceExternalId: "",
  });
  const paymentColumns = Object.keys(rows.payments[0] || { id: "", provider: "", externalId: "", amountCents: "" });
  const noteColumns = Object.keys(rows.notes[0] || { id: "", provider: "", externalId: "", body: "" });

  return [
    { fileName: "README.txt", data: buildReadme() },
    { fileName: "customers.csv", data: toCsvRows(rows.customers, customerColumns) },
    { fileName: "customers.json", data: JSON.stringify(rows.customers, null, 2) },
    { fileName: "jobs.csv", data: toCsvRows(rows.jobs, jobColumns) },
    { fileName: "jobs.json", data: JSON.stringify(rows.jobs, null, 2) },
    { fileName: "invoices.csv", data: toCsvRows(rows.invoices, invoiceColumns) },
    { fileName: "invoices.json", data: JSON.stringify(rows.invoices, null, 2) },
    { fileName: "invoice_line_items.csv", data: toCsvRows(rows.invoiceLineItems, invoiceLineColumns) },
    { fileName: "invoice_line_items.json", data: JSON.stringify(rows.invoiceLineItems, null, 2) },
    { fileName: "payments.csv", data: toCsvRows(rows.payments, paymentColumns) },
    { fileName: "payments.json", data: JSON.stringify(rows.payments, null, 2) },
    { fileName: "notes.csv", data: toCsvRows(rows.notes, noteColumns) },
    { fileName: "notes.json", data: JSON.stringify(rows.notes, null, 2) },
    { fileName: "org_snapshot.json", data: JSON.stringify(rows.snapshot, null, 2) },
  ];
}

export async function createOrgExportArchive(orgId: string) {
  const rows = await collectExportRows(orgId);
  const zipEntries = makeCsvAndJsonEntries(rows);
  const archive = buildZipArchive(zipEntries);
  const stream = bufferToReadableStream(archive);
  const now = new Date().toISOString().slice(0, 10);
  const fileName = `tiegui-export-${orgId}-${now}.zip`;

  return {
    fileName,
    stream,
    byteLength: Buffer.byteLength(archive),
  };
}
