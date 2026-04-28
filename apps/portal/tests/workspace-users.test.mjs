import test from "node:test";
import assert from "node:assert/strict";

import {
  sortWorkspaceUsersByCalendarRoleThenCreatedAt,
  sortWorkspaceUsersByCalendarRoleThenLabel,
  sortWorkspaceUsersByUserRoleThenLabel,
} from "../lib/workspace-users.ts";

const baseDate = new Date("2026-04-09T00:00:00.000Z");

test("sortWorkspaceUsersByCalendarRoleThenLabel keeps owner/admin/worker order before label order", () => {
  const users = [
    {
      id: "worker-b",
      name: "B Worker",
      email: "b@example.com",
      role: "CLIENT",
      calendarAccessRole: "WORKER",
      timezone: null,
      phoneE164: null,
      createdAt: baseDate,
    },
    {
      id: "owner-a",
      name: "A Owner",
      email: "a@example.com",
      role: "CLIENT",
      calendarAccessRole: "OWNER",
      timezone: null,
      phoneE164: null,
      createdAt: baseDate,
    },
    {
      id: "admin-c",
      name: "C Admin",
      email: "c@example.com",
      role: "CLIENT",
      calendarAccessRole: "ADMIN",
      timezone: null,
      phoneE164: null,
      createdAt: baseDate,
    },
  ];

  assert.deepEqual(
    sortWorkspaceUsersByCalendarRoleThenLabel(users).map((user) => user.id),
    ["owner-a", "admin-c", "worker-b"],
  );
});

test("sortWorkspaceUsersByCalendarRoleThenCreatedAt breaks ties by createdAt", () => {
  const users = [
    {
      id: "worker-late",
      name: "Late",
      email: "late@example.com",
      role: "CLIENT",
      calendarAccessRole: "WORKER",
      timezone: null,
      phoneE164: null,
      createdAt: new Date("2026-04-09T02:00:00.000Z"),
    },
    {
      id: "worker-early",
      name: "Early",
      email: "early@example.com",
      role: "CLIENT",
      calendarAccessRole: "WORKER",
      timezone: null,
      phoneE164: null,
      createdAt: new Date("2026-04-09T01:00:00.000Z"),
    },
  ];

  assert.deepEqual(
    sortWorkspaceUsersByCalendarRoleThenCreatedAt(users).map((user) => user.id),
    ["worker-early", "worker-late"],
  );
});

test("sortWorkspaceUsersByUserRoleThenLabel keeps internal users ahead of client users", () => {
  const users = [
    {
      id: "client-a",
      name: "A Client",
      email: "client@example.com",
      role: "CLIENT",
      calendarAccessRole: "OWNER",
      timezone: null,
      phoneE164: null,
      createdAt: baseDate,
    },
    {
      id: "internal-b",
      name: "B Internal",
      email: "internal@example.com",
      role: "INTERNAL",
      calendarAccessRole: "WORKER",
      timezone: null,
      phoneE164: null,
      createdAt: baseDate,
    },
  ];

  assert.deepEqual(
    sortWorkspaceUsersByUserRoleThenLabel(users).map((user) => user.id),
    ["internal-b", "client-a"],
  );
});
