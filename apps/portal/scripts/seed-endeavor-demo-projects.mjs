import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

const prisma = new PrismaClient();

const ENDEAVOR_ORG_NAME = "Endeavor Homes NW";
const BRUCE_EMAIL = "bruce@endeavorhomesnw.com";
const FROM_NUMBER_E164 = "+12533532657";

const baseUrl = (
  process.env.PORTAL_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3001"
).replace(/\/$/, "");

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function dollarsToCents(amount) {
  return Math.round(amount * 100);
}

const demoProjects = [
  {
    marker: "endeavor-demo-flow:website-inquiry",
    sourcePath: "/demo/endeavor-flow/website-inquiry",
    customer: {
      name: "Maya Thompson",
      phoneE164: "+15005550101",
      email: "maya.demo@example.com",
      addressLine: "Tacoma, WA",
    },
    lead: {
      status: "NEW",
      priority: "HIGH",
      city: "Tacoma",
      estimatedRevenueCents: dollarsToCents(75495),
      notes:
        "Demo Endeavor inquiry from the website. Interested in compact living and wants to understand park model fit, financing, and placement requirements.",
    },
    buyerProject: {
      projectType: "PARK_MODEL",
      currentStage: "COMPARE_HOMES",
      projectName: "Maya Thompson - Park Model 522 Urban Cottage",
      selectedHomeSlug: "park-model-522-urban-cottage",
      selectedHomeTitle: "Park Model 522 Urban Cottage",
      selectedHomeType: "Tiny Homes and Park Model RV's",
      selectedHomeTypeSlug: "tiny-homes-park-model-rvs",
      selectedHomeCollection: "factory",
      selectedHomePriceLabel: "Starting as low as $75,495",
      selectedHomeBeds: 1,
      selectedHomeBathsLabel: "1",
      selectedHomeSqft: 522,
      selectedHomeStatus: "Available model",
      selectedHomeLocationLabel: "Factory-built park model",
      selectedHomeUrl:
        "https://endeavorhomesnw.com/factory-homes/park-model-522-urban-cottage",
      sourcePageTitle: "Park Model 522 Urban Cottage",
      budgetRange: "Under $100k starting point",
      financingStatus: "Needs financing options",
      landStatus: "Land not selected yet",
      timeline: "3-6 months",
      buyerGoal:
        "Compare compact home options and understand whether a park model fits their property and lifestyle.",
      buyerNextStep:
        "Review compact-living fit, utility requirements, and financing path.",
      internalNextStep:
        "Call Maya, confirm intended placement, and send the first financing/land checklist.",
      publicNotes:
        "Endeavor received your park model inquiry and is preparing next-step guidance around placement, utilities, and financing.",
      smsOptIn: true,
    },
    messages: [
      {
        suffix: "inbound-1",
        direction: "INBOUND",
        body: "Hi Endeavor, I saw the Park Model 522 Urban Cottage and wanted to know what the next step is.",
        createdAt: hoursAgo(30),
      },
      {
        suffix: "outbound-1",
        direction: "OUTBOUND",
        body: "Thanks Maya. We created a project tracker for you and will start with park model fit, land placement, and financing options.",
        createdAt: hoursAgo(29.5),
      },
    ],
  },
  {
    marker: "endeavor-demo-flow:land-financing",
    sourcePath: "/demo/endeavor-flow/land-financing",
    customer: {
      name: "Jordan Lee",
      phoneE164: "+15005550102",
      email: "jordan.demo@example.com",
      addressLine: "Olympia, WA",
    },
    lead: {
      status: "FOLLOW_UP",
      priority: "MEDIUM",
      city: "Olympia",
      estimatedRevenueCents: dollarsToCents(190000),
      notes:
        "Demo Endeavor buyer project. Customer is deciding on an ADU/DADU plan and needs backyard feasibility, utilities, and financing clarity.",
    },
    buyerProject: {
      projectType: "ADU_DADU",
      currentStage: "LAND_FEASIBILITY",
      projectName: "Jordan Lee - DreamWorks 1,067 sq ft",
      selectedHomeSlug: "dreamworks-1067-sq-ft",
      selectedHomeTitle: "DreamWorks 1,067 sq ft",
      selectedHomeType: "DADU / ADU",
      selectedHomeTypeSlug: "dadu-adu",
      selectedHomeCollection: "factory",
      selectedHomePriceLabel: "Base price reference: $126,450",
      selectedHomeBeds: 2,
      selectedHomeBathsLabel: "2",
      selectedHomeSqft: 1067,
      selectedHomeStatus: "Planning fit",
      selectedHomeLocationLabel: "Backyard ADU/DADU candidate",
      selectedHomeUrl:
        "https://endeavorhomesnw.com/factory-homes/dreamworks-1067-sq-ft",
      sourcePageTitle: "DreamWorks 1,067 sq ft",
      budgetRange: "$150k-$250k all-in planning",
      financingStatus: "Comparing cash plus construction financing",
      landStatus: "Backyard access and utilities under review",
      timeline: "6-9 months",
      buyerGoal:
        "Confirm whether the DreamWorks ADU can fit the property and align with financing.",
      buyerNextStep:
        "Upload site photos and confirm utility access so Endeavor can advise on feasibility.",
      internalNextStep:
        "Review access, setback, and utility assumptions before moving to contract scope.",
      publicNotes:
        "Endeavor is reviewing your ADU path, including land fit, access, utilities, and financing assumptions.",
      smsOptIn: true,
    },
    messages: [
      {
        suffix: "inbound-1",
        direction: "INBOUND",
        body: "We like the DreamWorks 1067 ADU but need to know if it works behind our house.",
        createdAt: hoursAgo(74),
      },
      {
        suffix: "outbound-1",
        direction: "OUTBOUND",
        body: "Great. Send over a few site photos and we will track land fit, financing, and model selection in your project room.",
        createdAt: hoursAgo(73),
      },
      {
        suffix: "inbound-2",
        direction: "INBOUND",
        body: "Photos are coming today. We are also comparing financing options.",
        createdAt: hoursAgo(18),
      },
    ],
  },
  {
    marker: "endeavor-demo-flow:active-contract",
    sourcePath: "/demo/endeavor-flow/active-contract",
    customer: {
      name: "Elena Parker",
      phoneE164: "+15005550103",
      email: "elena.demo@example.com",
      addressLine: "Shelton, WA",
    },
    lead: {
      status: "BOOKED",
      priority: "HIGH",
      city: "Shelton",
      estimatedRevenueCents: dollarsToCents(335000),
      notes:
        "Demo active contract project. Customer is attached to a presale home and needs contract, deposit, change order, and build-update visibility.",
    },
    buyerProject: {
      projectType: "PRESALE",
      currentStage: "SETUP_FINISH",
      projectName: "Elena Parker - 203 Oak St., Shelton WA",
      selectedHomeSlug: "203-oak-st-shelton-wa",
      selectedHomeTitle: "203 Oak St., Shelton WA",
      selectedHomeType: "Manufactured Homes",
      selectedHomeTypeSlug: "manufactured-homes",
      selectedHomeCollection: "presale",
      selectedHomePriceLabel: "Presale project",
      selectedHomeBeds: 3,
      selectedHomeBathsLabel: "2",
      selectedHomeSqft: 1600,
      selectedHomeStatus: "Active contract",
      selectedHomeLocationLabel: "Shelton, WA",
      selectedHomeUrl:
        "https://endeavorhomesnw.com/presale-homes/203-oak-st-shelton-wa",
      sourcePageTitle: "203 Oak St., Shelton WA",
      budgetRange: "$250k-$400k project range",
      financingStatus: "Preapproval received",
      landStatus: "Presale lot and utility path confirmed",
      timeline: "Active build and setup coordination",
      buyerGoal:
        "Track contract progress, payments, change orders, delivery/setup, and move-in steps.",
      buyerNextStep:
        "Review current change order and watch for the next delivery/setup update.",
      internalNextStep:
        "Keep contract, deposit, change order, and setup notes current for the customer tracker.",
      publicNotes:
        "Your contract is active. Endeavor is coordinating the next delivery and setup dependencies and will keep this tracker updated.",
      smsOptIn: true,
    },
    contractProject: {
      contractStatus: "ACTIVE",
      changeOrderStatus: "APPROVED",
      paymentStatus: "DEPOSIT_PAID",
      contractDocumentUrl: "https://endeavorhomesnw.com",
      contractDocumentLabel: "Demo contract packet",
      depositDueCents: dollarsToCents(15000),
      contractSignedAt: hoursAgo(24 * 14),
      depositPaidAt: hoursAgo(24 * 10),
      activeStartedAt: hoursAgo(24 * 5),
      contractNotes:
        "Demo active Endeavor contract. Deposit is paid, first change order is approved, and setup coordination is underway.",
      internalNextStep:
        "Confirm delivery window, document setup dependencies, and send the next customer-facing build update.",
    },
    messages: [
      {
        suffix: "inbound-1",
        direction: "INBOUND",
        body: "Can we see where the contract, deposit, and change order stand?",
        createdAt: hoursAgo(54),
      },
      {
        suffix: "outbound-1",
        direction: "OUTBOUND",
        body: "Yes. Your tracker now shows contract active, deposit paid, approved change order, and the next build update.",
        createdAt: hoursAgo(53.5),
      },
      {
        suffix: "outbound-2",
        direction: "OUTBOUND",
        body: "Next Endeavor update: delivery and setup dependencies are being coordinated for the Shelton presale project.",
        createdAt: hoursAgo(8),
      },
    ],
  },
];

