import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMapsHrefFromLocation,
  normalizeLeadCity,
  resolveLeadLocationLabel,
} from "../lib/lead-location.ts";

test("normalizeLeadCity trims conversational filler from city-like replies", () => {
  assert.equal(normalizeLeadCity("Tacoma was"), "Tacoma");
  assert.equal(normalizeLeadCity(" Seattle "), "Seattle");
  assert.equal(
    normalizeLeadCity(
      "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale. I have some custom videos to send you",
    ),
    null,
  );
  assert.equal(normalizeLeadCity(""), null);
});

test("resolveLeadLocationLabel prefers full address data over city-only fallbacks", () => {
  assert.equal(
    resolveLeadLocationLabel({
      customerAddressLine: "123 Main St, Tacoma, WA",
      intakeLocationText: "Tacoma",
      city: "Tacoma was",
    }),
    "123 Main St, Tacoma, WA",
  );

  assert.equal(
    resolveLeadLocationLabel({
      intakeLocationText: "Tacoma was",
      city: "Tacoma was",
    }),
    "Tacoma",
  );

  assert.equal(
    resolveLeadLocationLabel({
      intakeLocationText:
        "regards to the vehicle you're interested in. Please reply YES so I can get these to you ASAP. Reply STOP to cancel. Message and data rates may apply.",
      city: null,
    }),
    null,
  );

  assert.equal(
    resolveLeadLocationLabel({
      intakeLocationText: "yardwork help.",
      city: "yardwork help.",
    }),
    null,
  );
});

test("buildMapsHrefFromLocation only returns URLs for usable locations", () => {
  assert.equal(buildMapsHrefFromLocation(""), null);
  assert.equal(buildMapsHrefFromLocation("yardwork help."), null);
  assert.equal(
    buildMapsHrefFromLocation("123 Main St, Tacoma, WA"),
    "https://maps.google.com/?q=123%20Main%20St%2C%20Tacoma%2C%20WA",
  );
});
