import assert from "node:assert/strict";
import test from "node:test";
import { buildJobTrackingProgressSteps, createJobTrackingToken } from "../lib/job-tracking.ts";

test("job tracking tokens are long, random-looking, and stored as hashes", () => {
  const first = createJobTrackingToken();
  const second = createJobTrackingToken();

  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
});

test("job tracking progress steps map dispatch states into a homeowner-friendly sequence", () => {
  assert.deepEqual(
    buildJobTrackingProgressSteps("on_site").map((step) => `${step.key}:${step.state}`),
    [
      "scheduled:complete",
      "on_the_way:complete",
      "on_site:current",
      "completed:upcoming",
    ],
  );

  assert.deepEqual(
    buildJobTrackingProgressSteps("rescheduled").map((step) => `${step.key}:${step.state}`),
    [
      "scheduled:current",
      "on_the_way:upcoming",
      "on_site:upcoming",
      "completed:upcoming",
    ],
  );
});
