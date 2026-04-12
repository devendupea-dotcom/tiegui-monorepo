import test from "node:test";
import assert from "node:assert/strict";

import {
  canEditAnyCalendarEventInOrg,
  getCalendarWorkerEditErrorMessage,
} from "../lib/calendar/calendar-access-rules.ts";

test("calendar org edit access allows owners and admins to edit any event", () => {
  assert.equal(
    canEditAnyCalendarEventInOrg({
      id: "owner-1",
      internalUser: false,
      calendarAccessRole: "OWNER",
    }),
    true,
  );

  assert.equal(
    canEditAnyCalendarEventInOrg({
      id: "admin-1",
      internalUser: false,
      calendarAccessRole: "ADMIN",
    }),
    true,
  );
});

test("calendar org edit access keeps support-style worker restrictions for non-admin users", () => {
  assert.equal(
    canEditAnyCalendarEventInOrg({
      id: "worker-1",
      internalUser: false,
      calendarAccessRole: "WORKER",
    }),
    false,
  );

  assert.equal(
    getCalendarWorkerEditErrorMessage({
      actor: {
        id: "worker-1",
        internalUser: false,
        calendarAccessRole: "WORKER",
      },
      workerUserIds: ["worker-2"],
    }),
    "Workers can only edit events assigned to themselves.",
  );
});

test("read-only calendar access stays blocked from worker event edits", () => {
  assert.equal(
    getCalendarWorkerEditErrorMessage({
      actor: {
        id: "readonly-1",
        internalUser: false,
        calendarAccessRole: "READ_ONLY",
      },
      workerUserIds: ["readonly-1"],
    }),
    "Read-only users cannot edit calendar data.",
  );
});

test("internal calendar access bypasses worker-specific edit restrictions", () => {
  assert.equal(
    getCalendarWorkerEditErrorMessage({
      actor: {
        id: "internal-1",
        internalUser: true,
        calendarAccessRole: "READ_ONLY",
      },
      workerUserIds: [],
    }),
    null,
  );
});
