import { PrismaClient, type AgencyRole, type Role } from "@prisma/client";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const envFile = getArgValue("--env-file");
loadPrismaEnv(envFile || undefined);

const APPLY = process.argv.includes("--apply");
const AGENCY_NAME = (getArgValue("--agency-name") || "TieGui Solutions").trim();
const ORG_ID = (getArgValue("--org-id") || "").trim() || null;
const INCLUDE_INTERNAL_USERS = process.argv.includes("--grant-internal-users");
const INTERNAL_ROLE = normalizeAgencyRole(getArgValue("--internal-role") || "SUPPORT");
const SAMPLE_LIMIT = Math.max(1, Math.min(50, Number.parseInt(getArgValue("--sample-limit") || "10", 10) || 10));

const prisma = new PrismaClient();

type BackfillSample = {
  kind: string;
  detail: string;
};

function normalizeAgencyRole(value: string): AgencyRole {
  switch (value) {
    case "OWNER":
    case "ADMIN":
    case "SUPPORT":
      return value;
    default:
      throw new Error(`Unsupported --internal-role value: ${value}`);
  }
}

function asSample(kind: string, detail: string): BackfillSample {
  return { kind, detail };
}

function samplePush(samples: BackfillSample[], sample: BackfillSample) {
  if (samples.length < SAMPLE_LIMIT) {
    samples.push(sample);
  }
}

function getMissingSchemaMessage(error: unknown): string | null {
  const tableName =
    typeof error === "object"
    && error !== null
    && "meta" in error
    && typeof error.meta === "object"
    && error.meta !== null
    && "table" in error.meta
    && typeof error.meta.table === "string"
      ? error.meta.table
      : null;

  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2021"
    && tableName
    && (tableName.endsWith("Agency") || tableName.endsWith("OrganizationMembership") || tableName.endsWith("AgencyMembership"))
  ) {
    return "Tenant-access backfill requires the Agency/OrganizationMembership migration. Apply database migrations before running this command.";
  }

  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2022"
    && "meta" in error
    && typeof error.meta === "object"
    && error.meta !== null
    && "column" in error.meta
    && error.meta.column === "Organization.agencyId"
  ) {
    return "Tenant-access backfill requires the Organization.agencyId migration. Apply database migrations before running this command.";
  }

  return null;
}

