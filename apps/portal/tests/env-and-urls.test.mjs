import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEnvValue } from "../lib/env.ts";
import { getBaseUrlFromRequest } from "../lib/urls.ts";

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("normalizeEnvValue trims blanks and wrapping quotes", () => {
  assert.equal(normalizeEnvValue(undefined), undefined);
  assert.equal(normalizeEnvValue("   "), undefined);
  assert.equal(normalizeEnvValue("  value  "), "value");
  assert.equal(normalizeEnvValue(' "quoted" '), "quoted");
  assert.equal(normalizeEnvValue(" 'quoted' "), "quoted");
});

test("getBaseUrlFromRequest prefers preview deployment host headers", () => {
  withEnv(
    {
      NEXTAUTH_URL: "https://app.tieguisolutions.com",
      VERCEL_ENV: "preview",
    },
    () => {
      const req = new Request("https://ignored.example.com/api/test", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "preview-branch.example.vercel.app",
        },
      });

      assert.equal(getBaseUrlFromRequest(req), "https://preview-branch.example.vercel.app");
    },
  );
});

test("getBaseUrlFromRequest upgrades localhost config when proxied from a real host", () => {
  withEnv(
    {
      NEXTAUTH_URL: "http://localhost:3001",
      VERCEL_ENV: undefined,
    },
    () => {
      const req = new Request("https://ignored.example.com/api/test", {
        headers: {
          "x-forwarded-proto": "https",
          host: "app.tieguisolutions.com",
        },
      });

      assert.equal(getBaseUrlFromRequest(req), "https://app.tieguisolutions.com");
    },
  );
});

test("getBaseUrlFromRequest falls back to configured base URL when safe", () => {
  withEnv(
    {
      NEXTAUTH_URL: "https://app.tieguisolutions.com/",
      VERCEL_ENV: undefined,
    },
    () => {
      const req = new Request("https://ignored.example.com/api/test");
      assert.equal(getBaseUrlFromRequest(req), "https://app.tieguisolutions.com");
    },
  );
});

test("getBaseUrlFromRequest falls back to localhost when no host information exists", () => {
  withEnv(
    {
      NEXTAUTH_URL: undefined,
      VERCEL_ENV: undefined,
    },
    () => {
      const req = new Request("https://ignored.example.com/api/test");
      assert.equal(getBaseUrlFromRequest(req), "http://localhost:3001");
    },
  );
});
