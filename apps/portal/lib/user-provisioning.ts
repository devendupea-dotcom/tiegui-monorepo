import type { CalendarAccessRole } from "@prisma/client";

type ProvisionedUserRole = "CLIENT" | "INTERNAL";

type ProvisionedUserRecord = {
  id: string;
  email: string;
  calendarAccessRole: CalendarAccessRole;
};

type ProvisionedUserCompatibilityRecord = {
  orgId: string | null;
};

type ProvisioningTx = {
  user: {
    create(args: {
      data: {
        email: string;
        name: string | null;
        role: ProvisionedUserRole;
        calendarAccessRole?: CalendarAccessRole;
        phoneE164?: string | null;
        timezone?: string | null;
        orgId: string | null;
        mustChangePassword: boolean;
      };
      select: {
        id: true;
        email: true;
        calendarAccessRole: true;
      };
    }): Promise<ProvisionedUserRecord>;
    findUnique(args: {
      where: {
        id: string;
      };
      select: {
        orgId: true;
      };
    }): Promise<ProvisionedUserCompatibilityRecord | null>;
    update(args: {
      where: {
        id: string;
      };
      data: {
        orgId?: string | null;
        calendarAccessRole?: CalendarAccessRole;
        name?: string | null;
        phoneE164?: string | null;
        timezone?: string | null;
      };
    }): Promise<unknown>;
  };
  organizationMembership: {
    create(args: {
      data: {
        organizationId: string;
        userId: string;
        role: CalendarAccessRole;
        status: "ACTIVE";
      };
    }): Promise<unknown>;
    upsert(args: {
      where: {
        organizationId_userId: {
          organizationId: string;
          userId: string;
        };
      };
      update: {
        role: CalendarAccessRole;
        status: "ACTIVE";
      };
      create: {
        organizationId: string;
        userId: string;
        role: CalendarAccessRole;
        status: "ACTIVE";
      };
    }): Promise<unknown>;
  };
};

export function buildActiveOrganizationMembershipData(input: {
  organizationId: string;
  userId: string;
  role: CalendarAccessRole;
}) {
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    status: "ACTIVE" as const,
  };
}

export function buildLegacyWorkspaceCompatibilityUpdate(input: {
  currentOrgId: string | null;
  organizationId: string;
  role: CalendarAccessRole;
}) {
  if (!input.currentOrgId) {
    return {
      orgId: input.organizationId,
      calendarAccessRole: input.role,
    };
  }

  if (input.currentOrgId === input.organizationId) {
    return {
      calendarAccessRole: input.role,
    };
  }

  return null;
}

export async function syncClientUserOrganizationAccess(input: {
  tx: ProvisioningTx;
  userId: string;
  organizationId: string;
  role: CalendarAccessRole;
}) {
  const user = await input.tx.user.findUnique({
    where: { id: input.userId },
    select: {
      orgId: true,
    },
  });

  if (!user) {
    throw new Error(`Cannot sync workspace access for missing user ${input.userId}.`);
  }

  const membershipData = buildActiveOrganizationMembershipData({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
  });

  await input.tx.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    update: {
      role: input.role,
      status: "ACTIVE",
    },
    create: membershipData,
  });

  const compatibilityData = buildLegacyWorkspaceCompatibilityUpdate({
    currentOrgId: user.orgId,
    organizationId: input.organizationId,
    role: input.role,
  });

  if (compatibilityData) {
    await input.tx.user.update({
      where: { id: input.userId },
      data: compatibilityData,
    });
  }
}

export async function createProvisionedPortalUser(input: {
  tx: ProvisioningTx;
  email: string;
  name: string | null;
  role: ProvisionedUserRole;
  orgId: string | null;
  calendarAccessRole?: CalendarAccessRole;
  phoneE164?: string | null;
  timezone?: string | null;
  mustChangePassword?: boolean;
}): Promise<ProvisionedUserRecord> {
  const user = await input.tx.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      ...(input.calendarAccessRole ? { calendarAccessRole: input.calendarAccessRole } : {}),
      ...(input.phoneE164 !== undefined ? { phoneE164: input.phoneE164 } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      // Keep legacy orgId only as the default workspace hint during rollout.
      orgId: input.role === "CLIENT" ? input.orgId : null,
      mustChangePassword: input.mustChangePassword ?? true,
    },
    select: {
      id: true,
      email: true,
      calendarAccessRole: true,
    },
  });

  if (input.role === "CLIENT") {
    if (!input.orgId) {
      throw new Error("Client users must be assigned to an organization.");
    }

    await syncClientUserOrganizationAccess({
      tx: input.tx,
      userId: user.id,
      organizationId: input.orgId,
      role: user.calendarAccessRole,
    });
  }

  return user;
}
