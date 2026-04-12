import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMergedDispatchPayload,
  createDispatchEventMetadataBase,
  normalizeDispatchJobPayload,
  serializeDispatchJob,
} from "../lib/dispatch-store-core.ts";

test("normalizeDispatchJobPayload trims fields and normalizes status, phone, and priority", () => {
  const normalized = normalizeDispatchJobPayload({
    customerName: "  Acme Co  ",
    phone: " (555) 123-4567 ",
    serviceType: "  Repair ",
    address: " 123 Main St ",
    scheduledDate: "2026-04-09",
    scheduledStartTime: "09:00",
    scheduledEndTime: "10:00",
    priority: " UrGent ",
    status: " On_Site ",
  });

  assert.deepEqual(
    {
      customerName: normalized.customerName,
      phone: normalized.phone,
      normalizedPhone: normalized.normalizedPhone,
      serviceType: normalized.serviceType,
      address: normalized.address,
      scheduledDateKey: normalized.scheduledDateKey,
      scheduledStartTime: normalized.scheduledStartTime,
      scheduledEndTime: normalized.scheduledEndTime,
      priority: normalized.priority,
      status: normalized.status,
    },
    {
      customerName: "Acme Co",
      phone: "(555) 123-4567",
      normalizedPhone: "+15551234567",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDateKey: "2026-04-09",
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      priority: "urgent",
      status: "on_site",
    },
  );
});

test("normalizeDispatchJobPayload rejects end time before start time", () => {
  assert.throws(
    () =>
      normalizeDispatchJobPayload({
        customerName: "Acme Co",
        serviceType: "Repair",
        address: "123 Main St",
        scheduledDate: "2026-04-09",
        scheduledStartTime: "11:00",
        scheduledEndTime: "10:00",
      }),
    /End time must be after the start time/,
  );
});

test("buildMergedDispatchPayload preserves explicit clears while defaulting omitted fields", () => {
  const merged = buildMergedDispatchPayload(
    {
      customerId: "customer-1",
      leadId: "lead-1",
      linkedEstimateId: "estimate-1",
      customerName: "Acme Co",
      phone: "555-123-4567",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDate: new Date("2026-04-09T00:00:00.000Z"),
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      assignedCrewId: "crew-1",
      notes: "Existing note",
      priority: "high",
      dispatchStatus: "SCHEDULED",
    },
    {
      phone: "",
      assignedCrewId: null,
    },
  );

  assert.deepEqual(merged, {
    customerId: "customer-1",
    leadId: "lead-1",
    linkedEstimateId: "estimate-1",
    customerName: "Acme Co",
    phone: "",
    serviceType: "Repair",
    address: "123 Main St",
    scheduledDate: "2026-04-09",
    scheduledStartTime: "09:00",
    scheduledEndTime: "10:00",
    assignedCrewId: null,
    notes: "Existing note",
    priority: "high",
    status: "scheduled",
  });
});

test("serializeDispatchJob uses the primary estimate link and overdue detection", () => {
  const serialized = serializeDispatchJob(
    {
      id: "job-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Fallback Customer",
      phone: "555-123-4567",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDate: new Date("2026-04-08T00:00:00.000Z"),
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      dispatchStatus: "SCHEDULED",
      assignedCrewId: "crew-1",
      crewOrder: 2,
      priority: "high",
      notes: "Bring ladder",
      linkedEstimateId: null,
      sourceEstimateId: "estimate-source",
      updatedAt: new Date("2026-04-09T05:00:00.000Z"),
      customer: { id: "customer-1", name: "Real Customer" },
      lead: { contactName: null, businessName: "Lead Business", phoneE164: "+15551234567" },
      assignedCrew: { id: "crew-1", name: "Crew 1" },
    },
    "2026-04-09",
  );

  assert.deepEqual(
    {
      customerLabel: serialized.customerLabel,
      leadLabel: serialized.leadLabel,
      linkedEstimateId: serialized.linkedEstimateId,
      isOverdue: serialized.isOverdue,
    },
    {
      customerLabel: "Real Customer",
      leadLabel: "Lead Business",
      linkedEstimateId: "estimate-source",
      isOverdue: true,
    },
  );
});

test("createDispatchEventMetadataBase keeps status labels alongside dispatch fields", () => {
  assert.deepEqual(
    createDispatchEventMetadataBase({
      customerId: "customer-1",
      leadId: "lead-1",
      linkedEstimateId: "estimate-1",
      scheduledDateKey: "2026-04-09",
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      status: "on_the_way",
      assignedCrewId: "crew-1",
      assignedCrewName: "Crew 1",
    }),
    {
      source: "dispatch",
      customerId: "customer-1",
      leadId: "lead-1",
      linkedEstimateId: "estimate-1",
      scheduledDate: "2026-04-09",
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      status: "on_the_way",
      statusLabel: "On the way",
      assignedCrewId: "crew-1",
      assignedCrewName: "Crew 1",
    },
  );
});
