import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const seedDatabaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(
  seedDatabaseUrl
    ? {
        datasources: {
          db: {
            url: seedDatabaseUrl,
          },
        },
      }
    : undefined,
);

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function hoursFromNow(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

async function ensureOrganization(name) {
  const existing = await prisma.organization.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.organization.create({ data: { name } });
}

async function main() {
  const [orgLandscaping, orgRoofing] = await Promise.all([
    ensureOrganization("TieGui Demo Landscaping"),
    ensureOrganization("TieGui Demo Roofing"),
  ]);

  const passwordHash = await hash("TieGui123!", 12);

  const deven = await prisma.user.upsert({
    where: { email: "deven@tiegui.com" },
    update: {
      name: "Deven",
      role: "INTERNAL",
      orgId: null,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
    create: {
      name: "Deven",
      email: "deven@tiegui.com",
      role: "INTERNAL",
      orgId: null,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
  });

  const marcus = await prisma.user.upsert({
    where: { email: "marcus@tiegui.com" },
    update: {
      name: "Marcus",
      role: "INTERNAL",
      orgId: null,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
    create: {
      name: "Marcus",
      email: "marcus@tiegui.com",
      role: "INTERNAL",
      orgId: null,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
  });

  await prisma.user.upsert({
    where: { email: "client@tiegui-demo-landscaping.com" },
    update: {
      name: "Demo Client",
      role: "CLIENT",
      orgId: orgLandscaping.id,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
    create: {
      name: "Demo Client",
      email: "client@tiegui-demo-landscaping.com",
      role: "CLIENT",
      orgId: orgLandscaping.id,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
  });

  const orgIds = [orgLandscaping.id, orgRoofing.id];

  await prisma.$transaction([
    prisma.event.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.message.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.call.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.lead.deleteMany({ where: { orgId: { in: orgIds } } }),
  ]);

  await prisma.lead.create({
    data: {
      orgId: orgLandscaping.id,
      assignedToUserId: deven.id,
      status: "NEW",
      priority: "HIGH",
      businessName: "Evergreen Lawn Co.",
      contactName: "Carlos Rivera",
      phoneE164: "+12065550101",
      city: "Seattle",
      businessType: "Landscaping",
      leadSource: "FORM",
      nextFollowUpAt: hoursFromNow(4),
      notes: "Requested estimate for spring cleanup.",
    },
  });

  const lead2 = await prisma.lead.create({
    data: {
      orgId: orgLandscaping.id,
      assignedToUserId: marcus.id,
      status: "FOLLOW_UP",
      priority: "MEDIUM",
      businessName: "Greenline Yard Pros",
      contactName: "Alyssa Kim",
      phoneE164: "+12065550102",
      city: "Bellevue",
      businessType: "Landscaping",
      leadSource: "CALL",
      firstContactedAt: daysFromNow(-2),
      lastContactedAt: daysFromNow(-1),
      nextFollowUpAt: hoursFromNow(-6),
      notes: "Wants bi-weekly maintenance package.",
    },
  });

  const lead3 = await prisma.lead.create({
    data: {
      orgId: orgLandscaping.id,
      assignedToUserId: deven.id,
      status: "BOOKED",
      priority: "LOW",
      businessName: "Northside Turf",
      contactName: "Jordan Lee",
      phoneE164: "+12065550103",
      city: "Tacoma",
      businessType: "Landscaping",
      leadSource: "REFERRAL",
      firstContactedAt: daysFromNow(-6),
      lastContactedAt: daysFromNow(-3),
      notes: "Booked seasonal maintenance demo.",
    },
  });

  const lead4 = await prisma.lead.create({
    data: {
      orgId: orgRoofing.id,
      assignedToUserId: marcus.id,
      status: "CALLED_NO_ANSWER",
      priority: "HIGH",
      businessName: "Summit Roofing Group",
      contactName: "Priya Nair",
      phoneE164: "+12065550104",
      city: "Portland",
      businessType: "Roofing",
      leadSource: "FB",
      firstContactedAt: daysFromNow(-1),
      lastContactedAt: daysFromNow(-1),
      nextFollowUpAt: hoursFromNow(20),
      notes: "Interested in storm-season campaign.",
    },
  });

  const lead5 = await prisma.lead.create({
    data: {
      orgId: orgRoofing.id,
      assignedToUserId: deven.id,
      status: "INTERESTED",
      priority: "MEDIUM",
      businessName: "Atlas Roofing & Exteriors",
      contactName: "Diego Morales",
      phoneE164: "+12065550105",
      city: "Spokane",
      businessType: "Roofing",
      leadSource: "OTHER",
      firstContactedAt: daysFromNow(-4),
      lastContactedAt: daysFromNow(-1),
      nextFollowUpAt: daysFromNow(2),
      notes: "Needs proposal before Friday.",
    },
  });

  await prisma.call.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead2.id,
        fromNumberE164: "+12065550100",
        toNumberE164: lead2.phoneE164,
        direction: "OUTBOUND",
        status: "MISSED",
        startedAt: hoursFromNow(-7),
      },
      {
        orgId: orgRoofing.id,
        leadId: lead4.id,
        fromNumberE164: "+12065550100",
        toNumberE164: lead4.phoneE164,
        direction: "OUTBOUND",
        status: "VOICEMAIL",
        startedAt: hoursFromNow(-18),
      },
    ],
  });

  await prisma.message.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead2.id,
        direction: "OUTBOUND",
        fromNumberE164: "+12065550100",
        toNumberE164: lead2.phoneE164,
        body: "Following up on your landscaping ad campaign request.",
        provider: "TWILIO",
        status: "SENT",
      },
      {
        orgId: orgRoofing.id,
        leadId: lead5.id,
        direction: "INBOUND",
        fromNumberE164: lead5.phoneE164,
        toNumberE164: "+12065550100",
        body: "Can we push the demo to Wednesday afternoon?",
        provider: "TWILIO",
        status: "DELIVERED",
      },
    ],
  });

  await prisma.event.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead3.id,
        type: "DEMO",
        title: "Landscaping Demo Call",
        description: "Walk through campaign setup and conversion tracking.",
        startAt: daysFromNow(1),
        assignedToUserId: deven.id,
      },
      {
        orgId: orgRoofing.id,
        leadId: lead5.id,
        type: "ONBOARDING",
        title: "Roofing Onboarding Kickoff",
        description: "Collect assets and launch checklist.",
        startAt: daysFromNow(3),
        assignedToUserId: marcus.id,
      },
      {
        orgId: orgRoofing.id,
        type: "TASK",
        title: "Review ad spend pacing",
        description: "Confirm budget split across top campaigns.",
        startAt: daysFromNow(2),
        assignedToUserId: deven.id,
      },
    ],
  });

  console.log("Seed complete.");
  console.log("Internal users: deven@tiegui.com, marcus@tiegui.com");
  console.log("Client user: client@tiegui-demo-landscaping.com");
  console.log("Password for all seeded users: TieGui123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