async function upsertEndeavorOrgAndOwner() {
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

  const existingOrg = await prisma.organization.findFirst({
    where: { name: ENDEAVOR_ORG_NAME },
    select: { id: true },
  });

  const org = existingOrg
    ? await prisma.organization.update({
        where: { id: existingOrg.id },
        data: orgData,
        select: { id: true, name: true },
      })
    : await prisma.organization.create({
        data: {
          name: ENDEAVOR_ORG_NAME,
          ...orgData,
        },
        select: { id: true, name: true },
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

  return { org, user };
}

async function upsertCustomer({ orgId, userId, customer }) {
  const existing = await prisma.customer.findFirst({
    where: {
      orgId,
      phoneE164: customer.phoneE164,
    },
    select: { id: true },
  });

  const data = {
    createdByUserId: userId,
    name: customer.name,
    phoneE164: customer.phoneE164,
    email: customer.email,
    addressLine: customer.addressLine,
  };

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data,
      select: { id: true, name: true, phoneE164: true, email: true },
    });
  }

  return prisma.customer.create({
    data: {
      orgId,
      ...data,
    },
    select: { id: true, name: true, phoneE164: true, email: true },
  });
}

async function upsertLead({ orgId, userId, customerId, customer, demo }) {
  const existing = await prisma.lead.findFirst({
    where: {
      orgId,
      sourceDetail: demo.marker,
    },
    select: { id: true },
  });

  const data = {
    customerId,
    createdByUserId: userId,
    status: demo.lead.status,
    priority: demo.lead.priority,
    contactName: customer.name,
    phoneE164: customer.phoneE164,
    sourceType: "ORGANIC",
    sourceChannel: "ORGANIC",
    leadSource: "FORM",
    sourceDetail: demo.marker,
    attributionLocked: true,
    city: demo.lead.city,
    businessType: "Homebuilder buyer project",
    estimatedRevenueCents: demo.lead.estimatedRevenueCents,
    notes: demo.lead.notes,
  };

  if (existing) {
    return prisma.lead.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  }

  return prisma.lead.create({
    data: {
      orgId,
      ...data,
    },
    select: { id: true },
  });
}

