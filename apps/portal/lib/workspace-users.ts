import type { CalendarAccessRole, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type WorkspaceUser = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  calendarAccessRole: CalendarAccessRole;
  timezone: string | null;
  phoneE164: string | null;
  createdAt: Date;
};

const CALENDAR_ROLE_RANK: Record<CalendarAccessRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  WORKER: 2,
  READ_ONLY: 3,
};

const USER_ROLE_RANK: Record<Role, number> = {
  INTERNAL: 0,
  CLIENT: 1,
};

function normalizeUserIds(userIds?: string[] | null): string[] {
  if (!userIds || userIds.length === 0) {
    return [];
  }
  return [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
}

function buildCalendarRoleFilter(input: {
  allowedCalendarRoles?: CalendarAccessRole[] | null;
  excludeReadOnly?: boolean;
}) {
  if (input.allowedCalendarRoles && input.allowedCalendarRoles.length > 0) {
    return {
      in: input.allowedCalendarRoles,
    };
  }

  if (input.excludeReadOnly) {
    return {
      not: "READ_ONLY" as const,
    };
  }

  return undefined;
}

export async function listWorkspaceUsers(input: {
  organizationId: string;
  includeInternal?: boolean;
  userIds?: string[] | null;
  allowedCalendarRoles?: CalendarAccessRole[] | null;
  excludeReadOnly?: boolean;
  requirePhone?: boolean;
}): Promise<WorkspaceUser[]> {
  const userIds = normalizeUserIds(input.userIds);
  const calendarRoleFilter = buildCalendarRoleFilter({
    allowedCalendarRoles: input.allowedCalendarRoles,
    excludeReadOnly: input.excludeReadOnly,
  });

  const [membershipRows, internalRows] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: {
        organizationId: input.organizationId,
        status: "ACTIVE",
        ...(userIds.length > 0 ? { userId: { in: userIds } } : {}),
        ...(calendarRoleFilter ? { role: calendarRoleFilter } : {}),
        user: {
          role: "CLIENT",
          ...(input.requirePhone ? { phoneE164: { not: null } } : {}),
        },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            timezone: true,
            phoneE164: true,
            createdAt: true,
          },
        },
      },
    }),
    input.includeInternal
      ? prisma.user.findMany({
          where: {
            role: "INTERNAL",
            ...(userIds.length > 0 ? { id: { in: userIds } } : {}),
            ...(calendarRoleFilter ? { calendarAccessRole: calendarRoleFilter } : {}),
            ...(input.requirePhone ? { phoneE164: { not: null } } : {}),
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            timezone: true,
            phoneE164: true,
            createdAt: true,
            calendarAccessRole: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const merged = new Map<string, WorkspaceUser>();

  for (const row of membershipRows) {
    merged.set(row.user.id, {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.user.role,
      calendarAccessRole: row.role,
      timezone: row.user.timezone,
      phoneE164: row.user.phoneE164,
      createdAt: row.user.createdAt,
    });
  }

  for (const row of internalRows) {
    if (!merged.has(row.id)) {
      merged.set(row.id, row);
    }
  }

  return Array.from(merged.values());
}

export async function resolveWorkspaceUserIds(input: {
  organizationId: string;
  requestedUserIds: string[];
  includeInternal?: boolean;
  allowedCalendarRoles?: CalendarAccessRole[] | null;
  excludeReadOnly?: boolean;
}): Promise<string[]> {
  const requestedUserIds = normalizeUserIds(input.requestedUserIds);
  if (requestedUserIds.length === 0) {
    return [];
  }

  const users = await listWorkspaceUsers({
    organizationId: input.organizationId,
    includeInternal: input.includeInternal,
    userIds: requestedUserIds,
    allowedCalendarRoles: input.allowedCalendarRoles,
    excludeReadOnly: input.excludeReadOnly,
  });
  const userIds = new Set(users.map((user) => user.id));
  return requestedUserIds.filter((userId) => userIds.has(userId));
}

export function sortWorkspaceUsersByCalendarRoleThenLabel(users: WorkspaceUser[]): WorkspaceUser[] {
  return [...users].sort((left, right) => {
    const rankDiff = (CALENDAR_ROLE_RANK[left.calendarAccessRole] ?? 99) - (CALENDAR_ROLE_RANK[right.calendarAccessRole] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    const leftLabel = (left.name || left.email).toLowerCase();
    const rightLabel = (right.name || right.email).toLowerCase();
    const labelDiff = leftLabel.localeCompare(rightLabel);
    if (labelDiff !== 0) return labelDiff;
    return left.id.localeCompare(right.id);
  });
}

export function sortWorkspaceUsersByCalendarRoleThenCreatedAt(users: WorkspaceUser[]): WorkspaceUser[] {
  return [...users].sort((left, right) => {
    const rankDiff = (CALENDAR_ROLE_RANK[left.calendarAccessRole] ?? 99) - (CALENDAR_ROLE_RANK[right.calendarAccessRole] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
    if (createdAtDiff !== 0) return createdAtDiff;
    return left.id.localeCompare(right.id);
  });
}

export function sortWorkspaceUsersByUserRoleThenLabel(users: WorkspaceUser[]): WorkspaceUser[] {
  return [...users].sort((left, right) => {
    const roleDiff = (USER_ROLE_RANK[left.role] ?? 99) - (USER_ROLE_RANK[right.role] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    const leftLabel = (left.name || left.email).toLowerCase();
    const rightLabel = (right.name || right.email).toLowerCase();
    const labelDiff = leftLabel.localeCompare(rightLabel);
    if (labelDiff !== 0) return labelDiff;
    return left.id.localeCompare(right.id);
  });
}
