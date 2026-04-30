import { createHash, randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

const prisma = new PrismaClient();

const SALES_ORG_NAME = "Cascade Outdoor Living Demo";
const OWNER_EMAIL = "sales-demo@tiegui.com";
const CESAR_EMAIL = "cesar@tiegui.com";
const MANAGER_EMAIL = "ops-demo@tiegui.com";
const FIELD_EMAIL = "field-demo@tiegui.com";
const DEMO_PASSWORD = (process.env.SALES_DEMO_PASSWORD || "").trim();
const FROM_NUMBER_E164 = "+12065550199";
const DEMO_ORG_LICENSE = "DEMO-CASCADOL-826QZ";
const DEMO_ORG_EMAIL = "hello@cascadeoutdoor.demo";
const DEMO_ORG_WEBSITE = "https://cascadeoutdoor.demo";
const ALLOW_DESTRUCTIVE_SEED = process.env.ALLOW_DESTRUCTIVE_SEED === "1";
const CONFIRM_DEMO_ORG_NAME = process.env.CONFIRM_DEMO_ORG_NAME || "";
const baseUrl = (
  process.env.PORTAL_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3001"
).replace(/\/$/, "");

function assertSeedSafety() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run sales demo seed while NODE_ENV=production.");
  }

  if (!ALLOW_DESTRUCTIVE_SEED || CONFIRM_DEMO_ORG_NAME !== SALES_ORG_NAME) {
    throw new Error(
      [
        "Refusing to run destructive sales demo seed without explicit confirmation.",
        `Set ALLOW_DESTRUCTIVE_SEED=1 and CONFIRM_DEMO_ORG_NAME="${SALES_ORG_NAME}".`,
      ].join(" "),
    );
  }

  if (!DEMO_PASSWORD) {
    throw new Error("SALES_DEMO_PASSWORD is required for seeded demo users.");
  }

  if (DEMO_PASSWORD.length < 12) {
    throw new Error("SALES_DEMO_PASSWORD must be at least 12 characters.");
  }
}

function assertExistingOrgIsDemo(existing) {
  if (!existing) {
    return;
  }

  const isDemoOrg =
    existing.licenseNumber === DEMO_ORG_LICENSE &&
    existing.email === DEMO_ORG_EMAIL &&
    existing.website === DEMO_ORG_WEBSITE;

  if (!isDemoOrg) {
    throw new Error(
      [
        `Refusing to overwrite existing organization "${SALES_ORG_NAME}" because it is not marked as the sales demo org.`,
        "Expected demo license, email, and website markers before destructive reseeding.",
      ].join(" "),
    );
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function startOfMonth(offset = 0) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date;
}

function money(amount) {
  return new Prisma.Decimal(amount.toFixed(2));
}

function dollarsToCents(amount) {
  return Math.round(amount * 100);
}

function idempotencyKey(prefix, ...parts) {
  return `${prefix}:${createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex")}`;
}

async function upsertSalesOrg() {
  const orgData = {
    legalName: "Cascade Outdoor Living LLC",
    addressLine1: "1420 Market St",
    city: "Tacoma",
    state: "WA",
    zip: "98402",
    phone: "(206) 555-0199",
    email: DEMO_ORG_EMAIL,
    website: DEMO_ORG_WEBSITE,
    licenseNumber: DEMO_ORG_LICENSE,
    purchaseOrderPrefix: "PO",
    purchaseOrderNextNumber: 106,
    estimatePrefix: "EST",
    estimateNextNumber: 214,
    invoicePrefix: "INV",
    invoiceNextNumber: 318,
    invoicePaymentInstructions:
      "Demo payment instructions: ACH, card, or check accepted. This is sample sales data only.",
    invoiceTemplate: "modern",
    invoiceCollectionsEnabled: true,
    invoiceCollectionsAutoSendEnabled: true,
    invoiceFirstReminderLeadDays: 2,
    invoiceOverdueReminderCadenceDays: 5,
    invoiceCollectionsMaxReminders: 3,
    invoiceCollectionsUrgentAfterDays: 7,
    invoiceCollectionsFinalAfterDays: 21,
    ghostBustingEnabled: true,
    voiceNotesEnabled: true,
    metaCapiEnabled: true,
    offlineModeEnabled: true,
    ghostBustingQuietHoursStart: 1200,
    ghostBustingQuietHoursEnd: 480,
    ghostBustingMaxNudges: 3,
    ghostBustingTemplateText:
      "Hi {{name}}, checking back on your outdoor project. Want us to hold an estimate slot this week?",
    allowWorkerLeadCreate: true,
    onboardingStep: 6,
    onboardingCompletedAt: daysFromNow(-14),
    smsFromNumberE164: FROM_NUMBER_E164,
    smsMonthlyLimit: 5000,
    smsHardStop: true,
    aiMonthlyBudgetCents: 2500,
    aiHardStop: true,
    aiUserDailyRequestLimit: 40,
    messageLanguage: "AUTO",
    smsTone: "PREMIUM",
    autoReplyEnabled: true,
    followUpsEnabled: true,
    autoBookingEnabled: true,
    smsGreetingLine: "Thanks for reaching out to Cascade Outdoor Living.",
    smsWorkingHoursText:
      "We handle patios, drainage, hardscapes, planting, irrigation, and seasonal maintenance across the South Sound.",
    smsWebsiteSignature: "Cascade Outdoor Living | cascadeoutdoor.demo",
    smsQuietHoursStartMinute: 480,
    smsQuietHoursEndMinute: 1170,
    missedCallAutoReplyOn: true,
    missedCallAutoReplyBody:
      "Sorry we missed you. Text us your project address and the best time for a quick estimate call.",
    missedCallAutoReplyBodyEn:
      "Sorry we missed you. Text us your project address and the best time for a quick estimate call.",
    missedCallAutoReplyBodyEs:
      "Perdon por no contestar. Envie la direccion del proyecto y el mejor horario para una llamada.",
    intakeAutomationEnabled: true,
    intakeAskLocationBody: "What is the project address or city?",
    intakeAskLocationBodyEn: "What is the project address or city?",
    intakeAskLocationBodyEs: "Cual es la direccion o ciudad del proyecto?",
    intakeAskWorkTypeBody: "What outdoor work are you planning?",
    intakeAskWorkTypeBodyEn: "What outdoor work are you planning?",
    intakeAskWorkTypeBodyEs: "Que trabajo exterior esta planeando?",
    intakeAskCallbackBody: "What day and time works for a walkthrough?",
    intakeAskCallbackBodyEn: "What day and time works for a walkthrough?",
    intakeAskCallbackBodyEs: "Que dia y hora funciona para una visita?",
    intakeCompletionBody: "Perfect, we have the details and will confirm your walkthrough.",
    intakeCompletionBodyEn: "Perfect, we have the details and will confirm your walkthrough.",
    intakeCompletionBodyEs: "Perfecto, tenemos los detalles y confirmaremos su visita.",
  };

  const existing = await prisma.organization.findFirst({
    where: { name: SALES_ORG_NAME },
    select: { id: true, licenseNumber: true, email: true, website: true },
  });

  assertExistingOrgIsDemo(existing);

  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: orgData,
      select: { id: true, name: true },
    });
  }

  return prisma.organization.create({
    data: {
      name: SALES_ORG_NAME,
      ...orgData,
    },
    select: { id: true, name: true },
  });
}