async function upsertBuyerProject({ orgId, customer, customerId, leadId, demo }) {
  const existing = await prisma.buyerProject.findFirst({
    where: {
      orgId,
      sourcePath: demo.sourcePath,
    },
    select: { id: true },
  });

  const data = {
    customerId,
    leadId,
    buyerName: customer.name,
    phoneE164: customer.phoneE164,
    email: customer.email,
    sourcePath: demo.sourcePath,
    ...demo.buyerProject,
  };

  if (existing) {
    return prisma.buyerProject.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        projectName: true,
        currentStage: true,
        selectedHomeTitle: true,
      },
    });
  }

  return prisma.buyerProject.create({
    data: {
      orgId,
      ...data,
    },
    select: {
      id: true,
      projectName: true,
      currentStage: true,
      selectedHomeTitle: true,
    },
  });
}

async function upsertContractProject({
  orgId,
  userId,
  customerId,
  leadId,
  buyerProjectId,
  contractProject,
}) {
  if (!contractProject) {
    await prisma.contractProject.deleteMany({
      where: {
        orgId,
        buyerProjectId,
      },
    });
    return null;
  }

  const data = {
    orgId,
    buyerProjectId,
    customerId,
    leadId,
    createdByUserId: userId,
    ...contractProject,
  };

  return prisma.contractProject.upsert({
    where: { buyerProjectId },
    update: data,
    create: data,
    select: {
      id: true,
      contractStatus: true,
      paymentStatus: true,
      changeOrderStatus: true,
    },
  });
}