async function main() {
  const samples: BackfillSample[] = [];
  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    agencyName: AGENCY_NAME,
    orgScope: ORG_ID || "all",
    createdAgency: false,
    attachedOrganizations: 0,
    organizationsAlreadyAttached: 0,
    organizationsAssignedElsewhere: 0,
    createdOrganizationMemberships: 0,
    existingOrganizationMemberships: 0,
    organizationMembershipRoleMismatches: 0,
    usersWithMissingOrganizations: 0,
    createdAgencyMemberships: 0,
    existingAgencyMemberships: 0,
  };

  let agency = await prisma.agency.findFirst({
    where: { name: AGENCY_NAME },
    select: { id: true, name: true },
  });

  if (!agency && APPLY) {
    agency = await prisma.agency.create({
      data: {
        name: AGENCY_NAME,
      },
      select: { id: true, name: true },
    });
    summary.createdAgency = true;
  }

  const organizations = await prisma.organization.findMany({
    where: ORG_ID ? { id: ORG_ID } : undefined,
    select: {
      id: true,
      name: true,
      agencyId: true,
      agency: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  if (ORG_ID && organizations.length === 0) {
    throw new Error(`Organization ${ORG_ID} was not found.`);
  }

  const knownOrgIds = new Set(organizations.map((organization) => organization.id));

  for (const organization of organizations) {
    if (!agency) {
      samplePush(samples, asSample("organization_pending_attach", `orgId=${organization.id} name=${organization.name}`));
      continue;
    }

    if (!organization.agencyId) {
      if (APPLY) {
        await prisma.organization.update({
          where: { id: organization.id },
          data: { agencyId: agency.id },
        });
      }
      summary.attachedOrganizations += 1;
      samplePush(samples, asSample("organization_attached", `orgId=${organization.id} name=${organization.name} agency=${agency.name}`));
      continue;
    }

    if (organization.agencyId === agency.id) {
      summary.organizationsAlreadyAttached += 1;
      continue;
    }

    summary.organizationsAssignedElsewhere += 1;
    samplePush(
      samples,
      asSample(
        "organization_assigned_elsewhere",
        `orgId=${organization.id} name=${organization.name} currentAgency=${organization.agency?.name || organization.agencyId}`,
      ),
    );
  }

  const userOrFilters: Array<{ orgId?: { not: null }; role?: Role }> = [{ orgId: { not: null } }];
  if (INCLUDE_INTERNAL_USERS) {
    userOrFilters.push({ role: "INTERNAL" });
  }

  const users = await prisma.user.findMany({
    where: {
      OR: userOrFilters,
    },
    select: {
      id: true,
      email: true,
      role: true,
      orgId: true,
      calendarAccessRole: true,
    },
    orderBy: { email: "asc" },
  });

  const organizationMemberships = await prisma.organizationMembership.findMany({
    where: ORG_ID ? { organizationId: ORG_ID } : undefined,
    select: {
      organizationId: true,
      userId: true,
      role: true,
    },
  });

  const membershipByKey = new Map(
    organizationMemberships.map((membership) => [`${membership.organizationId}:${membership.userId}`, membership]),
  );

  const agencyMembershipByUserId = new Map<string, { role: AgencyRole }>();
  if (INCLUDE_INTERNAL_USERS && agency) {
    const agencyMemberships = await prisma.agencyMembership.findMany({
      where: {
        agencyId: agency.id,
      },
      select: {
        userId: true,
        role: true,
      },
    });

    for (const membership of agencyMemberships) {
      agencyMembershipByUserId.set(membership.userId, { role: membership.role });
    }
  }

  for (const user of users) {
    if (user.orgId) {
      const key = `${user.orgId}:${user.id}`;
      const existingMembership = membershipByKey.get(key);
      if (existingMembership) {
        summary.existingOrganizationMemberships += 1;
        if (existingMembership.role !== user.calendarAccessRole) {
          summary.organizationMembershipRoleMismatches += 1;
          samplePush(
            samples,
            asSample(
              "organization_membership_role_mismatch",
              `user=${user.email} orgId=${user.orgId} existingRole=${existingMembership.role} legacyRole=${user.calendarAccessRole}`,
            ),
          );
        }
      } else {
        const orgExists = knownOrgIds.has(user.orgId)
          || Boolean(await prisma.organization.findUnique({ where: { id: user.orgId }, select: { id: true } }));

        if (!orgExists) {
          summary.usersWithMissingOrganizations += 1;
          samplePush(samples, asSample("user_org_missing", `user=${user.email} orgId=${user.orgId}`));
        } else {
          if (APPLY) {
            await prisma.organizationMembership.create({
              data: {
                organizationId: user.orgId,
                userId: user.id,
                role: user.calendarAccessRole,
              },
            });
          }
          summary.createdOrganizationMemberships += 1;
          samplePush(
            samples,
            asSample(
              "organization_membership_created",
              `user=${user.email} orgId=${user.orgId} role=${user.calendarAccessRole}`,
            ),
          );
        }
      }
    }

    if (INCLUDE_INTERNAL_USERS && user.role === "INTERNAL" && agency) {
      const existingAgencyMembership = agencyMembershipByUserId.get(user.id);

      if (existingAgencyMembership) {
        summary.existingAgencyMemberships += 1;
      } else {
        if (APPLY) {
          await prisma.agencyMembership.create({
            data: {
              agencyId: agency.id,
              userId: user.id,
              role: INTERNAL_ROLE,
            },
          });
        }
        summary.createdAgencyMemberships += 1;
        samplePush(
          samples,
          asSample(
            "agency_membership_created",
            `user=${user.email} agency=${agency.name} role=${INTERNAL_ROLE}`,
          ),
        );
      }
    }
  }

  console.log(
    [
      "[backfill-tenant-access]",
      `mode=${summary.mode}`,
      `agency=${summary.agencyName}`,
      `orgScope=${summary.orgScope}`,
      `createdAgency=${summary.createdAgency}`,
      `attachedOrganizations=${summary.attachedOrganizations}`,
      `organizationsAlreadyAttached=${summary.organizationsAlreadyAttached}`,
      `organizationsAssignedElsewhere=${summary.organizationsAssignedElsewhere}`,
      `createdOrganizationMemberships=${summary.createdOrganizationMemberships}`,
      `existingOrganizationMemberships=${summary.existingOrganizationMemberships}`,
      `organizationMembershipRoleMismatches=${summary.organizationMembershipRoleMismatches}`,
      `usersWithMissingOrganizations=${summary.usersWithMissingOrganizations}`,
      `createdAgencyMemberships=${summary.createdAgencyMemberships}`,
      `existingAgencyMemberships=${summary.existingAgencyMemberships}`,
    ].join(" "),
  );

  for (const sample of samples) {
    console.log(`[backfill-tenant-access] sample ${sample.kind} ${sample.detail}`);
  }
}

try {
  await main();
} catch (error) {
  const schemaMessage = getMissingSchemaMessage(error);
  if (schemaMessage) {
    console.error(`[backfill-tenant-access] ${schemaMessage}`);
    process.exit(1);
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
