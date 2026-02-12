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

  await prisma.organization.update({
    where: { id: orgLandscaping.id },
    data: {
      smsFromNumberE164: "+12065550100",
      missedCallAutoReplyOn: true,
      missedCallAutoReplyBody:
        "Hey! Sorry we missed your call. Reply here and we will text you back shortly.",
      intakeAutomationEnabled: true,
      intakeAskLocationBody: "What city are you located in?",
      intakeAskWorkTypeBody: "What type of landscaping work do you need?",
      intakeAskCallbackBody: "What day/time works best for a callback or estimate?",
      intakeCompletionBody: "Perfect, we have you down for {{time}}. Talk soon.",
    },
  });

  await prisma.organization.update({
    where: { id: orgRoofing.id },
    data: {
      smsFromNumberE164: "+12065550110",
      missedCallAutoReplyOn: true,
      missedCallAutoReplyBody:
        "Thanks for calling TieGui Roofing. Text us your name + best callback time and we will follow up.",
      intakeAutomationEnabled: true,
      intakeAskLocationBody: "What city is the property in?",
      intakeAskWorkTypeBody: "What kind of roofing work do you need?",
      intakeAskCallbackBody: "What time works best for your estimate call?",
      intakeCompletionBody: "Great, you are scheduled for {{time}}. We will call you then.",
    },
  });

  const passwordHash = await hash("TieGui123!", 12);

  const deven = await prisma.user.upsert({
    where: { email: "deven@tiegui.com" },
    update: {
      name: "Deven",
      role: "INTERNAL",
      calendarAccessRole: "OWNER",
      orgId: null,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
    create: {
      name: "Deven",
      email: "deven@tiegui.com",
      role: "INTERNAL",
      calendarAccessRole: "OWNER",
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
      calendarAccessRole: "ADMIN",
      orgId: null,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
    create: {
      name: "Marcus",
      email: "marcus@tiegui.com",
      role: "INTERNAL",
      calendarAccessRole: "ADMIN",
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
      calendarAccessRole: "OWNER",
      orgId: orgLandscaping.id,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
    create: {
      name: "Demo Client",
      email: "client@tiegui-demo-landscaping.com",
      role: "CLIENT",
      calendarAccessRole: "OWNER",
      orgId: orgLandscaping.id,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    },
  });

  const orgIds = [orgLandscaping.id, orgRoofing.id];

  await prisma.$transaction([
    prisma.calendarEventWorker.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.calendarHold.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.timeOff.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.workingHours.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.portableNote.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.portablePayment.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.portableInvoiceLineItem.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.portableInvoice.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.portableJob.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.portableCustomer.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.importRun.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.integrationOAuthState.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.integrationAccount.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.budgetRequest.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.adSpendEntry.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.orgDashboardConfig.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.event.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.smsTemplate.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.message.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.call.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.leadPhoto.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.leadMeasurement.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.leadNote.deleteMany({ where: { orgId: { in: orgIds } } }),
    prisma.lead.deleteMany({ where: { orgId: { in: orgIds } } }),
  ]);

  await prisma.orgDashboardConfig.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        adsPaused: false,
        dailyBudgetCents: 25000,
        missedCallMessage:
          "Hey! Sorry we missed your call. Reply here and we will text you back shortly.",
        jobReminderMinutesBefore: 120,
        googleReviewUrl: "https://g.page/r/tiegui-landscaping/review",
        allowOverlaps: false,
        weekStartsOn: 0,
        defaultSlotMinutes: 30,
        defaultUntimedStartHour: 9,
        calendarTimezone: "America/Los_Angeles",
      },
      {
        orgId: orgRoofing.id,
        adsPaused: false,
        dailyBudgetCents: 30000,
        missedCallMessage:
          "Thanks for calling TieGui Roofing. Reply here and we can still get you scheduled.",
        jobReminderMinutesBefore: 120,
        googleReviewUrl: "https://g.page/r/tiegui-roofing/review",
        allowOverlaps: false,
        weekStartsOn: 0,
        defaultSlotMinutes: 30,
        defaultUntimedStartHour: 9,
        calendarTimezone: "America/Los_Angeles",
      },
    ],
  });

  await prisma.workingHours.createMany({
    data: [
      ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
        orgId: orgLandscaping.id,
        workerUserId: deven.id,
        dayOfWeek,
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        timezone: "America/Los_Angeles",
      })),
      ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
        orgId: orgLandscaping.id,
        workerUserId: marcus.id,
        dayOfWeek,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
        timezone: "America/Los_Angeles",
      })),
      ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
        orgId: orgRoofing.id,
        workerUserId: deven.id,
        dayOfWeek,
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        timezone: "America/Los_Angeles",
      })),
      ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
        orgId: orgRoofing.id,
        workerUserId: marcus.id,
        dayOfWeek,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
        timezone: "America/Los_Angeles",
      })),
    ],
  });

  await prisma.smsTemplate.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        name: "New Lead Intro",
        body: "Hey {{name}}, thanks for reaching out. Want me to send over pricing options?",
      },
      {
        orgId: orgLandscaping.id,
        name: "Follow-up",
        body: "Quick follow-up on your landscaping request. Do you have 10 minutes tomorrow for a call?",
      },
      {
        orgId: orgRoofing.id,
        name: "Missed Call Follow-up",
        body: "Sorry we missed you. Want to schedule a quick roofing quote call?",
      },
      {
        orgId: orgRoofing.id,
        name: "Demo Invite",
        body: "We can walk you through the campaign setup in a 15-minute demo this week.",
      },
    ],
  });

  const lead1 = await prisma.lead.create({
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
      estimatedRevenueCents: 1250000,
      invoiceStatus: "DRAFT_READY",
      invoiceDraftText:
        "Invoice draft for Northside Turf\\n- Seasonal maintenance package\\n- Spring cleanup\\n- Travel + setup\\n\\nTotal estimate: $12,500",
      invoiceDueAt: daysFromNow(7),
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
      estimatedRevenueCents: 890000,
      nextFollowUpAt: daysFromNow(2),
      notes: "Needs proposal before Friday.",
    },
  });

  const demoPhotoDataUrl =
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='#dcecff'/><text x='40' y='190' font-size='34' fill='#1f4f83' font-family='Arial'>Site Photo</text></svg>`,
    ).toString("base64");

  await prisma.leadNote.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead1.id,
        createdByUserId: deven.id,
        body: "Customer asked for weekly lawn maintenance and edging.",
      },
      {
        orgId: orgLandscaping.id,
        leadId: lead3.id,
        createdByUserId: marcus.id,
        body: "Measured full front yard and confirmed sprinkler access points.",
      },
      {
        orgId: orgRoofing.id,
        leadId: lead5.id,
        createdByUserId: deven.id,
        body: "Wants quote split for labor vs. material line items.",
      },
    ],
  });

  await prisma.leadMeasurement.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead3.id,
        createdByUserId: deven.id,
        label: "Front Yard Width",
        value: "48",
        unit: "ft",
        notes: "Fence to driveway",
      },
      {
        orgId: orgLandscaping.id,
        leadId: lead3.id,
        createdByUserId: deven.id,
        label: "Front Yard Length",
        value: "72",
        unit: "ft",
      },
      {
        orgId: orgRoofing.id,
        leadId: lead5.id,
        createdByUserId: marcus.id,
        label: "Roof Surface",
        value: "2800",
        unit: "sqft",
      },
    ],
  });

  await prisma.leadPhoto.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead3.id,
        createdByUserId: deven.id,
        fileName: "front-yard.svg",
        mimeType: "image/svg+xml",
        imageDataUrl: demoPhotoDataUrl,
        caption: "Front yard before cleanup",
      },
      {
        orgId: orgRoofing.id,
        leadId: lead5.id,
        createdByUserId: marcus.id,
        fileName: "roof-angle.svg",
        mimeType: "image/svg+xml",
        imageDataUrl: demoPhotoDataUrl,
        caption: "Main slope photo from driveway",
      },
    ],
  });

  await prisma.call.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        leadId: lead2.id,
        fromNumberE164: "+12065550100",
        toNumberE164: lead2.phoneE164,
        trackingNumberE164: "+12065550100",
        landingPageUrl: "https://demo-landscaping.tiegui.com/quote",
        utmCampaign: "spring_cleanup",
        gclid: "demo-gclid-landscaping-123",
        attributionSource: "PAID",
        direction: "OUTBOUND",
        status: "MISSED",
        startedAt: hoursFromNow(-7),
      },
      {
        orgId: orgRoofing.id,
        leadId: lead4.id,
        fromNumberE164: "+12065550110",
        toNumberE164: lead4.phoneE164,
        trackingNumberE164: "+12065550110",
        landingPageUrl: "https://demo-roofing.tiegui.com/contact",
        attributionSource: "ORGANIC",
        direction: "OUTBOUND",
        status: "VOICEMAIL",
        startedAt: hoursFromNow(-18),
      },
    ],
  });

  await prisma.budgetRequest.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        requestedByUserId: deven.id,
        requestedDailyCents: 32500,
        note: "Need additional budget for spring service demand.",
        status: "PENDING",
      },
      {
        orgId: orgRoofing.id,
        requestedByUserId: marcus.id,
        reviewedByUserId: deven.id,
        requestedDailyCents: 28000,
        note: "Storm week budget increase approved.",
        status: "APPROVED",
        reviewedAt: daysFromNow(-1),
      },
    ],
  });

  await prisma.adSpendEntry.createMany({
    data: [
      {
        orgId: orgLandscaping.id,
        createdByUserId: deven.id,
        spendDate: daysFromNow(-6),
        amountCents: 180000,
        source: "Google Ads",
        note: "Launch week spend",
      },
      {
        orgId: orgLandscaping.id,
        createdByUserId: deven.id,
        spendDate: daysFromNow(-3),
        amountCents: 220000,
        source: "Google Ads",
        note: "Peak weekday spend",
      },
      {
        orgId: orgRoofing.id,
        createdByUserId: marcus.id,
        spendDate: daysFromNow(-5),
        amountCents: 140000,
        source: "Google Ads",
        note: "Storm season campaign",
      },
      {
        orgId: orgRoofing.id,
        createdByUserId: marcus.id,
        spendDate: daysFromNow(-2),
        amountCents: 165000,
        source: "Google Ads",
        note: "Retargeting + branded search",
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

  const seededEvents = await prisma.event.findMany({
    where: {
      orgId: { in: orgIds },
      assignedToUserId: { not: null },
    },
    select: {
      id: true,
      orgId: true,
      assignedToUserId: true,
    },
  });

  if (seededEvents.length > 0) {
    await prisma.calendarEventWorker.createMany({
      data: seededEvents
        .filter((event) => Boolean(event.assignedToUserId))
        .map((event) => ({
          orgId: event.orgId,
          eventId: event.id,
          workerUserId: event.assignedToUserId,
        })),
      skipDuplicates: true,
    });
  }

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
