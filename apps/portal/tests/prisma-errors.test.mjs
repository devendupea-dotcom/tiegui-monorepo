import assert from "node:assert/strict";
import test from "node:test";
import { getDispatchSchemaErrorMessage, isPrismaMissingTableError } from "../lib/prisma-errors.ts";

test("detects missing dispatch tables from Prisma error text", () => {
  const error = new Error(
    "Invalid `prisma.crew.findMany()` invocation: The table `public.Crew` does not exist in the current database.",
  );

  assert.equal(isPrismaMissingTableError(error, ["Crew"]), true);
  assert.equal(
    getDispatchSchemaErrorMessage(error),
    "Dispatch is unavailable until the latest database migrations are applied.",
  );
});

test("ignores unrelated errors when checking for missing dispatch tables", () => {
  const error = new Error("Something else broke.");

  assert.equal(isPrismaMissingTableError(error, ["Crew"]), false);
  assert.equal(getDispatchSchemaErrorMessage(error), null);
});
