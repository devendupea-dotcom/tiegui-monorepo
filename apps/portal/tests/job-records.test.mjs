import assert from "node:assert/strict";
import test from "node:test";
import { formatJobReferenceLabel } from "../lib/job-records.ts";

test("formatJobReferenceLabel includes the address when available", () => {
  assert.equal(
    formatJobReferenceLabel({
      customerName: "Jay",
      projectType: "Retaining wall",
      address: "1842 Juniper Ridge Drive",
    }),
    "Jay • Retaining wall • 1842 Juniper Ridge Drive",
  );
});

test("formatJobReferenceLabel falls back cleanly when project metadata is partial", () => {
  assert.equal(
    formatJobReferenceLabel({
      customerName: "Jay",
      projectType: "",
      address: "",
    }),
    "Jay",
  );
  assert.equal(
    formatJobReferenceLabel({
      customerName: "",
      projectType: "",
      address: "",
    }),
    "Untitled job",
  );
});
