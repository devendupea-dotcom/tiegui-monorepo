import assert from "node:assert/strict";
import test from "node:test";
import {
  isBuilderWorkspace,
  resolvePortalNavSections,
} from "../lib/portal-navigation.ts";

function hrefsFor(input) {
  return resolvePortalNavSections(input).flatMap((section) =>
    section.links.map((link) => link.href),
  );
}

test("contractor client navigation keeps shared operational modules visible", () => {
  const hrefs = hrefsFor({
    internalUser: false,
    portalVertical: "CONTRACTOR",
  });

  assert.ok(hrefs.includes("/app/dispatch"));
  assert.ok(hrefs.includes("/app/expenses"));
  assert.ok(hrefs.includes("/app/field-notes"));
  assert.ok(hrefs.includes("/app/jobs/records"));
  assert.equal(hrefs.includes("/app/builder"), false);
});

test("homebuilder clients get builder workspace without losing shared modules", () => {
  const hrefs = hrefsFor({
    internalUser: false,
    portalVertical: "HOMEBUILDER",
  });

  assert.equal(isBuilderWorkspace({ internalUser: false, portalVertical: "HOMEBUILDER" }), true);
  assert.ok(hrefs.includes("/app/builder"));
  assert.ok(hrefs.includes("/app/dispatch"));
  assert.ok(hrefs.includes("/app/expenses"));
  assert.ok(hrefs.includes("/app/field-notes"));
});

test("internal preview does not turn on builder-only navigation globally", () => {
  const hrefs = hrefsFor({
    internalUser: true,
    portalVertical: "CONTRACTOR",
  });

  assert.equal(isBuilderWorkspace({ internalUser: true, portalVertical: "HOMEBUILDER" }), false);
  assert.equal(hrefs.includes("/app/builder"), false);
  assert.ok(hrefs.includes("/app/dispatch"));
});
