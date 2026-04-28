CREATE TYPE "PortalVertical" AS ENUM ('CONTRACTOR', 'HOMEBUILDER');

ALTER TABLE "Organization"
ADD COLUMN "portalVertical" "PortalVertical" NOT NULL DEFAULT 'CONTRACTOR';

CREATE TABLE "CustomerPortalAccount" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerPortalAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerPortalAccount_orgId_email_key"
ON "CustomerPortalAccount"("orgId", "email");

CREATE UNIQUE INDEX "CustomerPortalAccount_orgId_customerId_key"
ON "CustomerPortalAccount"("orgId", "customerId");

CREATE UNIQUE INDEX "CustomerPortalAccount_customerId_key"
ON "CustomerPortalAccount"("customerId");

CREATE INDEX "CustomerPortalAccount_orgId_status_idx"
ON "CustomerPortalAccount"("orgId", "status");

CREATE INDEX "CustomerPortalAccount_userId_idx"
ON "CustomerPortalAccount"("userId");

CREATE INDEX "Organization_portalVertical_idx"
ON "Organization"("portalVertical");

ALTER TABLE "CustomerPortalAccount"
ADD CONSTRAINT "CustomerPortalAccount_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAccount"
ADD CONSTRAINT "CustomerPortalAccount_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerPortalAccount"
ADD CONSTRAINT "CustomerPortalAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
