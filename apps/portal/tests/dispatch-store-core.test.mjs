import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMergedDispatchPayload,
  createDispatchEventMetadataBase,
  normalizeDispatchJobPayload,
  serializeDispatchJobWithSchedule,
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

test("normalizeDispatchJobPayload can allow missing scheduled date for unscheduled updates", () => {
  const normalized = normalizeDispatchJobPayload(
    {
      customerName: "Acme Co",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDate: "",
      scheduledStartTime: "",
      scheduledEndTime: "",
    },
    {
      allowMissingScheduledDate: true,
    },
  );

  assert.equal(normalized.scheduledDate, null);
  assert.equal(normalized.scheduledDateKey, null);
  assert.equal(normalized.scheduledStartTime, null);
  assert.equal(normalized.scheduledEndTime, null);
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
      scheduledDate: "2026-04-09",
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

test("serializeDispatchJobWithSchedule uses explicit booking-backed schedule and overdue detection", () => {
  const serialized = serializeDispatchJobWithSchedule(
    {
      id: "job-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Fallback Customer",
      phone: "555-123-4567",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDate: new Date("2026-04-10T00:00:00.000Z"),
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
    {
      scheduledDate: new Date("2026-04-08T00:00:00.000Z"),
      scheduledStartTime: "11:00",
      scheduledEndTime: "13:00",
      hasBookingHistory: true,
      hasActiveBooking: true,
    },
  );

  assert.deepEqual(
    {
      customerLabel: serialized.customerLabel,
      leadLabel: serialized.leadLabel,
      linkedEstimateId: serialized.linkedEstimateId,
      scheduledDate: serialized.scheduledDate,
      scheduledStartTime: serialized.scheduledStartTime,
      scheduledEndTime: serialized.scheduledEndTime,
      hasBookingHistory: serialized.hasBookingHistory,
      hasActiveBooking: serialized.hasActiveBooking,
      isOverdue: serialized.isOverdue,
    },
    {
      customerLabel: "Real Customer",
      leadLabel: "Lead Business",
      linkedEstimateId: "estimate-source",
      scheduledDate: "2026-04-08",
      scheduledStartTime: "11:00",
      scheduledEndTime: "13:00",
      hasBookingHistory: true,
      hasActiveBooking: true,
      isOverdue: true,
    },
  );
});

test("serializeDispatchJobWithSchedule can represent unscheduled dispatch jobs without a linked booking", () => {
  const serialized = serializeDispatchJobWithSchedule(
    {
      id: "job-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Fallback Customer",
      phone: "555-123-4567",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      dispatchStatus: "SCHEDULED",
      assignedCrewId: null,
      crewOrder: null,
      priority: null,
      notes: null,
      linkedEstimateId: null,
      sourceEstimateId: null,
      updatedAt: new Date("2026-04-09T05:00:00.000Z"),
      customer: { id: "customer-1", name: "Real Customer" },
      lead: { contactName: "Pat Doe", businessName: null, phoneE164: "+15551234567" },
      assignedCrew: null,
    },
    "2026-04-09",
    {
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      hasBookingHistory: false,
      hasActiveBooking: false,
    },
  );

  assert.equal(serialized.scheduledDate, "");
  assert.equal(serialized.hasBookingHistory, false);
  assert.equal(serialized.hasActiveBooking, false);
  assert.equal(serialized.isOverdue, false);
});

test("serializeDispatchJobWithSchedule distinguishes active booking from historical linked booking", () => {
  const serialized = serializeDispatchJobWithSchedule(
    {
      id: "job-1",
      customerId: "customer-1",
      leadId: "lead-1",
      customerName: "Fallback Customer",
      phone: "555-123-4567",
      serviceType: "Repair",
      address: "123 Main St",
      scheduledDate: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      dispatchStatus: "COMPLETED",
      assignedCrewId: "crew-1",
      crewOrder: 1,
      priority: null,
      notes: null,
      linkedEstimateId: null,
      sourceEstimateId: null,
      updatedAt: new Date("2026-04-09T05:00:00.000Z"),
      customer: { id: "customer-1", name: "Real Customer" },
      lead: { contactName: "Pat Doe", businessName: null, phoneE164: "+15551234567" },
      assignedCrew: { id: "crew-1", name: "Crew 1" },
    },
    "2026-04-09",
    {
      scheduledDate: new Date("2026-04-09T00:00:00.000Z"),
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:00",
      hasBookingHistory: true,
      hasActiveBooking: false,
    },
  );

  assert.equal(serialized.hasBookingHistory, true);
  assert.equal(serialized.hasActiveBooking, false);
  assert.equal(serialized.scheduledDate, "2026-04-09");
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
