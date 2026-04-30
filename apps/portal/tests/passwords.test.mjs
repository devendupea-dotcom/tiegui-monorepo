import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isValidPassword, verifyPassword } from "../lib/passwords.ts";

test("isValidPassword enforces the minimum password length", () => {
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("123456"), false);
  assert.equal(isValidPassword("Homesnw"), true);
  assert.equal(isValidPassword("1234567"), true);
  assert.equal(isValidPassword("a".repeat(257)), false);
});

test("hashPassword and verifyPassword round-trip valid credentials", async () => {
  const password = "TieGui123!Secure";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});
