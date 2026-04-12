import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  deriveInvoiceStatus,
  getInvoiceActionContext,
  getInvoiceActionRevalidationPaths,
  getInvoiceReadJobContext,
  selectConservativeInvoiceSourceJobCandidate,
  shouldRenderInvoicePaidIndicator,
} from "../lib/invoices.ts";

test("deriveInvoiceStatus keeps zero-total drafts editable", () => {
  const status = deriveInvoiceStatus({
    currentStatus: "DRAFT",
    dueDate: new Date("2026-04-01T00:00:00.000Z"),
    total: new Prisma.Decimal(0),
    amountPaid: new Prisma.Decimal(0),
    now: new Date("2026-04-02T00:00:00.000Z"),
  });

  assert.equal(status, "DRAFT");
});

test("deriveInvoiceStatus does not auto-mark zero-total sent invoices as paid", () => {
  const status = deriveInvoiceStatus({
    currentStatus: "SENT",
    dueDate: new Date("2026-04-01T00:00:00.000Z"),
    total: new Prisma.Decimal(0),
    amountPaid: new Prisma.Decimal(0),
    now: new Date("2026-04-02T00:00:00.000Z"),
  });

  assert.equal(status, "SENT");
});

test("shouldRenderInvoicePaidIndicator only returns true for paid invoices", () => {
  assert.equal(shouldRenderInvoicePaidIndicator({ status: "PAID" }), true);
  assert.equal(shouldRenderInvoicePaidIndicator({ status: "SENT" }), false);
  assert.equal(shouldRenderInvoicePaidIndicator({ status: "OVERDUE" }), false);
});

test("getInvoiceReadJobContext prefers the operational job when sourceJob is linked", () => {
  const context = getInvoiceReadJobContext({
    legacyLeadId: "lead-1",
    sourceJobId: "job-1",
    legacyLead: {
      id: "lead-1",
      contactName: "Maria Lead",
      businessName: null,
      phoneE164: "+12065550100",
    },
    sourceJob: {
      id: "job-1",
      leadId: "lead-1",
      customerName: "Maria Lopez",
      serviceType: "Fence Repair",
      projectType: "Fence Repair",
    },
  });

  assert.equal(context.operationalJobId, "job-1");
  assert.equal(context.crmLeadId, "lead-1");
  assert.equal(context.primaryKind, "operational");
  assert.equal(context.primaryLabel, "Maria Lopez • Fence Repair");
  assert.equal(context.crmLabel, "Maria Lead");
});

test("getInvoiceReadJobContext falls back to the CRM lead when no operational job exists", () => {
  const context = getInvoiceReadJobContext({
    legacyLeadId: "lead-2",
    sourceJobId: null,
    legacyLead: {
      id: "lead-2",
      contactName: null,
      businessName: "Acme Roofing",
      phoneE164: "+12065550200",
    },
    sourceJob: null,
  });

  assert.equal(context.operationalJobId, null);
  assert.equal(context.crmLeadId, "lead-2");
  assert.equal(context.primaryKind, "crm");
  assert.equal(context.primaryLabel, "Acme Roofing");
});

test("getInvoiceActionContext prefers the operational job lead over the legacy invoice lead link", () => {
  const context = getInvoiceActionContext({
    legacyLeadId: "legacy-lead",
    sourceJobId: "job-1",
    legacyLead: {
      id: "legacy-lead",
      fbClickId: "fbc-legacy",
      fbBrowserId: "fbp-legacy",
    },
    sourceJob: {
      id: "job-1",
      leadId: "lead-from-job",
      lead: {
        id: "lead-from-job",
        fbClickId: "fbc-operational",
        fbBrowserId: "fbp-operational",
      },
    },
  });

  assert.equal(context.operationalJobId, "job-1");
  assert.equal(context.operationalLeadId, "lead-from-job");
  assert.equal(context.legacyLeadId, "legacy-lead");
  assert.equal(context.leadId, "lead-from-job");
  assert.equal(context.fbClickId, "fbc-operational");
  assert.equal(context.fbBrowserId, "fbp-operational");
});