async function clearOrgDemoData(orgId) {
  await prisma.organization.update({
    where: { id: orgId },
    data: { logoPhotoId: null },
  });

  await prisma.$transaction([
    prisma.calendarEventWorker.deleteMany({ where: { orgId } }),
    prisma.calendarHold.deleteMany({ where: { orgId } }),
    prisma.timeOff.deleteMany({ where: { orgId } }),
    prisma.workingHours.deleteMany({ where: { orgId } }),
    prisma.voicemailArtifact.deleteMany({ where: { orgId } }),
    prisma.communicationEvent.deleteMany({ where: { orgId } }),
    prisma.leadConversationAuditEvent.deleteMany({ where: { orgId } }),
    prisma.leadConversationState.deleteMany({ where: { orgId } }),
    prisma.smsDispatchQueue.deleteMany({ where: { orgId } }),
    prisma.message.deleteMany({ where: { orgId } }),
    prisma.call.deleteMany({ where: { orgId } }),
    prisma.invoiceCollectionAttempt.deleteMany({ where: { orgId } }),
    prisma.invoiceCheckoutSession.deleteMany({ where: { invoice: { orgId } } }),
    prisma.invoicePayment.deleteMany({ where: { invoice: { orgId } } }),
    prisma.invoiceLineItem.deleteMany({ where: { invoice: { orgId } } }),
    prisma.invoice.deleteMany({ where: { orgId } }),
    prisma.purchaseOrderLineItem.deleteMany({ where: { purchaseOrder: { orgId } } }),
    prisma.businessExpense.deleteMany({ where: { orgId } }),
    prisma.purchaseOrder.deleteMany({ where: { orgId } }),
    prisma.jobLabor.deleteMany({ where: { orgId } }),
    prisma.jobMaterial.deleteMany({ where: { orgId } }),
    prisma.jobMeasurement.deleteMany({ where: { orgId } }),
    prisma.jobEvent.deleteMany({ where: { orgId } }),
    prisma.jobTrackingLink.deleteMany({ where: { orgId } }),
    prisma.event.deleteMany({ where: { orgId } }),
    prisma.job.deleteMany({ where: { orgId } }),
    prisma.estimateShareLink.deleteMany({ where: { orgId } }),
    prisma.estimateActivity.deleteMany({ where: { estimate: { orgId } } }),
    prisma.estimateLineItem.deleteMany({ where: { estimate: { orgId } } }),
    prisma.estimate.deleteMany({ where: { orgId } }),
    prisma.estimateDraftLineItem.deleteMany({ where: { estimateDraft: { orgId } } }),
    prisma.estimateDraft.deleteMany({ where: { orgId } }),
    prisma.recurringBillingCharge.deleteMany({ where: { recurringServicePlan: { orgId } } }),
    prisma.recurringServicePlan.deleteMany({ where: { orgId } }),
    prisma.material.deleteMany({ where: { orgId } }),
    prisma.leadPhoto.deleteMany({ where: { orgId } }),
    prisma.leadMeasurement.deleteMany({ where: { orgId } }),
    prisma.leadNote.deleteMany({ where: { orgId } }),
    prisma.blockedCaller.deleteMany({ where: { orgId } }),
    prisma.buyerProjectShareLink.deleteMany({ where: { orgId } }),
    prisma.contractProject.deleteMany({ where: { orgId } }),
    prisma.buyerProject.deleteMany({ where: { orgId } }),
    prisma.websiteLeadSubmissionReceipt.deleteMany({ where: { orgId } }),
    prisma.websiteLeadSource.deleteMany({ where: { orgId } }),
    prisma.customerPortalAccount.deleteMany({ where: { orgId } }),
    prisma.lead.deleteMany({ where: { orgId } }),
    prisma.customer.deleteMany({ where: { orgId } }),
    prisma.budgetRequest.deleteMany({ where: { orgId } }),
    prisma.adSpendEntry.deleteMany({ where: { orgId } }),
    prisma.marketingSpend.deleteMany({ where: { orgId } }),
    prisma.importRun.deleteMany({ where: { orgId } }),
    prisma.integrationOAuthState.deleteMany({ where: { orgId } }),
    prisma.integrationAccount.deleteMany({ where: { orgId } }),
    prisma.googleSyncJobAttempt.deleteMany({ where: { orgId } }),
    prisma.googleSyncJob.deleteMany({ where: { orgId } }),
    prisma.googleOAuthState.deleteMany({ where: { orgId } }),
    prisma.googleAccount.deleteMany({ where: { orgId } }),
    prisma.orgDashboardConfig.deleteMany({ where: { orgId } }),
    prisma.smsTemplate.deleteMany({ where: { orgId } }),
    prisma.organizationMessagingSettings.deleteMany({ where: { orgId } }),
    prisma.organizationSmsRegistrationApplication.deleteMany({ where: { orgId } }),
    prisma.twilioConfigAuditLog.deleteMany({ where: { organizationId: orgId } }),
    prisma.organizationTwilioConfig.deleteMany({ where: { organizationId: orgId } }),
    prisma.crew.deleteMany({ where: { orgId } }),
    prisma.photo.deleteMany({ where: { orgId } }),
  ]);
}

async function upsertUser({ email, name, orgId, role }) {
  const passwordHash = await hash(DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role: "CLIENT",
      calendarAccessRole: role,
      orgId,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
      timezone: "America/Los_Angeles",
    },
    create: {
      email,
      name,
      role: "CLIENT",
      calendarAccessRole: role,
      orgId,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
      timezone: "America/Los_Angeles",
    },
    select: { id: true, email: true, name: true },
  });

  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId: user.id,
      },
    },
    update: { role, status: "ACTIVE" },
    create: {
      organizationId: orgId,
      userId: user.id,
      role,
      status: "ACTIVE",
    },
  });

  return user;
}

