import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("owner navigation stays focused on five primary destinations", async () => {
  const [sidebar, mobile] = await Promise.all([
    source("../app/app/client-portal-nav.tsx"),
    source("../app/app/mobile-action-bar.tsx"),
  ]);

  for (const destination of [
    'href: "/app"',
    'href: "/app/inbox"',
    'href: "/app/calendar"',
    'href: "/app/jobs"',
    'href: "/app/more"',
  ]) {
    const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(sidebar, new RegExp(escaped));
    assert.match(mobile, new RegExp(escaped));
  }

  assert.match(sidebar, /internalUser\s*\?\s*navSections/);
  assert.match(sidebar, /ownerPrimaryLinks/);
  assert.match(mobile, /aria-label="Primary navigation"/);
});

test("the owner More page keeps secondary tools out of primary navigation", async () => {
  const more = await source("../app/app/more/page.tsx");

  assert.match(more, /Estimates/);
  assert.match(more, /Invoices & payments/);
  assert.match(more, /Expenses/);
  assert.match(more, /Business settings/);
});

test("owner inbox and today views omit dashboard metric clutter", async () => {
  const [inbox, today] = await Promise.all([
    source("../app/app/inbox/unified-inbox.tsx"),
    source("../app/app/owner-command-center.tsx"),
  ]);

  assert.doesNotMatch(inbox, /inbox-summary-strip/);
  assert.doesNotMatch(today, /<KpiGrid/);
  assert.doesNotMatch(today, /<DashboardRevenueKpiGrid/);
});