test("getInvoiceActionRevalidationPaths revalidates the resolved lead folder path", () => {
  const paths = getInvoiceActionRevalidationPaths({
    invoiceId: "invoice-1",
    leadId: "lead-from-job",
  });

  assert.deepEqual(paths, ["/app/invoices/invoice-1", "/app/invoices", "/app/jobs/lead-from-job"]);
});

test("selectConservativeInvoiceSourceJobCandidate prefers an exact estimate-linked job", () => {
  const resolution = selectConservativeInvoiceSourceJobCandidate({
    sourceEstimateId: "estimate-1",
    legacyLeadId: "lead-1",
    customerId: "customer-1",
    candidates: [
      {
        id: "job-1",
        orgId: "org-1",
        leadId: "lead-1",
        customerId: "customer-1",
        sourceEstimateId: "estimate-1",
        linkedEstimateId: null,
        customerName: "Maria Lopez",
        phone: null,
        address: "",
        serviceType: "Fence Repair",
        projectType: "Fence Repair",
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        dispatchStatus: "SCHEDULED",
        notes: null,
        status: "SCHEDULED",
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "job-2",
        orgId: "org-1",
        leadId: "lead-1",
        customerId: "customer-1",
        sourceEstimateId: null,
        linkedEstimateId: null,
        customerName: "Maria Lopez",
        phone: null,
        address: "",
        serviceType: "Fence Repair",
        projectType: "Fence Repair",
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        dispatchStatus: "SCHEDULED",
        notes: null,
        status: "DRAFT",
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ],
  });

  assert.equal(resolution.sourceJobId, "job-1");
  assert.equal(resolution.matchedBy, "estimate");
  assert.equal(resolution.reason, "matched_estimate");
});

test("selectConservativeInvoiceSourceJobCandidate rejects ambiguous lead-linked jobs", () => {
  const resolution = selectConservativeInvoiceSourceJobCandidate({
    sourceEstimateId: null,
    legacyLeadId: "lead-1",
    customerId: "customer-1",
    candidates: [
      {
        id: "job-1",
        orgId: "org-1",
        leadId: "lead-1",
        customerId: "customer-1",
        sourceEstimateId: null,
        linkedEstimateId: null,
        customerName: "Maria Lopez",
        phone: null,
        address: "",
        serviceType: "Fence Repair",
        projectType: "Fence Repair",
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        dispatchStatus: "SCHEDULED",
        notes: null,
        status: "SCHEDULED",
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "job-2",
        orgId: "org-1",
        leadId: "lead-1",
        customerId: "customer-1",
        sourceEstimateId: null,
        linkedEstimateId: null,
        customerName: "Maria Lopez",
        phone: null,
        address: "",
        serviceType: "Fence Repair",
        projectType: "Fence Repair",
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        dispatchStatus: "SCHEDULED",
        notes: null,
        status: "IN_PROGRESS",
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ],
  });

  assert.equal(resolution.sourceJobId, null);
  assert.equal(resolution.matchedBy, null);
  assert.equal(resolution.reason, "ambiguous_lead");
});

test("selectConservativeInvoiceSourceJobCandidate rejects customer-mismatched jobs", () => {
  const resolution = selectConservativeInvoiceSourceJobCandidate({
    sourceEstimateId: "estimate-1",
    legacyLeadId: "lead-1",
    customerId: "customer-1",
    candidates: [
      {
        id: "job-1",
        orgId: "org-1",
        leadId: "lead-1",
        customerId: "customer-2",
        sourceEstimateId: "estimate-1",
        linkedEstimateId: null,
        customerName: "Wrong Customer",
        phone: null,
        address: "",
        serviceType: "Fence Repair",
        projectType: "Fence Repair",
        scheduledDate: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        dispatchStatus: "SCHEDULED",
        notes: null,
        status: "SCHEDULED",
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ],
  });

  assert.equal(resolution.sourceJobId, null);
  assert.equal(resolution.matchedBy, null);
  assert.equal(resolution.reason, "none");
});