async function createCommunicationThread({
  orgId,
  userId,
  customer,
  lead,
  messages,
  call,
  voicemail,
}) {
  const conversation = await prisma.leadConversationState.upsert({
    where: { leadId: lead.id },
    update: {},
    create: {
      orgId,
      leadId: lead.id,
      stage: lead.status === "BOOKED" ? "BOOKED" : "ASKED_TIMEFRAME",
      workSummary: lead.notes,
      addressText: customer.addressLine,
      addressCity: lead.city,
      timeframe: lead.status === "BOOKED" ? "THIS_WEEK" : "NEXT_WEEK",
      lastInboundAt: messages.filter((m) => m.direction === "INBOUND").at(-1)?.createdAt || null,
      lastOutboundAt: messages.filter((m) => m.direction === "OUTBOUND").at(-1)?.createdAt || null,
      nextFollowUpAt: lead.nextFollowUpAt || null,
    },
    select: { id: true },
  });

  for (const item of messages) {
    const outbound = item.direction === "OUTBOUND";
    const providerMessageSid = `SM_demo_${lead.id.replaceAll("-", "").slice(0, 12)}_${item.slug}`;
    const message = await prisma.message.create({
      data: {
        orgId,
        leadId: lead.id,
        direction: item.direction,
        type: item.type || "MANUAL",
        fromNumberE164: outbound ? FROM_NUMBER_E164 : lead.phoneE164,
        toNumberE164: outbound ? lead.phoneE164 : FROM_NUMBER_E164,
        body: item.body,
        provider: "TWILIO",
        providerMessageSid,
        status: item.status || "DELIVERED",
        createdAt: item.createdAt,
      },
      select: { id: true },
    });

    await prisma.communicationEvent.create({
      data: {
        orgId,
        leadId: lead.id,
        contactId: customer.id,
        conversationId: conversation.id,
        messageId: message.id,
        actorUserId: outbound ? userId : null,
        type: outbound ? "OUTBOUND_SMS_SENT" : "INBOUND_SMS_RECEIVED",
        channel: "SMS",
        occurredAt: item.createdAt,
        summary: item.body,
        metadataJson: { demo: true, salesDemo: true, messageType: item.type || "MANUAL" },
        provider: "TWILIO",
        providerMessageSid,
        providerStatus: item.status || "DELIVERED",
        idempotencyKey: idempotencyKey("sales-demo-sms", lead.id, item.slug),
      },
    });
  }

  if (call) {
    const createdCall = await prisma.call.create({
      data: {
        orgId,
        leadId: lead.id,
        fromNumberE164: call.direction === "INBOUND" ? lead.phoneE164 : FROM_NUMBER_E164,
        toNumberE164: call.direction === "INBOUND" ? FROM_NUMBER_E164 : lead.phoneE164,
        trackingNumberE164: FROM_NUMBER_E164,
        landingPageUrl: call.landingPageUrl,
        utmCampaign: call.utmCampaign,
        gclid: call.gclid,
        attributionSource: call.attributionSource || "UNKNOWN",
        direction: call.direction,
        status: call.status,
        twilioCallSid: `CA_demo_${lead.id.replaceAll("-", "").slice(0, 20)}`,
        startedAt: call.startedAt,
        endedAt: call.endedAt || null,
      },
      select: { id: true, twilioCallSid: true },
    });

    const eventType =
      call.status === "VOICEMAIL"
        ? "VOICEMAIL_LEFT"
        : call.status === "MISSED"
          ? "NO_ANSWER"
          : call.status === "ANSWERED"
            ? "COMPLETED"
            : "INBOUND_CALL_RECEIVED";

    const communicationEvent = await prisma.communicationEvent.create({
      data: {
        orgId,
        leadId: lead.id,
        contactId: customer.id,
        conversationId: conversation.id,
        callId: createdCall.id,
        type: eventType,
        channel: "VOICE",
        occurredAt: call.startedAt,
        summary: call.summary,
        metadataJson: call.metadataJson || { demo: true, salesDemo: true },
        provider: "TWILIO",
        providerCallSid: createdCall.twilioCallSid,
        providerStatus: call.status,
        idempotencyKey: idempotencyKey("sales-demo-call", lead.id, call.status, call.startedAt.toISOString()),
      },
      select: { id: true },
    });

    if (voicemail) {
      await prisma.voicemailArtifact.create({
        data: {
          orgId,
          leadId: lead.id,
          contactId: customer.id,
          conversationId: conversation.id,
          callId: createdCall.id,
          communicationEventId: communicationEvent.id,
          providerCallSid: createdCall.twilioCallSid,
          recordingSid: `RE_demo_${lead.id.replaceAll("-", "").slice(0, 20)}`,
          recordingUrl: "https://api.twilio.com/demo-recording",
          recordingDurationSeconds: voicemail.durationSeconds,
          transcriptionStatus: "COMPLETED",
          transcriptionText: voicemail.transcriptionText,
          voicemailAt: call.startedAt,
          metadataJson: { demo: true, salesDemo: true },
        },
      });
    }
  }

  const inboundTimes = messages.filter((m) => m.direction === "INBOUND").map((m) => m.createdAt.getTime());
  const outboundTimes = messages.filter((m) => m.direction === "OUTBOUND").map((m) => m.createdAt.getTime());
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      firstContactedAt: messages.length ? new Date(Math.min(...messages.map((m) => m.createdAt.getTime()))) : null,
      lastInboundAt: inboundTimes.length ? new Date(Math.max(...inboundTimes)) : null,
      lastOutboundAt: outboundTimes.length ? new Date(Math.max(...outboundTimes)) : null,
    },
  });
}

async function createEstimate({ orgId, userId, leadId, customerName, siteAddress, number, status, title, projectType, lines, dates }) {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const tax = subtotal * 0.101;
  const total = subtotal + tax;
  const estimate = await prisma.estimate.create({
    data: {
      orgId,
      leadId,
      createdByUserId: userId,
      estimateNumber: number,
      status,
      title,
      customerName,
      siteAddress,
      projectType,
      description: `${projectType} scope prepared for sales demo walkthrough.`,
      subtotal: money(subtotal),
      taxRate: money(0.101),
      taxRateSource: "MANUAL",
      taxZipCode: "98407",
      taxJurisdiction: "Tacoma, WA",
      tax: money(tax),
      total: money(total),
      notes: "Demo estimate with grouped line items, approval timeline, and conversion path.",
      terms: "50% deposit to schedule. Balance due at substantial completion.",
      validUntil: daysFromNow(21),
      sentAt: dates.sentAt || null,
      viewedAt: dates.viewedAt || null,
      customerViewedAt: dates.viewedAt || null,
      approvedAt: dates.approvedAt || null,
    },
  });

  await prisma.estimateLineItem.createMany({
    data: lines.map((line, index) => ({
      estimateId: estimate.id,
      sortOrder: index,
      type: line.type || "CUSTOM_MATERIAL",
      name: line.name,
      description: line.description,
      quantity: money(line.quantity),
      unit: line.unit,
      unitPrice: money(line.unitPrice),
      total: money(line.quantity * line.unitPrice),
    })),
  });

  await prisma.estimateActivity.createMany({
    data: [
      { estimateId: estimate.id, type: "CREATED", actorUserId: userId, metadata: { demo: true } },
      ...(dates.sentAt ? [{ estimateId: estimate.id, type: "SENT", actorUserId: userId, createdAt: dates.sentAt, metadata: { demo: true } }] : []),
      ...(dates.viewedAt ? [{ estimateId: estimate.id, type: "VIEWED", actorUserId: null, createdAt: dates.viewedAt, metadata: { demo: true } }] : []),
      ...(dates.approvedAt ? [{ estimateId: estimate.id, type: "APPROVED", actorUserId: null, createdAt: dates.approvedAt, metadata: { demo: true } }] : []),
    ],
  });

  await prisma.estimateShareLink.create({
    data: {
      orgId,
      estimateId: estimate.id,
      createdByUserId: userId,
      tokenHash: hashToken(randomBytes(32).toString("hex")),
      recipientName: customerName,
      expiresAt: daysFromNow(30),
      firstViewedAt: dates.viewedAt || null,
      lastViewedAt: dates.viewedAt || null,
      approvedAt: dates.approvedAt || null,
      decisionName: dates.approvedAt ? customerName : null,
      decisionNote: dates.approvedAt ? "Looks good. Please schedule the crew." : null,
    },
  });

  return estimate;
}

