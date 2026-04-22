import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerImportReviewCsv,
  buildCustomerImportTemplateCsv,
  decideCustomerImportRow,
  normalizeCustomerImportRows,
  summarizeCustomerImportPreview,
  suggestCustomerImportMapping,
} from "../lib/customer-import.ts";

test("customer import mapping recognizes common spreadsheet headers", () => {
  const mapping = suggestCustomerImportMapping([
    "Customer Name",
    "Mobile",
    "Email Address",
    "Service Address",
    "City",
    "Project Type",
    "Notes",
  ]);

  assert.deepEqual(mapping, {
    name: "Customer Name",
    phone: "Mobile",
    email: "Email Address",
    address: "Service Address",
    city: "City",
    businessType: "Project Type",
    notes: "Notes",
  });
});

test("customer import template csv includes the expected headers and sample rows", () => {
  const csv = buildCustomerImportTemplateCsv();
  const [headerRow, firstSampleRow] = csv.split("\r\n");

  assert.equal(headerRow, "Name,Phone,Email,Address,City,Work Type,Notes");
  assert.match(firstSampleRow, /Jane Smith/);
  assert.match(firstSampleRow, /Tacoma/);
});

test("customer import review csv includes decision and detail columns", () => {
  const [row] = normalizeCustomerImportRows({
    rows: [{ Name: "Pat Doe", Phone: "", Email: "pat@example.com" }],
    mapping: {
      name: "Name",
      phone: "Phone",
      email: "Email",
      address: null,
      city: null,
      businessType: null,
      notes: null,
    },
  });

  const csv = buildCustomerImportReviewCsv([
    {
      ...row,
      decision: "skip_invalid_phone",
      duplicateFilePhoneCount: 0,
      existingCustomerCount: 0,
      existingLeadCount: 0,
      blockedPhone: false,
    },
  ]);

  assert.match(csv, /Decision/);
  assert.match(csv, /skip_invalid_phone/);
  assert.match(csv, /Phone number is required/);
});

test("customer import row normalization requires a usable phone and falls back customer name cleanly", () => {
  const [first, second] = normalizeCustomerImportRows({
    rows: [
      {
        Name: "Pat Doe",
        Phone: "(253) 555-0123",
        Email: "pat@example.com",
      },
      {
        Name: "",
        Phone: "",
        Email: "fallback@example.com",
      },
    ],
    mapping: {
      name: "Name",
      phone: "Phone",
      email: "Email",
      address: null,
      city: null,
      businessType: null,
      notes: null,
    },
  });

  assert.equal(first.resolvedName, "Pat Doe");
  assert.equal(first.phoneE164, "+12535550123");
  assert.equal(first.issues.length, 0);

  assert.equal(second.resolvedName, "fallback@example.com");
  assert.equal(second.phoneE164, null);
  assert.deepEqual(second.issues, ["Phone number is required."]);
});

test("customer import preview decisions and summary stay conservative around duplicates", () => {
  const rows = normalizeCustomerImportRows({
    rows: [
      { Name: "New Customer", Phone: "2535550101" },
      { Name: "Existing Customer", Phone: "2535550102" },
      { Name: "Ambiguous Customer", Phone: "2535550103" },
      { Name: "Blocked Caller", Phone: "2535550104" },
    ],
    mapping: {
      name: "Name",
      phone: "Phone",
      email: null,
      address: null,
      city: null,
      businessType: null,
      notes: null,
    },
  });

  const previewRows = [
    {
      ...rows[0],
      decision: decideCustomerImportRow({
        row: rows[0],
        duplicateFilePhoneCount: 1,
        existingCustomerCount: 0,
        existingLeadCount: 0,
        blockedPhone: false,
      }),
      duplicateFilePhoneCount: 1,
      existingCustomerCount: 0,
      existingLeadCount: 0,
      blockedPhone: false,
    },
    {
      ...rows[1],
      decision: decideCustomerImportRow({
        row: rows[1],
        duplicateFilePhoneCount: 1,
        existingCustomerCount: 1,
        existingLeadCount: 0,
        blockedPhone: false,
      }),
      duplicateFilePhoneCount: 1,
      existingCustomerCount: 1,
      existingLeadCount: 0,
      blockedPhone: false,
    },
    {
      ...rows[2],
      decision: decideCustomerImportRow({
        row: rows[2],
        duplicateFilePhoneCount: 1,
        existingCustomerCount: 2,
        existingLeadCount: 0,
        blockedPhone: false,
      }),
      duplicateFilePhoneCount: 1,
      existingCustomerCount: 2,
      existingLeadCount: 0,
      blockedPhone: false,
    },
    {
      ...rows[3],
      decision: decideCustomerImportRow({
        row: rows[3],
        duplicateFilePhoneCount: 1,
        existingCustomerCount: 0,
        existingLeadCount: 0,
        blockedPhone: true,
      }),
      duplicateFilePhoneCount: 1,
      existingCustomerCount: 0,
      existingLeadCount: 0,
      blockedPhone: true,
    },
  ];

  assert.equal(previewRows[0].decision, "create_customer_and_lead");
  assert.equal(previewRows[1].decision, "create_lead_for_existing_customer");
  assert.equal(previewRows[2].decision, "skip_ambiguous_customer");
  assert.equal(previewRows[3].decision, "skip_blocked_phone");

  assert.deepEqual(summarizeCustomerImportPreview(previewRows), {
    totalRows: 4,
    readyRows: 2,
    skippedRows: 2,
    duplicateInFileRows: 0,
    blockedRows: 1,
    invalidPhoneRows: 0,
    ambiguousCustomerRows: 1,
    ambiguousLeadRows: 0,
    createCustomerRows: 1,
    createLeadRows: 2,
    attachExistingCustomerRows: 1,
    updateExistingRecordRows: 0,
  });
});

test("customer import skips duplicate phone numbers inside the same uploaded file", () => {
  const rows = normalizeCustomerImportRows({
    rows: [
      { Name: "Pat One", Phone: "(253) 555-0105" },
      { Name: "Pat Two", Phone: "253-555-0105" },
    ],
    mapping: {
      name: "Name",
      phone: "Phone",
      email: null,
      address: null,
      city: null,
      businessType: null,
      notes: null,
    },
  });

  const previewRows = rows.map((row) => ({
    ...row,
    decision: decideCustomerImportRow({
      row,
      duplicateFilePhoneCount: 2,
      existingCustomerCount: 0,
      existingLeadCount: 0,
      blockedPhone: false,
    }),
    duplicateFilePhoneCount: 2,
    existingCustomerCount: 0,
    existingLeadCount: 0,
    blockedPhone: false,
  }));

  assert.equal(previewRows[0].decision, "skip_duplicate_in_file");
  assert.equal(previewRows[1].decision, "skip_duplicate_in_file");

  assert.deepEqual(summarizeCustomerImportPreview(previewRows), {
    totalRows: 2,
    readyRows: 0,
    skippedRows: 2,
    duplicateInFileRows: 2,
    blockedRows: 0,
    invalidPhoneRows: 0,
    ambiguousCustomerRows: 0,
    ambiguousLeadRows: 0,
    createCustomerRows: 0,
    createLeadRows: 0,
    attachExistingCustomerRows: 0,
    updateExistingRecordRows: 0,
  });
});
