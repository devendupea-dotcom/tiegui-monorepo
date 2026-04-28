import assert from "node:assert/strict";
import test from "node:test";
import { buildSecurityHeaders } from "../../../packages/security-headers/index.mjs";

function toHeaderMap(headers) {
  return new Map(headers.map((header) => [header.key, header.value]));
}

test("buildSecurityHeaders includes core browser hardening headers", () => {
  const headers = toHeaderMap(buildSecurityHeaders());

  assert.match(headers.get("Content-Security-Policy") || "", /default-src 'self'/);
  assert.match(headers.get("Content-Security-Policy") || "", /frame-ancestors 'none'/);
  assert.match(headers.get("Content-Security-Policy") || "", /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(headers.get("Content-Security-Policy") || "", /script-src[^;]*https:/);
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.match(headers.get("Permissions-Policy") || "", /camera=\(\)/);
  assert.match(headers.get("Permissions-Policy") || "", /microphone=\(\)/);
});

test("buildSecurityHeaders only adds HSTS and insecure request upgrades when requested", () => {
  const defaultHeaders = toHeaderMap(buildSecurityHeaders());
  assert.equal(defaultHeaders.has("Strict-Transport-Security"), false);
  assert.doesNotMatch(defaultHeaders.get("Content-Security-Policy") || "", /upgrade-insecure-requests/);

  const productionHeaders = toHeaderMap(
    buildSecurityHeaders({
      enableHsts: true,
      upgradeInsecureRequests: true,
    }),
  );
  assert.match(productionHeaders.get("Strict-Transport-Security") || "", /max-age=63072000/);
  assert.match(productionHeaders.get("Content-Security-Policy") || "", /upgrade-insecure-requests/);
});

test("buildSecurityHeaders allows known script hosts explicitly", () => {
  const headers = toHeaderMap(
    buildSecurityHeaders({
      scriptSrc: ["https://www.googletagmanager.com"],
    }),
  );

  assert.match(headers.get("Content-Security-Policy") || "", /script-src[^;]*https:\/\/www\.googletagmanager\.com/);
});

test("buildSecurityHeaders can allow same-origin microphone access for app features", () => {
  const headers = toHeaderMap(
    buildSecurityHeaders({
      allowMicrophone: true,
    }),
  );

  assert.match(headers.get("Permissions-Policy") || "", /microphone=\(self\)/);
  assert.match(headers.get("Permissions-Policy") || "", /camera=\(\)/);
});