async function main() {
  assertSeedSafety();

  const org = await upsertSalesOrg();
  await clearOrgDemoData(org.id);

  const [owner, cesar, manager, field] = await Promise.all([
    upsertUser({ email: OWNER_EMAIL, name: "Avery Morgan", orgId: org.id, role: "OWNER" }),
    upsertUser({ email: CESAR_EMAIL, name: "Cesar Martinez", orgId: org.id, role: "OWNER" }),
    upsertUser({ email: MANAGER_EMAIL, name: "Riley Chen", orgId: org.id, role: "ADMIN" }),
    upsertUser({ email: FIELD_EMAIL, name: "Sam Patel", orgId: org.id, role: "WORKER" }),
  ]);

  const [northCrew, installCrew] = await Promise.all([
    prisma.crew.create({ data: { orgId: org.id, name: "North Sound Install Crew", active: true } }),
    prisma.crew.create({ data: { orgId: org.id, name: "Maintenance Crew A", active: true } }),
  ]);

  await prisma.orgDashboardConfig.create({
    data: {
      orgId: org.id,
      adsPaused: false,
      dailyBudgetCents: 42000,
      defaultTaxRate: money(0.101),
      missedCallMessage:
        "Sorry we missed you. Reply with your address and we will get you on the estimate calendar.",
      jobReminderMinutesBefore: 120,
      googleReviewUrl: "https://g.page/r/cascade-outdoor-demo/review",
      allowOverlaps: false,
      weekStartsOn: 1,
      defaultSlotMinutes: 45,
      defaultUntimedStartHour: 8,
      calendarTimezone: "America/Los_Angeles",
    },
  });

  await prisma.organizationMessagingSettings.create({
    data: {
      orgId: org.id,
      smsTone: "PREMIUM",
      dispatchSmsEnabled: true,
      dispatchSmsScheduled: true,
      dispatchSmsOnTheWay: true,
      dispatchSmsRescheduled: true,
      dispatchSmsCompleted: true,
      autoReplyEnabled: true,
      followUpsEnabled: true,
      autoBookingEnabled: true,
      workingHoursStart: "08:00",
      workingHoursEnd: "18:00",
      slotDurationMinutes: 60,
      bufferMinutes: 20,
      daysAhead: 7,
      timezone: "America/Los_Angeles",
      aiIntakeProfile: {
        business: "Premium outdoor living contractor",
        qualifiesFor: ["patios", "retaining walls", "drainage", "irrigation", "maintenance"],
        bookingGoal: "Schedule site walkthroughs for qualified homeowners.",
      },
      customTemplates: {
        estimateApproved: "Thanks {{name}}. We received approval and are preparing your install date.",
        crewOnTheWay: "Your Cascade crew is on the way. Reply here if access instructions changed.",
      },
    },
  });

  await prisma.organizationSmsRegistrationApplication.create({
    data: {
      orgId: org.id,
      status: "READY_FOR_SUBMISSION",
      businessName: "Cascade Outdoor Living LLC",
      brandName: "Cascade Outdoor Living",
      businessType: "LLC",
      businessIndustry: "Construction and home services",
      businessRegistrationIdentifier: "DEMO-UBI-604555019",
      companyType: "private",
      businessIdentity: "direct_customer",
      businessRegionsOfOperation: "USA_AND_CANADA",
      websiteUrl: "https://cascadeoutdoor.demo",
      socialMediaProfileUrls: "https://www.instagram.com/cascadeoutdoordemo",
      customerName: "Cascade Outdoor Living",
      street: "1420 Market St",
      city: "Tacoma",
      region: "WA",
      postalCode: "98402",
      authorizedFirstName: "Avery",
      authorizedLastName: "Morgan",
      authorizedTitle: "Owner",
      authorizedJobPosition: "Owner",
      authorizedPhoneE164: "+12065550198",
      authorizedEmail: OWNER_EMAIL,
      brandContactEmail: OWNER_EMAIL,
      campaignUseCase: "Mixed customer care and appointment scheduling",
      campaignDescription:
        "Customers receive estimate scheduling, missed-call replies, appointment reminders, job updates, invoice reminders, and service follow-up.",
      messageFlow:
        "Customers submit a website form, text the business number, call the business, or give consent during an estimate call. The form includes SMS consent language.",
      privacyPolicyUrl: "https://cascadeoutdoor.demo/privacy",
      termsOfServiceUrl: "https://cascadeoutdoor.demo/terms",
      optInProofUrl: "https://cascadeoutdoor.demo/contact",
      sampleMessage1:
        "Hi Maya, this is Cascade Outdoor Living. We received your patio request. Does Thursday at 10:00 AM work for a walkthrough?",
      sampleMessage2:
        "Your Cascade crew is scheduled for tomorrow at 8:30 AM. Reply STOP to opt out.",
      sampleMessage3:
        "Thanks for approving the estimate. We will send the deposit invoice and install window shortly.",
      hasEmbeddedLinks: true,
      hasEmbeddedPhone: false,
      optInKeywords: "START, YES",
      optInMessage: "You are opted in to Cascade Outdoor Living updates. Reply STOP to opt out.",
      optOutKeywords: "STOP, UNSUBSCRIBE, CANCEL",
      optOutMessage: "You have been unsubscribed from Cascade Outdoor Living SMS updates.",
      helpKeywords: "HELP, INFO",
      helpMessage: "Cascade Outdoor Living: reply here or call (206) 555-0199 for help.",
      estimatedMonthlyMessages: 1200,
      desiredSenderNumberE164: FROM_NUMBER_E164,
      customerConsentConfirmed: true,
      registrationSubmissionAuthorized: true,
      submittedAt: daysFromNow(-3),
    },
  });

  await prisma.smsTemplate.createMany({
    data: [
      {
        orgId: org.id,
        name: "Website lead response",
        body: "Hi {{name}}, thanks for reaching out to Cascade. What address should we use for the walkthrough?",
      },
      {
        orgId: org.id,
        name: "Missed call recovery",
        body: "Sorry we missed your call. Reply with your project address and preferred callback time.",
      },
      {
        orgId: org.id,
        name: "Estimate sent",
        body: "Your estimate is ready. Review it when you have a minute and reply here with questions.",
      },
      {
        orgId: org.id,
        name: "Crew on the way",
        body: "Your Cascade crew is on the way. Reply here if gate or parking instructions changed.",
      },
      {
        orgId: org.id,
        name: "Review request",
        body: "Thanks for choosing Cascade. Would you mind leaving a quick review of the project experience?",
      },
    ],
  });

  await prisma.workingHours.createMany({
    data: [owner, cesar, manager, field].flatMap((user) =>
      [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        orgId: org.id,
        workerUserId: user.id,
        dayOfWeek,
        startMinute: user.id === field.id ? 7 * 60 : 8 * 60,
        endMinute: user.id === field.id ? 16 * 60 : 18 * 60,
        timezone: "America/Los_Angeles",
      })),
    ),
  });

  const materials = await Promise.all(
    [
      ["Paver field stone", "Hardscape", "sqft", 5.4, 45, 7.83],
      ["Drain rock", "Drainage", "ton", 58, 35, 78.3],
      ["Commercial weed fabric", "Planting", "roll", 84, 40, 117.6],
      ["Smart irrigation controller", "Irrigation", "each", 196, 35, 264.6],
      ["Premium mulch", "Maintenance", "yard", 41, 45, 59.45],
    ].map(([name, category, unit, baseCost, markupPercent, sellPrice]) =>
      prisma.material.create({
        data: {
          orgId: org.id,
          name,
          category,
          unit,
          baseCost,
          markupPercent,
          sellPrice,
          notes: "Seeded sales demo material.",
        },
      }),
    ),
  );

  const customers = await Promise.all(
    [
      ["Maya Thompson", "+15005550101", "maya.demo@example.com", "3817 N 26th St, Tacoma, WA"],
      ["Jordan Lee", "+15005550102", "jordan.demo@example.com", "2118 N Proctor St, Tacoma, WA"],
      ["Elena Parker", "+15005550103", "elena.demo@example.com", "6402 44th Ave Ct NW, Gig Harbor, WA"],
      ["Luis Ramirez", "+15005550104", "luis.demo@example.com", "7820 Lakewood Dr W, Lakewood, WA"],
      ["Priya Nair", "+15005550105", "priya.demo@example.com", "1822 S Cedar St, Tacoma, WA"],
      ["Chris Walker", "+15005550106", "chris.demo@example.com", "9201 Gravelly Lake Dr SW, Lakewood, WA"],
    ].map(([name, phoneE164, email, addressLine]) =>
      prisma.customer.create({
        data: {
          orgId: org.id,
          createdByUserId: owner.id,
          name,
          phoneE164,
          email,
          addressLine,
        },
      }),
    ),
  );

  const leadInputs = [
    {
      customer: customers[0],
      status: "FOLLOW_UP",
      priority: "HIGH",
      city: "Tacoma",
      businessType: "Patio + planting",
      sourceType: "PAID",
      sourceChannel: "GOOGLE_ADS",
      leadSource: "FORM",
      sourceDetail: "Google patio estimate landing page",
      estimatedRevenueCents: dollarsToCents(18450),
      nextFollowUpAt: hoursFromNow(3),
      notes: "Hot website lead. Wants paver patio, privacy planting, and lighting before graduation party.",
      assignedToUserId: manager.id,
    },
    {
      customer: customers[1],
      status: "BOOKED",
      priority: "HIGH",
      city: "Tacoma",
      businessType: "Drainage remediation",
      sourceType: "ORGANIC",
      sourceChannel: "ORGANIC",
      leadSource: "CALL",
      sourceDetail: "Missed call recovery booked by SMS",
      estimatedRevenueCents: dollarsToCents(9200),
      notes: "SMS agent recovered missed call and booked a drainage walkthrough.",
      assignedToUserId: owner.id,
    },
    {
      customer: customers[2],
      status: "BOOKED",
      priority: "MEDIUM",
      city: "Gig Harbor",
      businessType: "Outdoor kitchen + hardscape",
      sourceType: "REFERRAL",
      sourceChannel: "REFERRAL",
      leadSource: "REFERRAL",
      sourceDetail: "Referral from completed North Tacoma project",
      estimatedRevenueCents: dollarsToCents(38500),
      notes: "Approved estimate converted to scheduled job. Good sales demo for estimate-to-job flow.",
      assignedToUserId: manager.id,
    },
    {
      customer: customers[3],
      status: "INTERESTED",
      priority: "MEDIUM",
      city: "Lakewood",
      businessType: "Monthly maintenance",
      sourceType: "REPEAT",
      sourceChannel: "OTHER",
      leadSource: "OTHER",
      sourceDetail: "Recurring maintenance upsell",
      estimatedRevenueCents: dollarsToCents(8400),
      nextFollowUpAt: daysFromNow(1),
      notes: "Existing customer reviewing monthly plan and card checkout.",
      assignedToUserId: owner.id,
    },
    {
      customer: customers[4],
      status: "CALLED_NO_ANSWER",
      priority: "LOW",
      city: "Tacoma",
      businessType: "Irrigation tune-up",
      sourceType: "PAID",
      sourceChannel: "META_ADS",
      leadSource: "FB",
      sourceDetail: "Meta spring irrigation ad",
      estimatedRevenueCents: dollarsToCents(1250),
      nextFollowUpAt: hoursFromNow(20),
      notes: "Small tune-up lead with failed outbound and scheduled automation follow-up.",
      assignedToUserId: field.id,
    },
    {
      customer: customers[5],
      status: "VOICEMAIL",
      priority: "MEDIUM",
      city: "Lakewood",
      businessType: "Retaining wall repair",
      sourceType: "ORGANIC",
      sourceChannel: "ORGANIC",
      leadSource: "CALL",
      sourceDetail: "Inbound voicemail with transcription",
      estimatedRevenueCents: dollarsToCents(14600),
      nextFollowUpAt: hoursFromNow(5),
      notes: "Voicemail transcript captured wall failure details.",
      assignedToUserId: manager.id,
    },
  ];

  const leads = [];
  for (const input of leadInputs) {
    leads.push(
      await prisma.lead.create({
        data: {
          orgId: org.id,
          customerId: input.customer.id,
          createdByUserId: owner.id,
          assignedToUserId: input.assignedToUserId,
          status: input.status,
          priority: input.priority,
          contactName: input.customer.name,
          phoneE164: input.customer.phoneE164,
          sourceType: input.sourceType,
          sourceChannel: input.sourceChannel,
          leadSource: input.leadSource,
          sourceDetail: input.sourceDetail,
          attributionLocked: true,
          commissionEligible: input.sourceType === "PAID",
          city: input.city,
          businessType: input.businessType,
          estimatedRevenueCents: input.estimatedRevenueCents,
          nextFollowUpAt: input.nextFollowUpAt || null,
          notes: input.notes,
          utmSource: input.sourceType === "PAID" ? (input.sourceChannel === "META_ADS" ? "meta" : "google") : null,
          utmMedium: input.sourceType === "PAID" ? "cpc" : null,
          utmCampaign: input.sourceType === "PAID" ? "spring-outdoor-living-demo" : null,
          fbClickId: input.sourceChannel === "META_ADS" ? "fbclid-demo-irrigation" : null,
        },
      }),
    );
  }

  await Promise.all([
    createCommunicationThread({
      orgId: org.id,
      userId: manager.id,
      customer: customers[0],
      lead: leads[0],
      messages: [
        { slug: "maya-1", direction: "INBOUND", body: "Hi, we need a patio estimate and privacy planting. Can someone come this week?", createdAt: hoursFromNow(-28) },
        { slug: "maya-2", direction: "OUTBOUND", type: "AUTOMATION", body: "Thanks Maya. What address should we use for the walkthrough?", createdAt: hoursFromNow(-27.9) },
        { slug: "maya-3", direction: "INBOUND", body: "3817 N 26th St in Tacoma. Friday morning is best.", createdAt: hoursFromNow(-27.2) },
        { slug: "maya-4", direction: "OUTBOUND", body: "Perfect. I can hold Friday at 9:30 AM for the walkthrough. Does that work?", createdAt: hoursFromNow(-26.8) },
      ],
    }),
    createCommunicationThread({
      orgId: org.id,
      userId: owner.id,
      customer: customers[1],
      lead: leads[1],
      messages: [
        { slug: "jordan-1", direction: "OUTBOUND", type: "AUTOMATION", body: "Sorry we missed you. Text us the drainage issue and a good callback time.", createdAt: hoursFromNow(-46) },
        { slug: "jordan-2", direction: "INBOUND", body: "Water is pooling by the garage after every rain. Tomorrow morning works.", createdAt: hoursFromNow(-45.4) },
        { slug: "jordan-3", direction: "OUTBOUND", body: "We can inspect tomorrow at 10:00 AM. We will check slope, downspouts, and drain route.", createdAt: hoursFromNow(-45) },
        { slug: "jordan-4", direction: "INBOUND", body: "Confirmed, thank you.", createdAt: hoursFromNow(-44.8) },
      ],
      call: {
        direction: "INBOUND",
        status: "MISSED",
        startedAt: hoursFromNow(-46.2),
        landingPageUrl: "https://cascadeoutdoor.demo/drainage",
        utmCampaign: "organic-drainage",
        attributionSource: "ORGANIC",
        summary: "Missed inbound call recovered by automated SMS.",
        metadataJson: { demo: true, salesDemo: true, risk: "low", recovery: "sms_booked" },
      },
    }),
    createCommunicationThread({
      orgId: org.id,
      userId: manager.id,
      customer: customers[2],
      lead: leads[2],
      messages: [
        { slug: "elena-1", direction: "INBOUND", body: "The outdoor kitchen estimate looks good. Can we approve and get on the calendar?", createdAt: hoursFromNow(-80) },
        { slug: "elena-2", direction: "OUTBOUND", body: "Yes. I marked the estimate approved and will send the deposit invoice plus crew window.", createdAt: hoursFromNow(-79.7) },
        { slug: "elena-3", direction: "OUTBOUND", type: "AUTOMATION", body: "Your install is scheduled for next Tuesday at 8:00 AM. Reply here if access details change.", createdAt: hoursFromNow(-8) },
      ],
    }),
    createCommunicationThread({
      orgId: org.id,
      userId: owner.id,
      customer: customers[3],
      lead: leads[3],
      messages: [
        { slug: "luis-1", direction: "OUTBOUND", body: "Luis, we can bundle bed cleanup, mowing, irrigation checks, and seasonal color into a monthly plan.", createdAt: hoursFromNow(-30) },
        { slug: "luis-2", direction: "INBOUND", body: "Please send the monthly option. Card checkout would be easiest.", createdAt: hoursFromNow(-22) },
      ],
    }),
    createCommunicationThread({
      orgId: org.id,
      userId: field.id,
      customer: customers[4],
      lead: leads[4],
      messages: [
        { slug: "priya-1", direction: "OUTBOUND", body: "Hi Priya, following up on your irrigation tune-up request.", status: "FAILED", createdAt: hoursFromNow(-19) },
        { slug: "priya-2", direction: "OUTBOUND", type: "SYSTEM_NUDGE", body: "Trying one more time about the irrigation tune-up. Reply STOP to opt out.", status: "QUEUED", createdAt: hoursFromNow(-1) },
      ],
    }),
    createCommunicationThread({
      orgId: org.id,
      userId: manager.id,
      customer: customers[5],
      lead: leads[5],
      messages: [
        { slug: "chris-1", direction: "OUTBOUND", type: "AUTOMATION", body: "Thanks for the voicemail. We can help assess the retaining wall. What time today works for a call?", createdAt: hoursFromNow(-9.5) },
      ],
      call: {
        direction: "INBOUND",
        status: "VOICEMAIL",
        startedAt: hoursFromNow(-10),
        endedAt: hoursFromNow(-9.96),
        landingPageUrl: "https://cascadeoutdoor.demo/retaining-walls",
        attributionSource: "ORGANIC",
        summary: "Voicemail left about a failing retaining wall near the driveway.",
        metadataJson: { demo: true, salesDemo: true, transcription: "completed", urgency: "medium" },
      },
      voicemail: {
        durationSeconds: 37,
        transcriptionText:
          "Hi, this is Chris Walker. The retaining wall by our driveway is leaning after the last storm and we need someone to look at it this week.",
      },
    }),
  ]);

  await prisma.leadNote.createMany({
    data: [
      { orgId: org.id, leadId: leads[0].id, createdByUserId: manager.id, body: "Sales angle: show paid lead attribution, SMS intake, and follow-up reminder." },
      { orgId: org.id, leadId: leads[1].id, createdByUserId: owner.id, body: "Missed call auto-reply recovered the appointment within 45 minutes." },
      { orgId: org.id, leadId: leads[2].id, createdByUserId: manager.id, body: "Estimate approved and converted to scheduled install job." },
      { orgId: org.id, leadId: leads[5].id, createdByUserId: manager.id, body: "Voicemail transcription is ready for the callback." },
    ],
  });

  await prisma.leadMeasurement.createMany({
    data: [
      { orgId: org.id, leadId: leads[0].id, createdByUserId: manager.id, label: "Patio area", value: "420", unit: "sqft", notes: "Initial homeowner estimate" },
      { orgId: org.id, leadId: leads[1].id, createdByUserId: owner.id, label: "Drain run", value: "86", unit: "ft", notes: "Garage to side-yard daylight" },
      { orgId: org.id, leadId: leads[5].id, createdByUserId: manager.id, label: "Wall length", value: "54", unit: "ft", notes: "Needs site verification" },
    ],
  });

  const estimateMaya = await createEstimate({
    orgId: org.id,
    userId: manager.id,
    leadId: leads[0].id,
    customerName: customers[0].name,
    siteAddress: customers[0].addressLine,
    number: "EST-210",
    status: "SENT",
    title: "Paver Patio and Privacy Planting",
    projectType: "Outdoor living",
    dates: { sentAt: hoursFromNow(-4), viewedAt: hoursFromNow(-2) },
    lines: [
      { name: "Paver patio installation", description: "Base prep, paver field, edge restraint, compaction", quantity: 420, unit: "sqft", unitPrice: 21 },
      { name: "Privacy planting package", description: "Evergreen screen, soil amendments, mulch", quantity: 1, unit: "package", unitPrice: 3850 },
      { name: "Low-voltage lighting allowance", description: "Path lights and transformer allowance", quantity: 1, unit: "allowance", unitPrice: 1650 },
      { name: "Project management", description: "Scheduling, mobilization, cleanup", quantity: 1, unit: "flat", unitPrice: 950, type: "LABOR" },
    ],
  });

  const estimateElena = await createEstimate({
    orgId: org.id,
    userId: manager.id,
    leadId: leads[2].id,
    customerName: customers[2].name,
    siteAddress: customers[2].addressLine,
    number: "EST-211",
    status: "APPROVED",
    title: "Outdoor Kitchen and Hardscape Phase 1",
    projectType: "Hardscape install",
    dates: { sentAt: daysFromNow(-7), viewedAt: daysFromNow(-6), approvedAt: daysFromNow(-5) },
    lines: [
      { name: "Outdoor kitchen base", description: "CMU base, veneer prep, countertop allowance", quantity: 1, unit: "phase", unitPrice: 13800 },
      { name: "Paver extension", description: "Dining area extension and landing", quantity: 310, unit: "sqft", unitPrice: 23 },
      { name: "Gas/electrical coordination", description: "Subcontractor coordination allowance", quantity: 1, unit: "allowance", unitPrice: 4200 },
      { name: "Install labor", description: "Crew labor and site management", quantity: 1, unit: "flat", unitPrice: 7900, type: "LABOR" },
    ],
  });

  await prisma.lead.updateMany({
    where: { id: { in: [leads[0].id, leads[2].id] } },
    data: { estimateCount: 1 },
  });
  await prisma.lead.update({ where: { id: leads[0].id }, data: { latestEstimateId: estimateMaya.id } });
  await prisma.lead.update({ where: { id: leads[2].id }, data: { latestEstimateId: estimateElena.id } });

  const elenaJob = await prisma.job.create({
    data: {
      orgId: org.id,
      createdByUserId: manager.id,
      customerId: customers[2].id,
      leadId: leads[2].id,
      sourceEstimateId: estimateElena.id,
      linkedEstimateId: estimateElena.id,
      customerName: customers[2].name,
      phone: customers[2].phoneE164,
      address: customers[2].addressLine,
      serviceType: "Hardscape installation",
      projectType: "Outdoor kitchen",
      scheduledDate: daysFromNow(5),
      scheduledStartTime: "08:00",
      scheduledEndTime: "15:30",
      dispatchStatus: "SCHEDULED",
      assignedCrewId: northCrew.id,
      crewOrder: 1,
      priority: "High",
      notes: "Approved estimate converted to active field job. Demo tracking link available.",
      costingNotes: "Watch gas/electrical allowance and paver overage.",
      status: "SCHEDULED",
    },
  });

  const jordanJob = await prisma.job.create({
    data: {
      orgId: org.id,
      createdByUserId: owner.id,
      customerId: customers[1].id,
      leadId: leads[1].id,
      customerName: customers[1].name,
      phone: customers[1].phoneE164,
      address: customers[1].addressLine,
      serviceType: "Drainage inspection",
      projectType: "Drainage",
      scheduledDate: daysFromNow(1),
      scheduledStartTime: "10:00",
      scheduledEndTime: "11:30",
      dispatchStatus: "SCHEDULED",
      assignedCrewId: installCrew.id,
      crewOrder: 1,
      priority: "High",
      notes: "Booked through missed-call SMS recovery.",
      status: "ESTIMATING",
    },
  });

  await prisma.event.createMany({
    data: [
      {
        orgId: org.id,
        leadId: leads[0].id,
        customerId: customers[0].id,
        type: "ESTIMATE",
        title: "Maya Thompson patio walkthrough",
        description: "Confirm patio area, planting screen, lighting allowance, and access.",
        startAt: daysFromNow(2),
        endAt: hoursFromNow(24 * 2 + 1),
        assignedToUserId: manager.id,
        createdByUserId: manager.id,
        customerName: customers[0].name,
        addressLine: customers[0].addressLine,
      },
      {
        orgId: org.id,
        leadId: leads[1].id,
        jobId: jordanJob.id,
        customerId: customers[1].id,
        type: "JOB",
        title: "Jordan Lee drainage walkthrough",
        description: "Inspect garage pooling and draft drain route.",
        startAt: daysFromNow(1),
        endAt: hoursFromNow(24 + 1.5),
        assignedToUserId: owner.id,
        createdByUserId: owner.id,
        customerName: customers[1].name,
        addressLine: customers[1].addressLine,
      },
      {
        orgId: org.id,
        leadId: leads[2].id,
        jobId: elenaJob.id,
        customerId: customers[2].id,
        type: "JOB",
        title: "Elena Parker outdoor kitchen install",
        description: "Phase 1 hardscape and kitchen base.",
        startAt: daysFromNow(5),
        endAt: hoursFromNow(24 * 5 + 7.5),
        assignedToUserId: field.id,
        createdByUserId: manager.id,
        customerName: customers[2].name,
        addressLine: customers[2].addressLine,
      },
    ],
  });

  const seededEvents = await prisma.event.findMany({
    where: { orgId: org.id, assignedToUserId: { not: null } },
    select: { id: true, orgId: true, assignedToUserId: true },
  });
  await prisma.calendarEventWorker.createMany({
    data: seededEvents.map((event) => ({
      orgId: event.orgId,
      eventId: event.id,
      workerUserId: event.assignedToUserId,
    })),
    skipDuplicates: true,
  });

  await prisma.jobMeasurement.createMany({
    data: [
      { orgId: org.id, jobId: elenaJob.id, label: "Paver extension", value: "310", unit: "sqft" },
      { orgId: org.id, jobId: elenaJob.id, label: "Kitchen base length", value: "14", unit: "ft" },
      { orgId: org.id, jobId: jordanJob.id, label: "Drain run estimate", value: "86", unit: "ft" },
    ],
  });

  await prisma.jobMaterial.createMany({
    data: [
      { orgId: org.id, jobId: elenaJob.id, materialId: materials[0].id, name: "Paver field stone", quantity: money(310), unit: "sqft", cost: money(5.4), markupPercent: money(45), total: money(2427.3), actualQuantity: money(300), actualUnitCost: money(5.25), actualTotal: money(1575), varianceNotes: "Demo actuals show under-use so far." },
      { orgId: org.id, jobId: jordanJob.id, materialId: materials[1].id, name: "Drain rock", quantity: money(4), unit: "ton", cost: money(58), markupPercent: money(35), total: money(313.2) },
    ],
  });

  await prisma.jobLabor.createMany({
    data: [
      { orgId: org.id, jobId: elenaJob.id, description: "Install crew day 1", quantity: money(32), unit: "hour", cost: money(52), markupPercent: money(45), total: money(2412.8), actualHours: money(30), actualHourlyCost: money(51), actualTotal: money(1530) },
      { orgId: org.id, jobId: jordanJob.id, description: "Drainage assessment", quantity: money(3), unit: "hour", cost: money(55), markupPercent: money(35), total: money(222.75) },
    ],
  });

  await prisma.jobEvent.createMany({
    data: [
      { orgId: org.id, jobId: elenaJob.id, eventType: "JOB_CREATED", actorUserId: manager.id, metadata: { demo: true, sourceEstimateId: estimateElena.id } },
      { orgId: org.id, jobId: elenaJob.id, eventType: "CREW_ASSIGNED", actorUserId: manager.id, toValue: northCrew.name },
      { orgId: org.id, jobId: jordanJob.id, eventType: "JOB_CREATED", actorUserId: owner.id, metadata: { demo: true, recoveredFromMissedCall: true } },
    ],
  });

  await prisma.jobTrackingLink.createMany({
    data: [
      { orgId: org.id, jobId: elenaJob.id, createdByUserId: manager.id, tokenHash: hashToken(randomBytes(32).toString("hex")) },
      { orgId: org.id, jobId: jordanJob.id, createdByUserId: owner.id, tokenHash: hashToken(randomBytes(32).toString("hex")) },
    ],
  });

  const invoiceElena = await prisma.invoice.create({
    data: {
      orgId: org.id,
      legacyLeadId: leads[2].id,
      sourceEstimateId: estimateElena.id,
      sourceJobId: elenaJob.id,
      customerId: customers[2].id,
      invoiceNumber: "INV-314",
      terms: "NET_7",
      status: "PARTIAL",
      subtotal: money(15000),
      taxRate: money(0),
      taxAmount: money(0),
      total: money(15000),
      amountPaid: money(7500),
      balanceDue: money(7500),
      issueDate: daysFromNow(-5),
      dueDate: daysFromNow(2),
      notes: "Demo deposit invoice tied to approved estimate and scheduled job.",
      sentAt: daysFromNow(-5),
      lastReminderSentAt: daysFromNow(-1),
      reminderCount: 1,
      createdByUserId: manager.id,
    },
  });

  const invoiceLuis = await prisma.invoice.create({
    data: {
      orgId: org.id,
      legacyLeadId: leads[3].id,
      customerId: customers[3].id,
      invoiceNumber: "INV-315",
      terms: "NET_15",
      status: "SENT",
      subtotal: money(700),
      taxRate: money(0),
      taxAmount: money(0),
      total: money(700),
      amountPaid: money(0),
      balanceDue: money(700),
      issueDate: daysFromNow(-2),
      dueDate: daysFromNow(13),
      notes: "First month maintenance plan invoice.",
      sentAt: daysFromNow(-2),
      createdByUserId: owner.id,
    },
  });

  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: invoiceElena.id, description: "Outdoor kitchen phase 1 deposit", quantity: money(1), unitPrice: money(15000), lineTotal: money(15000), sortOrder: 0 },
      { invoiceId: invoiceLuis.id, description: "Monthly maintenance plan - first month", quantity: money(1), unitPrice: money(700), lineTotal: money(700), sortOrder: 0 },
    ],
  });

  await prisma.invoicePayment.create({
    data: {
      invoiceId: invoiceElena.id,
      amount: money(7500),
      date: daysFromNow(-4),
      method: "CARD",
      note: "Demo card deposit payment.",
    },
  });

  await prisma.invoiceCollectionAttempt.createMany({
    data: [
      { orgId: org.id, invoiceId: invoiceElena.id, actorUserId: manager.id, source: "AUTOMATION", outcome: "SENT", reason: "Friendly reminder before remaining balance due." },
      { orgId: org.id, invoiceId: invoiceLuis.id, actorUserId: owner.id, source: "MANUAL", outcome: "SENT", reason: "First recurring plan invoice sent." },
    ],
  });

  await prisma.recurringServicePlan.create({
    data: {
      orgId: org.id,
      customerId: customers[3].id,
      createdByUserId: owner.id,
      name: "Monthly Landscape Care",
      description: "Mowing, bed cleanup, irrigation check, and seasonal color recommendations.",
      amount: money(700),
      currency: "usd",
      interval: "MONTH",
      intervalCount: 1,
      status: "ACTIVE",
      startsAt: daysFromNow(-2),
      nextBillingAt: daysFromNow(28),
      stripeCustomerId: "cus_demo_sales_luis",
      checkoutUrl: "https://checkout.stripe.com/demo/monthly-care",
    },
  });

  const po = await prisma.purchaseOrder.create({
    data: {
      orgId: org.id,
      jobId: elenaJob.id,
      createdByUserId: manager.id,
      poNumber: "PO-104",
      vendorName: "Northwest Stone Supply",
      vendorEmail: "orders@nwstone.demo",
      vendorPhone: "+15005550150",
      title: "Pavers and veneer for outdoor kitchen phase 1",
      status: "SENT",
      notes: "Demo purchase order tied to active job costing.",
      subtotal: money(4250),
      taxRate: money(0.101),
      taxAmount: money(429.25),
      total: money(4679.25),
      sentAt: daysFromNow(-2),
    },
  });

  await prisma.purchaseOrderLineItem.createMany({
    data: [
      { purchaseOrderId: po.id, materialId: materials[0].id, sortOrder: 0, name: "Paver field stone", description: "Outdoor kitchen paver extension", quantity: money(320), unit: "sqft", unitCost: money(5.4), total: money(1728) },
      { purchaseOrderId: po.id, sortOrder: 1, name: "Stone veneer allowance", description: "Kitchen base veneer", quantity: money(1), unit: "allowance", unitCost: money(2522), total: money(2522) },
    ],
  });

  await prisma.businessExpense.createMany({
    data: [
      { orgId: org.id, jobId: elenaJob.id, purchaseOrderId: po.id, createdByUserId: manager.id, expenseDate: daysFromNow(-1), vendorName: "Northwest Stone Supply", category: "Materials", description: "Paver deposit", amount: money(1800), notes: "Demo receipt would attach here." },
      { orgId: org.id, jobId: jordanJob.id, createdByUserId: owner.id, expenseDate: daysFromNow(-1), vendorName: "Rental Yard Demo", category: "Equipment", description: "Drain camera rental", amount: money(185), notes: "Demo operational expense." },
    ],
  });

  await prisma.budgetRequest.createMany({
    data: [
      { orgId: org.id, requestedByUserId: manager.id, requestedDailyCents: 52000, note: "Increase Google patio campaign budget while cost per booked walkthrough is low.", status: "PENDING" },
      { orgId: org.id, requestedByUserId: owner.id, reviewedByUserId: manager.id, requestedDailyCents: 38000, note: "Approved Meta irrigation retargeting test.", status: "APPROVED", reviewedAt: daysFromNow(-2) },
    ],
  });

  await prisma.adSpendEntry.createMany({
    data: [
      { orgId: org.id, createdByUserId: owner.id, spendDate: daysFromNow(-7), amountCents: 28600, source: "Google Ads", note: "Patio estimate search campaign" },
      { orgId: org.id, createdByUserId: owner.id, spendDate: daysFromNow(-6), amountCents: 31400, source: "Google Ads", note: "Drainage landing page" },
      { orgId: org.id, createdByUserId: manager.id, spendDate: daysFromNow(-5), amountCents: 12200, source: "Meta Ads", note: "Irrigation tune-up retargeting" },
      { orgId: org.id, createdByUserId: manager.id, spendDate: daysFromNow(-3), amountCents: 34100, source: "Google Ads", note: "Outdoor kitchen intent terms" },
    ],
  });

  await prisma.marketingSpend.createMany({
    data: [
      { orgId: org.id, monthStart: startOfMonth(-1), channel: "GOOGLE_ADS", spendCents: 684000, notes: "Prior month search campaigns", createdByUserId: owner.id },
      { orgId: org.id, monthStart: startOfMonth(-1), channel: "META_ADS", spendCents: 212000, notes: "Prior month retargeting", createdByUserId: manager.id },
      { orgId: org.id, monthStart: startOfMonth(0), channel: "GOOGLE_ADS", spendCents: 428000, notes: "Current month pacing", createdByUserId: owner.id },
      { orgId: org.id, monthStart: startOfMonth(0), channel: "META_ADS", spendCents: 98000, notes: "Current month pacing", createdByUserId: manager.id },
    ],
  });

  const websiteToken = randomBytes(24).toString("hex");
  const websiteSource = await prisma.websiteLeadSource.create({
    data: {
      orgId: org.id,
      name: "Cascade demo website form",
      description: "Sales demo source for website lead capture, spam protection, and idempotent submissions.",
      hashedSecret: createHash("sha256").update(websiteToken).digest("hex"),
      encryptedSecret: `demo:${websiteToken}`,
      allowedOrigin: "https://cascadeoutdoor.demo",
      active: true,
      rateLimitKey: "cascade-demo-website",
      lastUsedAt: hoursFromNow(-28),
    },
  });

  await prisma.websiteLeadSubmissionReceipt.create({
    data: {
      sourceId: websiteSource.id,
      orgId: org.id,
      idempotencyKey: "demo-maya-patio-request",
      requestHash: createHash("sha256").update("demo-maya-patio-request").digest("hex"),
      createdLeadId: leads[0].id,
      createdCustomerId: customers[0].id,
      createdAt: hoursFromNow(-28),
    },
  });

  const invoiceUrl = `${baseUrl}/app/invoices?orgId=${org.id}`;
  const inboxUrl = `${baseUrl}/app/inbox?orgId=${org.id}`;
  const jobsUrl = `${baseUrl}/app/jobs/records?orgId=${org.id}`;

  console.log(`Seeded sales demo account for ${org.name}.`);
  console.log(`Login: ${OWNER_EMAIL}`);
  console.log(`Cesar login: ${CESAR_EMAIL}`);
  console.log("Password: set from SALES_DEMO_PASSWORD.");
  console.log(`Inbox: ${inboxUrl}`);
  console.log(`Jobs: ${jobsUrl}`);
  console.log(`Invoices: ${invoiceUrl}`);
  console.log(`Featured SMS threads:`);
  console.log(`- Maya patio lead: ${baseUrl}/app/inbox?orgId=${org.id}&leadId=${leads[0].id}`);
  console.log(`- Jordan missed-call recovery: ${baseUrl}/app/inbox?orgId=${org.id}&leadId=${leads[1].id}`);
  console.log(`- Chris voicemail transcript: ${baseUrl}/app/inbox?orgId=${org.id}&leadId=${leads[5].id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
