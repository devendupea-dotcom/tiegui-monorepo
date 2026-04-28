CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "AgencyRole" AS ENUM ('OWNER', 'ADMIN', 'SUPPORT');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Organization"
ADD COLUMN "agencyId" TEXT;

CREATE TABLE "AgencyMembership" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AgencyRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CalendarAccessRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Organization_agencyId_idx"
ON "Organization"("agencyId");

CREATE UNIQUE INDEX "AgencyMembership_agencyId_userId_key"
ON "AgencyMembership"("agencyId", "userId");

CREATE INDEX "AgencyMembership_agencyId_status_idx"
ON "AgencyMembership"("agencyId", "status");

CREATE INDEX "AgencyMembership_userId_status_idx"
ON "AgencyMembership"("userId", "status");

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key"
ON "OrganizationMembership"("organizationId", "userId");

CREATE INDEX "OrganizationMembership_organizationId_status_idx"
ON "OrganizationMembership"("organizationId", "status");

CREATE INDEX "OrganizationMembership_userId_status_idx"
ON "OrganizationMembership"("userId", "status");

ALTER TABLE "Organization"
ADD CONSTRAINT "Organization_agencyId_fkey"
FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "AgencyMembership"
ADD CONSTRAINT "AgencyMembership_agencyId_fkey"
FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "AgencyMembership"
ADD CONSTRAINT "AgencyMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "OrganizationMembership"
ADD CONSTRAINT "OrganizationMembership_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "OrganizationMembership"
ADD CONSTRAINT "OrganizationMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
