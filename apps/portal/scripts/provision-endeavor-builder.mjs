import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BRUCE_EMAIL = "bruce@endeavorhomesnw.com";

async function main() {
  const existing = await prisma.organization.findFirst({
    where: { name: "Endeavor Homes NW" },
    select: { id: true },
  });
  const orgData = {
    legalName: "Endeavor Homes NW",
    email: "contact@endeavorhomesnw.com",
    phone: "253-353-2657",
    website: "https://endeavorhomesnw.com",
    portalVertical: "HOMEBUILDER",
    estimatePrefix: "CO",
    invoicePrefix: "PAY",
    purchaseOrderPrefix: "PO",
    smsGreetingLine: "Thanks for reaching out to Endeavor Homes NW.",
    smsWorkingHoursText:
      "We help with factory-built homes, ADUs, land fit, financing, delivery, setup, and move-in planning.",
    smsWebsiteSignature: "Endeavor Homes NW | endeavorhomesnw.com",
  };
  const org = existing
    ? await prisma.organization.update({
        where: { id: existing.id },
        data: orgData,
      })
    : await prisma.organization.create({
        data: {
          name: "Endeavor Homes NW",
          ...orgData,
        },
      });

  const user = await prisma.user.upsert({
    where: { email: BRUCE_EMAIL },
    update: {
      name: "Bruce Schmidt",
      role: "CLIENT",
      orgId: org.id,
      calendarAccessRole: "OWNER",
    },
    create: {
      email: BRUCE_EMAIL,
      name: "Bruce Schmidt",
      role: "CLIENT",
      orgId: org.id,
      calendarAccessRole: "OWNER",
      mustChangePassword: true,
    },
    select: { id: true, email: true },
  });

  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    update: {
      role: "OWNER",
      status: "ACTIVE",
    },
    create: {
      organizationId: org.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  console.log(`Provisioned ${org.name} (${org.id})`);
  console.log(`Owner: ${user.email}`);
  console.log("Set the user's password through the normal admin/password reset flow before sharing login access.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
