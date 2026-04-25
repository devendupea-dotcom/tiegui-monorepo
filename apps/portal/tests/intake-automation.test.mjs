import assert from "node:assert/strict";
import test from "node:test";
import { resolveIntakeCallbackSelection } from "../lib/intake-automation-core.ts";

test("resolveIntakeCallbackSelection confirms the chosen hold while waiting for callback", () => {
  const hold = {
    id: "hold-2",
    startAt: new Date("2026-04-23T18:00:00.000Z"),
    workerUserId: "worker-2",
  };

  const result = resolveIntakeCallbackSelection({
    intakeStage: "WAITING_CALLBACK",
    selection: 2,
    holds: [
      {
        id: "hold-1",
        startAt: new Date("2026-04-23T16:00:00.000Z"),
        workerUserId: "worker-1",
      },
      hold,
    ],
  });

  assert.deepEqual(result, {
    status: "confirmed",
    hold,
  });
});

test("resolveIntakeCallbackSelection rejects stale choices and already-completed leads", () => {
  assert.deepEqual(
    resolveIntakeCallbackSelection({
      intakeStage: "WAITING_CALLBACK",
      selection: 3,
      holds: [
        {
          id: "hold-1",
          startAt: new Date("2026-04-23T16:00:00.000Z"),
          workerUserId: "worker-1",
        },
      ],
    }),
    { status: "invalid" },
  );

  assert.deepEqual(
    resolveIntakeCallbackSelection({
      intakeStage: "COMPLETED",
      selection: 1,
      holds: [
        {
          id: "hold-1",
          startAt: new Date("2026-04-23T16:00:00.000Z"),
          workerUserId: "worker-1",
        },
      ],
    }),
    { status: "noop" },
  );
});