async function upsertMessages({ orgId, customer, leadId, demo }) {
  const results = [];

  for (const message of demo.messages) {
    const outbound = message.direction === "OUTBOUND";
    const providerMessageSid = `SM_${demo.marker.replaceAll(/[^a-z0-9]/gi, "_")}_${message.suffix}`;
    const saved = await prisma.message.upsert({
      where: { providerMessageSid },
      update: {
        orgId,
        leadId,
        direction: message.direction,
        type: "MANUAL",
        fromNumberE164: outbound ? FROM_NUMBER_E164 : customer.phoneE164,
        toNumberE164: outbound ? customer.phoneE164 : FROM_NUMBER_E164,
        body: message.body,
        provider: "TWILIO",
        status: "DELIVERED",
        createdAt: message.createdAt,
      },
      create: {
        orgId,
        leadId,
        direction: message.direction,
        type: "MANUAL",
        fromNumberE164: outbound ? FROM_NUMBER_E164 : customer.phoneE164,
        toNumberE164: outbound ? customer.phoneE164 : FROM_NUMBER_E164,
        body: message.body,
        provider: "TWILIO",
        providerMessageSid,
        status: "DELIVERED",
        createdAt: message.createdAt,
      },
      select: {
        id: true,
        direction: true,
        createdAt: true,
      },
    });
    results.push(saved);
  }

  const inboundTimes = results
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.createdAt.getTime());
  const outboundTimes = results
    .filter((message) => message.direction === "OUTBOUND")
    .map((message) => message.createdAt.getTime());

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      firstContactedAt:
        results.length > 0
          ? new Date(Math.min(...results.map((message) => message.createdAt.getTime())))
          : undefined,
      lastInboundAt:
        inboundTimes.length > 0
          ? new Date(Math.max(...inboundTimes))
          : undefined,
      lastOutboundAt:
        outboundTimes.length > 0
          ? new Date(Math.max(...outboundTimes))
          : undefined,
    },
  });

  return results;
}

async function refreshTrackingLink({ orgId, userId, buyerProjectId }) {
  const now = new Date();
  const token = randomBytes(32).toString("hex");

  await prisma.buyerProjectShareLink.updateMany({
    where: {
      orgId,
      buyerProjectId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });

  await prisma.buyerProjectShareLink.create({
    data: {
      orgId,
      buyerProjectId,
      createdByUserId: userId,
      tokenHash: hashToken(token),
    },
  });

  return `${baseUrl}/buyer-project/${token}`;
}

async function main() {
  const { org, user } = await upsertEndeavorOrgAndOwner();
  const seeded = [];

  for (const demo of demoProjects) {
    const customer = await upsertCustomer({
      orgId: org.id,
      userId: user.id,
      customer: demo.customer,
    });
    const lead = await upsertLead({
      orgId: org.id,
      userId: user.id,
      customerId: customer.id,
      customer,
      demo,
    });
    const buyerProject = await upsertBuyerProject({
      orgId: org.id,
      customer,
      customerId: customer.id,
      leadId: lead.id,
      demo,
    });
    const contractProject = await upsertContractProject({
      orgId: org.id,
      userId: user.id,
      customerId: customer.id,
      leadId: lead.id,
      buyerProjectId: buyerProject.id,
      contractProject: demo.contractProject || null,
    });

    await upsertMessages({
      orgId: org.id,
      customer,
      leadId: lead.id,
      demo,
    });

    const trackingUrl = await refreshTrackingLink({
      orgId: org.id,
      userId: user.id,
      buyerProjectId: buyerProject.id,
    });

    seeded.push({
      projectName: buyerProject.projectName,
      stage: buyerProject.currentStage,
      selectedHomeTitle: buyerProject.selectedHomeTitle,
      leadId: lead.id,
      contractStatus: contractProject?.contractStatus || "no contract yet",
      trackingUrl,
    });
  }

  console.log(`Seeded ${seeded.length} Endeavor demo projects for ${org.name}.`);
  console.log(`Builder portal: ${baseUrl}/app/builder?orgId=${org.id}`);
  console.log(`Owner login email: ${BRUCE_EMAIL}`);
  console.log("");

  for (const row of seeded) {
    console.log(`- ${row.projectName}`);
    console.log(`  Home/listing: ${row.selectedHomeTitle}`);
    console.log(`  Stage: ${row.stage}`);
    console.log(`  Contract: ${row.contractStatus}`);
    console.log(`  Twilio thread: ${baseUrl}/app/inbox?orgId=${org.id}&leadId=${row.leadId}`);
    console.log(`  Customer tracker: ${row.trackingUrl}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
