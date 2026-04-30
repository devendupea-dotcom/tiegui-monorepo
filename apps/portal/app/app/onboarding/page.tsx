import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { sendOutboundSms } from "@/lib/sms";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { ensureTimeZone, isValidTimeZone, toUtcFromLocalDateTime } from "@/lib/calendar/dates";
import { getPhotoStorageReadiness } from "@/lib/storage";
import { trackPortalEvent } from "@/lib/telemetry";
import { createProvisionedPortalUser, syncClientUserOrganizationAccess } from "@/lib/user-provisioning";
import { getParam, requireAppOrgActor, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";
import OnboardingTeamBuilder from "./onboarding-team-builder";

export const dynamic = "force-dynamic";

type OnboardingStep = 1 | 2 | 3 | 4 | 5;
type VisibleOnboardingStep = 1 | 2 | 3 | 4;

const ONBOARDING_STEPS: Array<{ value: VisibleOnboardingStep; label: string }> = [
  { value: 1, label: "Business Setup" },
  { value: 2, label: "Scheduling Rules" },
  { value: 3, label: "Notifications" },
  { value: 4, label: "Go Live" },
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SMS_BUSINESS_TYPE_OPTIONS = [
  { value: "Sole Proprietor", label: "Sole proprietor" },
  { value: "Limited Liability Corporation", label: "LLC" },
  { value: "Corporation", label: "Corporation" },
  { value: "Partnership", label: "Partnership" },
  { value: "Non-profit Corporation", label: "Nonprofit" },
] as const;
const SMS_INDUSTRY_OPTIONS = [
  { value: "CONSTRUCTION", label: "Construction / trades" },
  { value: "REAL_ESTATE", label: "Real estate / builders" },
  { value: "PROFESSIONAL_SERVICES", label: "Professional services" },
  { value: "CONSUMER", label: "Home services" },
  { value: "RETAIL", label: "Retail" },
  { value: "TRANSPORTATION", label: "Transportation" },
] as const;
const SMS_REGISTRATION_IDENTIFIER_OPTIONS = [
  { value: "EIN", label: "Business has an EIN" },
  { value: "NONE_SOLE_PROPRIETOR", label: "No EIN, sole proprietor" },
  { value: "COLLECT_OFF_PLATFORM", label: "Need to confirm outside the app" },
] as const;
const SMS_COMPANY_TYPE_OPTIONS = [
  { value: "private", label: "Private company" },
  { value: "public", label: "Public company" },
  { value: "non-profit", label: "Nonprofit" },
  { value: "government", label: "Government" },
] as const;
const SMS_JOB_POSITION_OPTIONS = [
  { value: "CEO", label: "Owner / CEO" },
  { value: "GM", label: "General manager" },
  { value: "Director", label: "Director" },
  { value: "VP", label: "VP" },
  { value: "CFO", label: "CFO" },
  { value: "General Counsel", label: "General counsel" },
  { value: "Other", label: "Other" },
] as const;
const SMS_CAMPAIGN_USE_CASE_OPTIONS = [
  { value: "LOW_VOLUME", label: "Low-volume customer texting" },
  { value: "CUSTOMER_CARE", label: "Customer care" },
  { value: "ACCOUNT_NOTIFICATION", label: "Job and account updates" },
  { value: "MIXED", label: "Customer care + reminders + follow-up" },
  { value: "SOLE_PROPRIETOR", label: "Sole proprietor texting" },
] as const;

type OnboardingWorker = {
  id: string;
  name: string | null;
  email: string;
  phoneE164: string | null;
  timezone: string | null;
  calendarAccessRole: "OWNER" | "ADMIN" | "WORKER" | "READ_ONLY";
  createdAt: Date;
};

function formatWorkingDaysSummary(days: number[]): string {
  const uniqueDays = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
  if (uniqueDays.length === 0) return "Mon-Fri";
  if (uniqueDays.length === 7) return "Every day";
  const weekdays = [1, 2, 3, 4, 5];
  if (weekdays.every((day) => uniqueDays.includes(day)) && uniqueDays.length === weekdays.length) {
    return "Mon-Fri";
  }
  return uniqueDays.map((day) => WEEKDAY_LABELS[day] || "").join(", ");
}

function clampStep(value: string): OnboardingStep {
  if (value === "2") return 2;
  if (value === "3") return 3;
  if (value === "4") return 4;
  if (value === "finish" || value === "5") return 5;
  return 1;
}

function parseTimeToMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1] || "", 10);
  const minute = Number.parseInt(match[2] || "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function readFormString(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

function optionalFormString(formData: FormData, key: string): string | null {
  const value = readFormString(formData, key);
  return value || null;
}

function withHttpsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function parseOptionalPositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function isBasicEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function onboardingUrl(orgId: string, internalUser: boolean, step: OnboardingStep | "finish", query?: Record<string, string>) {
  const base = withOrgQuery(`/app/onboarding?step=${step === 5 ? "finish" : step}`, orgId, internalUser);
  if (!query || Object.keys(query).length === 0) {
    return base;
  }
  const extra = new URLSearchParams(query).toString();
  return `${base}&${extra}`;
}

async function requireOnboardingEditor(orgId: string) {
  const actor = await requireAppOrgActor("/app/onboarding", orgId);
  const canEdit =
    actor.internalUser || actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";
  if (!canEdit) {
    redirect("/app");
  }

  return {
    id: actor.id,
    internalUser: actor.internalUser,
    orgId: actor.orgId,
    calendarAccessRole: actor.calendarAccessRole,
  };
}

async function listOrganizationWorkers(orgId: string): Promise<OnboardingWorker[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      user: {
        role: "CLIENT",
      },
    },
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phoneE164: true,
          timezone: true,
          createdAt: true,
        },
      },
    },
  });

  return rows
    .map((row) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      phoneE164: row.user.phoneE164,
      timezone: row.user.timezone,
      calendarAccessRole: row.role,
      createdAt: row.user.createdAt,
    }))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .slice(0, 50);
}

async function listSchedulableWorkerIds(orgId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: { not: "READ_ONLY" },
      user: {
        role: "CLIENT",
      },
    },
    select: {
      userId: true,
      user: {
        select: {
          createdAt: true,
        },
      },
    },
  });

  return rows
    .sort((left, right) => left.user.createdAt.getTime() - right.user.createdAt.getTime())
    .map((row) => row.userId);
}

async function saveBasicsAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);

  const businessName = String(formData.get("businessName") || "").trim();
  const timezoneRaw = String(formData.get("calendarTimezone") || "").trim();
  const slotRaw = Number.parseInt(String(formData.get("defaultSlotMinutes") || "30"), 10);
  const startTimeRaw = String(formData.get("workStartTime") || "08:00").trim();
  const endTimeRaw = String(formData.get("workEndTime") || "17:00").trim();
  const workingDayValues = formData
    .getAll("workingDay")
    .map((item) => Number.parseInt(String(item || ""), 10))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6);
  const defaultWorkingDays = [1, 2, 3, 4, 5];
  const selectedWorkingDays = new Set<number>(workingDayValues.length > 0 ? workingDayValues : defaultWorkingDays);

  if (!businessName) {
    redirect(onboardingUrl(orgId, actor.internalUser, 1, { error: "name" }));
  }

  if (!isValidTimeZone(timezoneRaw)) {
    redirect(onboardingUrl(orgId, actor.internalUser, 1, { error: "timezone" }));
  }

  const defaultSlotMinutes = slotRaw === 60 || slotRaw === 90 ? slotRaw : 30;
  const startMinute = parseTimeToMinute(startTimeRaw);
  const endMinute = parseTimeToMinute(endTimeRaw);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) {
    redirect(onboardingUrl(orgId, actor.internalUser, 1, { error: "hours" }));
  }

  const timeZone = ensureTimeZone(timezoneRaw);
  const workerIds = await listSchedulableWorkerIds(orgId);

  const workingHoursWrites = workerIds.flatMap((workerUserId) =>
    Array.from({ length: 7 }, (_, dayOfWeek) =>
      prisma.workingHours.upsert({
        where: {
          orgId_workerUserId_dayOfWeek: {
            orgId,
            workerUserId,
            dayOfWeek,
          },
        },
        update: {
          isWorking: selectedWorkingDays.has(dayOfWeek),
          startMinute,
          endMinute,
          timezone: timeZone,
        },
        create: {
          orgId,
          workerUserId,
          dayOfWeek,
          isWorking: selectedWorkingDays.has(dayOfWeek),
          startMinute,
          endMinute,
          timezone: timeZone,
        },
      }),
    ),
  );

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: orgId },
      data: {
        name: businessName,
        onboardingStep: 1,
        onboardingSkippedAt: null,
      },
    }),
    prisma.orgDashboardConfig.upsert({
      where: { orgId },
      update: {
        calendarTimezone: timeZone,
        defaultSlotMinutes,
      },
      create: {
        orgId,
        calendarTimezone: timeZone,
        defaultSlotMinutes,
      },
    }),
    ...workingHoursWrites,
  ]);

  await trackPortalEvent("Onboarding Started", {
    orgId,
    actorId: actor.id,
    internalUser: actor.internalUser,
    step: 1,
  });

  revalidatePath("/app");
  revalidatePath("/app/calendar");
  revalidatePath("/app/onboarding");

  redirect(onboardingUrl(orgId, actor.internalUser, 2));
}

async function saveTeamAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);

  const orgSettings = await getOrgCalendarSettings(orgId);
  const fallbackTimezone = orgSettings.calendarTimezone;

  const existingIds = formData.getAll("existingWorkerId").map((item) => String(item || "").trim()).filter(Boolean);
  const existingRoles = formData.getAll("existingWorkerRole").map((item) => String(item || "").trim().toUpperCase());
  const existingTimezones = formData.getAll("existingWorkerTimezone").map((item) => String(item || "").trim());
  const existingPhones = formData.getAll("existingWorkerPhone").map((item) => String(item || "").trim());

  for (let index = 0; index < existingIds.length; index += 1) {
    const workerId = existingIds[index];
    if (!workerId) continue;
    const nextRole = existingRoles[index] === "OWNER" ? "OWNER" : "WORKER";
    const timezoneRaw = existingTimezones[index] || fallbackTimezone;
    const timezone = isValidTimeZone(timezoneRaw) ? ensureTimeZone(timezoneRaw) : fallbackTimezone;
    const phoneNormalized = normalizeE164(existingPhones[index] || null);
    const existingWorker = await prisma.user.findFirst({
      where: {
        id: workerId,
        role: "CLIENT",
        OR: [
          { orgId },
          {
            organizationMemberships: {
              some: {
                organizationId: orgId,
                status: "ACTIVE",
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!existingWorker) {
      redirect(onboardingUrl(orgId, actor.internalUser, 2, { error: "worker" }));
    }

    await prisma.$transaction(async (tx) => {
      await syncClientUserOrganizationAccess({
        tx,
        userId: workerId,
        organizationId: orgId,
        role: nextRole,
      });

      await tx.user.update({
        where: { id: workerId },
        data: {
          timezone,
          phoneE164: phoneNormalized,
        },
      });
    });
  }

  for (let index = 0; index < 3; index += 1) {
    const name = String(formData.get(`newWorkerName_${index}`) || "").trim();
    const emailRaw = String(formData.get(`newWorkerEmail_${index}`) || "").trim().toLowerCase();
    const phoneRaw = String(formData.get(`newWorkerPhone_${index}`) || "").trim();
    const roleRaw = String(formData.get(`newWorkerRole_${index}`) || "WORKER").trim().toUpperCase();
    const timezoneRaw = String(formData.get(`newWorkerTimezone_${index}`) || "").trim();

    if (!name && !emailRaw && !phoneRaw) {
      continue;
    }

    const email = emailRaw || `worker-${orgId.slice(0, 8)}-${Date.now()}-${index}@placeholder.local`;
    const role = roleRaw === "OWNER" ? "OWNER" : "WORKER";
    const timezone = isValidTimeZone(timezoneRaw) ? ensureTimeZone(timezoneRaw) : fallbackTimezone;
    const phoneE164 = phoneRaw ? normalizeE164(phoneRaw) : null;
    if (phoneRaw && !phoneE164) {
      redirect(onboardingUrl(orgId, actor.internalUser, 2, { error: "phone" }));
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        orgId: true,
        organizationMemberships: {
          where: {
            organizationId: orgId,
            status: "ACTIVE",
          },
          select: {
            organizationId: true,
          },
        },
      },
    });

    const existingHasTargetMembership = Boolean(existing?.organizationMemberships?.[0]);
    if (existing && (existing.role !== "CLIENT" || (!existingHasTargetMembership && existing.orgId !== orgId))) {
      redirect(onboardingUrl(orgId, actor.internalUser, 2, { error: "email" }));
    }

    if (existing) {
      await prisma.$transaction(async (tx) => {
        await syncClientUserOrganizationAccess({
          tx,
          userId: existing.id,
          organizationId: orgId,
          role,
        });

        await tx.user.update({
          where: { id: existing.id },
          data: {
            name: name || undefined,
            timezone,
            phoneE164,
          },
        });
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await createProvisionedPortalUser({
          tx,
          email,
          name: name || "Worker",
          role: "CLIENT",
          orgId,
          calendarAccessRole: role,
          phoneE164,
          timezone,
          mustChangePassword: false,
        });
      });
    }
  }

  const workerCount = await prisma.organizationMembership.count({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: { in: ["OWNER", "WORKER", "ADMIN"] },
      user: {
        role: "CLIENT",
      },
    },
  });

  if (workerCount === 0 && !actor.internalUser) {
    await prisma.$transaction(async (tx) => {
      await syncClientUserOrganizationAccess({
        tx,
        userId: actor.id,
        organizationId: orgId,
        role: "OWNER",
      });
    });
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      onboardingStep: 2,
      onboardingSkippedAt: null,
    },
  });

  revalidatePath("/app");
  revalidatePath("/app/onboarding");
  revalidatePath("/app/calendar");

  redirect(onboardingUrl(orgId, actor.internalUser, 3));
}

async function saveCalendarRulesAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);

  const allowOverlaps = String(formData.get("allowOverlaps") || "") === "on";
  const roundRobinEnabled = String(formData.get("roundRobinEnabled") || "") === "on";
  const timeOffDate = String(formData.get("timeOffDate") || "").trim();
  const timeOffStart = String(formData.get("timeOffStart") || "").trim();
  const timeOffEnd = String(formData.get("timeOffEnd") || "").trim();
  const timeOffWorkerId = String(formData.get("timeOffWorkerId") || "").trim();

  const settings = await getOrgCalendarSettings(orgId);
  const workerIds = await listSchedulableWorkerIds(orgId);
  const roundRobinLastWorkerId = roundRobinEnabled ? workerIds[0] || null : null;

  await prisma.orgDashboardConfig.upsert({
    where: { orgId },
    update: {
      allowOverlaps,
      roundRobinLastWorkerId,
    },
    create: {
      orgId,
      allowOverlaps,
      roundRobinLastWorkerId,
    },
  });

  if (timeOffDate && timeOffStart && timeOffEnd && timeOffWorkerId) {
    const startAt = toUtcFromLocalDateTime({
      date: timeOffDate,
      time: timeOffStart,
      timeZone: settings.calendarTimezone,
    });
    const endAt = toUtcFromLocalDateTime({
      date: timeOffDate,
      time: timeOffEnd,
      timeZone: settings.calendarTimezone,
    });
    if (endAt <= startAt) {
      redirect(onboardingUrl(orgId, actor.internalUser, 3, { error: "timeoff" }));
    }

    await prisma.timeOff.create({
      data: {
        orgId,
        workerUserId: timeOffWorkerId,
        startAt,
        endAt,
        reason: "Onboarding quick add",
      },
    });
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      onboardingStep: 3,
      onboardingSkippedAt: null,
    },
  });

  revalidatePath("/app/calendar");
  revalidatePath("/app/onboarding");

  redirect(onboardingUrl(orgId, actor.internalUser, 4));
}

async function saveSmsRegistrationAction(formData: FormData) {
  "use server";

  const orgId = readFormString(formData, "orgId");
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);

  const businessName = readFormString(formData, "smsBusinessName");
  const brandName = optionalFormString(formData, "smsBrandName");
  const businessType = readFormString(formData, "smsBusinessType") || "Limited Liability Corporation";
  const businessIndustry = readFormString(formData, "smsBusinessIndustry") || "CONSTRUCTION";
  const businessRegistrationIdentifier = readFormString(formData, "smsBusinessRegistrationIdentifier") || "EIN";
  const companyType = readFormString(formData, "smsCompanyType") || "private";
  const websiteUrl = withHttpsUrl(readFormString(formData, "smsWebsiteUrl"));
  const socialMediaProfileUrls = optionalFormString(formData, "smsSocialMediaProfileUrls");
  const customerName = readFormString(formData, "smsCustomerName") || businessName;
  const street = readFormString(formData, "smsStreet");
  const streetSecondary = optionalFormString(formData, "smsStreetSecondary");
  const city = readFormString(formData, "smsCity");
  const region = readFormString(formData, "smsRegion").toUpperCase();
  const postalCode = readFormString(formData, "smsPostalCode");
  const authorizedFirstName = readFormString(formData, "smsAuthorizedFirstName");
  const authorizedLastName = readFormString(formData, "smsAuthorizedLastName");
  const authorizedTitle = readFormString(formData, "smsAuthorizedTitle");
  const authorizedJobPosition = readFormString(formData, "smsAuthorizedJobPosition") || "CEO";
  const authorizedPhoneRaw = readFormString(formData, "smsAuthorizedPhoneE164");
  const authorizedEmail = readFormString(formData, "smsAuthorizedEmail");
  const brandContactEmail = optionalFormString(formData, "smsBrandContactEmail");
  const campaignUseCase = readFormString(formData, "smsCampaignUseCase") || "LOW_VOLUME";
  const campaignDescription = readFormString(formData, "smsCampaignDescription");
  const messageFlow = readFormString(formData, "smsMessageFlow");
  const privacyPolicyUrl = optionalFormString(formData, "smsPrivacyPolicyUrl");
  const termsOfServiceUrl = optionalFormString(formData, "smsTermsOfServiceUrl");
  const optInProofUrl = optionalFormString(formData, "smsOptInProofUrl");
  const sampleMessage1 = readFormString(formData, "smsSampleMessage1");
  const sampleMessage2 = readFormString(formData, "smsSampleMessage2");
  const sampleMessage3 = optionalFormString(formData, "smsSampleMessage3");
  const sampleMessage4 = optionalFormString(formData, "smsSampleMessage4");
  const sampleMessage5 = optionalFormString(formData, "smsSampleMessage5");
  const optInKeywords = optionalFormString(formData, "smsOptInKeywords");
  const optInMessage = optionalFormString(formData, "smsOptInMessage");
  const optOutKeywords = optionalFormString(formData, "smsOptOutKeywords") || "STOP";
  const optOutMessage =
    optionalFormString(formData, "smsOptOutMessage") ||
    `${brandName || businessName}: you are opted out and will not receive more texts.`;
  const helpKeywords = optionalFormString(formData, "smsHelpKeywords") || "HELP";
  const helpMessage =
    optionalFormString(formData, "smsHelpMessage") ||
    `${brandName || businessName}: reply STOP to opt out or call us for help.`;
  const estimatedMonthlyMessages = parseOptionalPositiveInt(readFormString(formData, "smsEstimatedMonthlyMessages"));
  const desiredSenderRaw = readFormString(formData, "smsDesiredSenderNumberE164");
  const customerConsentConfirmed = String(formData.get("smsCustomerConsentConfirmed") || "") === "on";
  const registrationSubmissionAuthorized =
    String(formData.get("smsRegistrationSubmissionAuthorized") || "") === "on";

  const requiredValues = [
    businessName,
    businessType,
    businessIndustry,
    websiteUrl,
    customerName,
    street,
    city,
    region,
    postalCode,
    authorizedFirstName,
    authorizedLastName,
    authorizedTitle,
    authorizedJobPosition,
    authorizedPhoneRaw,
    authorizedEmail,
    campaignUseCase,
  ];
  if (requiredValues.some((value) => !value)) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-required" }));
  }

  const authorizedPhoneE164 = normalizeE164(authorizedPhoneRaw);
  const desiredSenderNumberE164 = desiredSenderRaw ? normalizeE164(desiredSenderRaw) : null;
  if (!authorizedPhoneE164 || (desiredSenderRaw && !desiredSenderNumberE164)) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-phone" }));
  }
  if (!isBasicEmail(authorizedEmail) || (brandContactEmail && !isBasicEmail(brandContactEmail))) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-email" }));
  }
  if (campaignDescription.length < 40 || messageFlow.length < 40) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-campaign" }));
  }
  const optionalSamples = [sampleMessage3, sampleMessage4, sampleMessage5].filter(Boolean) as string[];
  if (sampleMessage1.length < 20 || sampleMessage2.length < 20 || optionalSamples.some((sample) => sample.length < 20)) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-samples" }));
  }
  if (!customerConsentConfirmed || !registrationSubmissionAuthorized) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-consent" }));
  }

  await prisma.organizationSmsRegistrationApplication.upsert({
    where: { orgId },
    update: {
      status: "READY_FOR_REVIEW",
      businessName,
      brandName,
      businessType,
      businessIndustry,
      businessRegistrationIdentifier,
      companyType,
      websiteUrl,
      socialMediaProfileUrls,
      customerName,
      street,
      streetSecondary,
      city,
      region,
      postalCode,
      authorizedFirstName,
      authorizedLastName,
      authorizedTitle,
      authorizedJobPosition,
      authorizedPhoneE164,
      authorizedEmail,
      brandContactEmail,
      campaignUseCase,
      campaignDescription,
      messageFlow,
      privacyPolicyUrl: privacyPolicyUrl ? withHttpsUrl(privacyPolicyUrl) : null,
      termsOfServiceUrl: termsOfServiceUrl ? withHttpsUrl(termsOfServiceUrl) : null,
      optInProofUrl: optInProofUrl ? withHttpsUrl(optInProofUrl) : null,
      sampleMessage1,
      sampleMessage2,
      sampleMessage3,
      sampleMessage4,
      sampleMessage5,
      hasEmbeddedLinks: String(formData.get("smsHasEmbeddedLinks") || "") === "on",
      hasEmbeddedPhone: String(formData.get("smsHasEmbeddedPhone") || "") === "on",
      optInKeywords,
      optInMessage,
      optOutKeywords,
      optOutMessage,
      helpKeywords,
      helpMessage,
      estimatedMonthlyMessages,
      desiredSenderNumberE164,
      customerConsentConfirmed,
      registrationSubmissionAuthorized,
      submittedAt: new Date(),
    },
    create: {
      orgId,
      status: "READY_FOR_REVIEW",
      businessName,
      brandName,
      businessType,
      businessIndustry,
      businessRegistrationIdentifier,
      companyType,
      websiteUrl,
      socialMediaProfileUrls,
      customerName,
      street,
      streetSecondary,
      city,
      region,
      postalCode,
      authorizedFirstName,
      authorizedLastName,
      authorizedTitle,
      authorizedJobPosition,
      authorizedPhoneE164,
      authorizedEmail,
      brandContactEmail,
      campaignUseCase,
      campaignDescription,
      messageFlow,
      privacyPolicyUrl: privacyPolicyUrl ? withHttpsUrl(privacyPolicyUrl) : null,
      termsOfServiceUrl: termsOfServiceUrl ? withHttpsUrl(termsOfServiceUrl) : null,
      optInProofUrl: optInProofUrl ? withHttpsUrl(optInProofUrl) : null,
      sampleMessage1,
      sampleMessage2,
      sampleMessage3,
      sampleMessage4,
      sampleMessage5,
      hasEmbeddedLinks: String(formData.get("smsHasEmbeddedLinks") || "") === "on",
      hasEmbeddedPhone: String(formData.get("smsHasEmbeddedPhone") || "") === "on",
      optInKeywords,
      optInMessage,
      optOutKeywords,
      optOutMessage,
      helpKeywords,
      helpMessage,
      estimatedMonthlyMessages,
      desiredSenderNumberE164,
      customerConsentConfirmed,
      registrationSubmissionAuthorized,
      submittedAt: new Date(),
    },
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      onboardingStep: 4,
      onboardingSkippedAt: null,
    },
  });

  revalidatePath("/app/onboarding");
  revalidatePath(`/hq/orgs/${orgId}/twilio`);

  redirect(onboardingUrl(orgId, actor.internalUser, 4, { smsApplication: "saved" }));
}

async function deleteSmsRegistrationAction(formData: FormData) {
  "use server";

  const orgId = readFormString(formData, "orgId");
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);
  const confirmation = readFormString(formData, "deleteSmsApplicationConfirm");

  if (confirmation !== "DELETE") {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sms-delete-confirm" }));
  }

  await prisma.organizationSmsRegistrationApplication.deleteMany({
    where: { orgId },
  });

  revalidatePath("/app/onboarding");
  revalidatePath(`/hq/orgs/${orgId}/twilio`);

  redirect(onboardingUrl(orgId, actor.internalUser, 4, { smsApplication: "deleted" }));
}

async function saveMessagingAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);

  const intent = String(formData.get("intent") || "save").trim();
  const enableTexting = String(formData.get("enableTexting") || "") === "on";
  const senderRaw = String(formData.get("smsFromNumberE164") || "").trim();
  const testPhoneRaw = String(formData.get("testPhoneE164") || "").trim();

  const sender = senderRaw ? normalizeE164(senderRaw) : null;
  if (senderRaw && !sender) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sender" }));
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      smsFromNumberE164: sender,
      missedCallAutoReplyOn: enableTexting && Boolean(sender),
      onboardingStep: 4,
      onboardingSkippedAt: null,
    },
  });

  if (enableTexting && sender) {
    await trackPortalEvent("SMS Connected", {
      orgId,
      actorId: actor.id,
      step: 4,
    });
  }

  if (intent === "test") {
    const toNumber = normalizeE164(testPhoneRaw);
    if (!toNumber) {
      redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "test-number" }));
    }

    const result = await sendOutboundSms({
      orgId,
      fromNumberE164: sender,
      toNumberE164: toNumber,
      body: "TieGui onboarding test: this confirms SMS routing is configured.",
      allowPendingA2P: true,
    });
    const notice = result.notice ? encodeURIComponent(result.notice) : "sent";
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { smsTest: notice }));
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/onboarding");

  redirect(onboardingUrl(orgId, actor.internalUser, 4, { saved: "1" }));
}

async function completeOnboardingAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);
  const enableTexting = String(formData.get("enableTexting") || "") === "on";
  const senderRaw = String(formData.get("smsFromNumberE164") || "").trim();
  const sender = senderRaw ? normalizeE164(senderRaw) : null;

  if (senderRaw && !sender) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "sender" }));
  }

  const onboardingState = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      onboardingStep: true,
      smsFromNumberE164: true,
      smsRegistrationApplication: {
        select: {
          id: true,
        },
      },
    },
  });

  const effectiveSender = sender || onboardingState?.smsFromNumberE164 || null;
  const businessSetupComplete = (onboardingState?.onboardingStep || 0) >= 1;
  const schedulingRulesComplete = (onboardingState?.onboardingStep || 0) >= 3;
  const notificationsComplete = Boolean(effectiveSender || onboardingState?.smsRegistrationApplication);
  if (!businessSetupComplete || !schedulingRulesComplete || !notificationsComplete) {
    redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "go-live-prereq" }));
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      smsFromNumberE164: effectiveSender,
      missedCallAutoReplyOn: enableTexting && Boolean(effectiveSender),
      onboardingStep: 4,
      onboardingCompletedAt: new Date(),
      onboardingSkippedAt: null,
    },
  });

  await trackPortalEvent("Onboarding Completed", {
    orgId,
    actorId: actor.id,
    internalUser: actor.internalUser,
  });

  revalidatePath("/app");
  revalidatePath("/app/onboarding");
  revalidatePath(`/hq/businesses/${orgId}`);

  redirect(onboardingUrl(orgId, actor.internalUser, "finish"));
}

export default async function AppOnboardingPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/onboarding", requestedOrgId });
  await requireOnboardingEditor(scope.orgId);

  const step = clampStep(getParam(searchParams?.step) || "1");
  const activeStep: VisibleOnboardingStep = step === 5 ? 4 : step;
  const progressPercent = Math.round((activeStep / ONBOARDING_STEPS.length) * 100);
  const error = getParam(searchParams?.error);
  const saved = getParam(searchParams?.saved);
  const smsTest = getParam(searchParams?.smsTest);
  const smsApplicationNotice = getParam(searchParams?.smsApplication);

  const [organization, settings, workers, workingDayRows] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: {
        id: true,
        name: true,
        legalName: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zip: true,
        phone: true,
        email: true,
        website: true,
        ein: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingSkippedAt: true,
        smsFromNumberE164: true,
        smsRegistrationApplication: true,
        dashboardConfig: {
          select: {
            roundRobinLastWorkerId: true,
          },
        },
      },
    }),
    getOrgCalendarSettings(scope.orgId),
    listOrganizationWorkers(scope.orgId),
    prisma.workingHours.findMany({
      where: {
        orgId: scope.orgId,
        isWorking: true,
      },
      select: {
        dayOfWeek: true,
      },
      distinct: ["dayOfWeek"],
      orderBy: [{ dayOfWeek: "asc" }],
    }),
  ]);

  if (!organization) {
    redirect(scope.internalUser ? "/hq/businesses" : "/app");
  }

  const workerCandidates = workers.filter((worker) => worker.calendarAccessRole !== "READ_ONLY");
  const preferredWorkerId = workerCandidates[0]?.id || null;
  let firstLeadHref = withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser);
  if (preferredWorkerId) {
    const dateKey = formatInTimeZone(new Date(), settings.calendarTimezone, "yyyy-MM-dd");
    const availability = await computeAvailabilityForWorker({
      orgId: scope.orgId,
      workerUserId: preferredWorkerId,
      date: dateKey,
      durationMinutes: settings.defaultSlotMinutes,
      stepMinutes: 30,
      settings,
    });
    const slot = availability.slotsUtc.find((item) => new Date(item).getTime() >= Date.now()) || availability.slotsUtc[0];
    if (slot) {
      const params = new URLSearchParams();
      params.set("quickAdd", "1");
      params.set("quickStart", slot);
      params.set("quickDuration", String(settings.defaultSlotMinutes));
      params.set("quickWorkerId", preferredWorkerId);
      if (scope.internalUser) {
        params.set("orgId", scope.orgId);
      }
      firstLeadHref = `/app?${params.toString()}`;
    }
  }

  const twilioReady = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  const photoStorage = getPhotoStorageReadiness();
  const workingDaysSummary = formatWorkingDaysSummary(workingDayRows.map((item) => item.dayOfWeek));
  const crewCount = Math.max(1, workerCandidates.length || workers.length);
  const businessSetupComplete = (organization.onboardingStep || 0) >= 1;
  const schedulingRulesComplete = (organization.onboardingStep || 0) >= 3;
  const smsRegistrationComplete = Boolean(organization.smsRegistrationApplication);
  const notificationsComplete = Boolean(organization.smsFromNumberE164 || smsRegistrationComplete);
  const canGoLive = businessSetupComplete && schedulingRulesComplete && notificationsComplete;
  const smsApplication = organization.smsRegistrationApplication;
  const sampleBrandName = smsApplication?.brandName || organization.name;

  return (
    <section className="card onboarding-shell">
      <h2>5-Minute Onboarding</h2>
      <p className="muted">Finish setup in under 5 minutes.</p>
      <p className="muted onboarding-promise">This unlocks scheduling, job tracking, and follow-ups on mobile.</p>
      <p className="muted">Workspace: {organization.name}</p>

      <div className="onboarding-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="tab-row onboarding-steps" style={{ marginTop: 12 }}>
        {ONBOARDING_STEPS.map((item) => {
          const stepLocked = item.value === 4 && (!businessSetupComplete || !schedulingRulesComplete);
          return (
            <span
              key={item.value}
              title={stepLocked ? "Complete Business Setup + Scheduling rules to go live." : undefined}
              className={`tab-chip onboarding-step-chip ${activeStep === item.value ? "active" : ""} ${activeStep > item.value ? "done" : ""} ${stepLocked ? "disabled" : ""}`}
            >
              <span className="onboarding-step-number">{item.value}.</span> {item.label}
            </span>
          );
        })}
      </div>

      {step === 1 ? (
        <form action={saveBasicsAction} className="auth-form" style={{ marginTop: 14 }}>
          <input type="hidden" name="orgId" value={scope.orgId} />

          <label>
            Business name
            <input name="businessName" defaultValue={organization.name} required />
          </label>

          <label>
            Org timezone
            <input name="calendarTimezone" defaultValue={settings.calendarTimezone} placeholder="America/Los_Angeles" />
          </label>

          <label>
            Default slot minutes
            <select name="defaultSlotMinutes" defaultValue={String(settings.defaultSlotMinutes)}>
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="90">90</option>
            </select>
          </label>

          <div className="stack-cell">
            <strong>Working days</strong>
            <div className="template-pills">
              {[
                { day: 1, label: "Mon" },
                { day: 2, label: "Tue" },
                { day: 3, label: "Wed" },
                { day: 4, label: "Thu" },
                { day: 5, label: "Fri" },
                { day: 6, label: "Sat" },
                { day: 0, label: "Sun" },
              ].map((item) => (
                <label key={item.day} className="inline-toggle">
                  <input type="checkbox" name="workingDay" value={String(item.day)} defaultChecked={item.day >= 1 && item.day <= 5} />
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid two-col">
            <label>
              Start time
              <input type="time" name="workStartTime" defaultValue="08:00" />
            </label>
            <label>
              End time
              <input type="time" name="workEndTime" defaultValue="17:00" />
            </label>
          </div>

          {error === "name" ? <p className="form-status">Business name is required.</p> : null}
          {error === "timezone" ? <p className="form-status">Enter a valid IANA timezone.</p> : null}
          {error === "hours" ? <p className="form-status">End time must be after start time.</p> : null}
          <div className="onboarding-sticky-actions">
            <Link className="btn secondary" href={withOrgQuery("/app", scope.orgId, scope.internalUser)}>
              Back
            </Link>
            <button className="btn primary" type="submit">
              Save &amp; Continue
            </button>
          </div>
        </form>
      ) : null}

      {step === 2 ? (
        <form action={saveTeamAction} className="auth-form" style={{ marginTop: 14 }}>
          <input type="hidden" name="orgId" value={scope.orgId} />

          <h3 className="onboarding-section-title">Existing team</h3>
          {workers.length === 0 ? <p className="muted">No workers yet. Add your first team member below.</p> : null}
          {workers.map((worker) => (
            <div key={worker.id} className="card onboarding-team-card">
              <input type="hidden" name="existingWorkerId" value={worker.id} />
              <input type="hidden" name="existingWorkerTimezone" value={settings.calendarTimezone} />
              <p>
                <strong>{worker.name || worker.email}</strong>
              </p>
              <div className="grid two-col">
                <label>
                  Role
                  <select name="existingWorkerRole" defaultValue={worker.calendarAccessRole === "OWNER" ? "OWNER" : "WORKER"}>
                    <option value="OWNER">Owner</option>
                    <option value="WORKER">Worker</option>
                  </select>
                </label>
              </div>
              <label>
                Phone (optional)
                <input name="existingWorkerPhone" defaultValue={worker.phoneE164 || ""} placeholder="+12065550111" />
                <small className="muted onboarding-field-help">
                  Used for job alerts and quick call/text from the portal.
                </small>
              </label>
            </div>
          ))}

          <div className="onboarding-section-divider" />
          <h3 className="onboarding-section-title">Add workers</h3>
          <p className="muted onboarding-section-copy">
            Add the team members who will receive jobs. You can edit this later.
          </p>
          <OnboardingTeamBuilder workspaceTimezone={settings.calendarTimezone} />

          {error === "phone" ? <p className="form-status">Use valid E.164 phone format for workers.</p> : null}
          <div className="onboarding-sticky-actions">
            <Link className="btn secondary" href={onboardingUrl(scope.orgId, scope.internalUser, 1)}>
              Back
            </Link>
            <button className="btn primary" type="submit">
              Save &amp; Continue
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <form action={saveCalendarRulesAction} className="auth-form" style={{ marginTop: 14 }}>
          <input type="hidden" name="orgId" value={scope.orgId} />

          <label className="inline-toggle">
            <input type="checkbox" name="allowOverlaps" defaultChecked={settings.allowOverlaps} />
            Allow overlaps (recommended OFF)
          </label>

          <label className="inline-toggle">
            <input
              type="checkbox"
              name="roundRobinEnabled"
              defaultChecked={Boolean(organization.dashboardConfig?.roundRobinLastWorkerId)}
            />
            Enable deterministic round-robin fallback
          </label>

          <h3>Quick add time off (optional)</h3>
          <div className="grid two-col">
            <label>
              Date
              <input type="date" name="timeOffDate" />
            </label>
            <label>
              Worker
              <select name="timeOffWorkerId" defaultValue={workers[0]?.id || ""}>
                <option value="">Select worker</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name || worker.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid two-col">
            <label>
              Start
              <input type="time" name="timeOffStart" />
            </label>
            <label>
              End
              <input type="time" name="timeOffEnd" />
            </label>
          </div>

          {error === "timeoff" ? (
            <p className="form-status">Time off end must be after start.</p>
          ) : null}
          <div className="onboarding-sticky-actions">
            <Link className="btn secondary" href={onboardingUrl(scope.orgId, scope.internalUser, 2)}>
              Back
            </Link>
            <button className="btn primary" type="submit">
              Save &amp; Continue
            </button>
          </div>
        </form>
      ) : null}

      {step === 4 ? (
        <form action={saveMessagingAction} className="auth-form" style={{ marginTop: 14 }}>
          <input type="hidden" name="orgId" value={scope.orgId} />

          <h3>Customer Texting</h3>
          <p className="muted">
            To turn on customer texting, carriers ask for the business info below before Twilio approves the number.
          </p>

          <section className="onboarding-sms-application">
            <div className="onboarding-sms-application-header">
              <div>
                <h4>Texting Approval Application</h4>
                <p className="muted">
                  Fill this out like office paperwork. We use it to submit the texting registration.
                </p>
              </div>
              <span className={`settings-integration-status ${smsRegistrationComplete ? "connected" : "warning"}`}>
                {smsRegistrationComplete ? "Saved for review" : "Needs info"}
              </span>
            </div>

            <h4 className="onboarding-section-title">Business info</h4>
            <div className="grid two-col">
              <label>
                Legal business name
                <input
                  name="smsBusinessName"
                  defaultValue={smsApplication?.businessName || organization.legalName || organization.name}
                  placeholder="ABC Roofing LLC"
                />
              </label>
              <label>
                Business name customers know
                <input
                  name="smsBrandName"
                  defaultValue={smsApplication?.brandName || organization.name}
                  placeholder="ABC Roofing"
                />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Business type
                <select
                  name="smsBusinessType"
                  defaultValue={smsApplication?.businessType || "Limited Liability Corporation"}
                >
                  {SMS_BUSINESS_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Industry
                <select name="smsBusinessIndustry" defaultValue={smsApplication?.businessIndustry || "CONSTRUCTION"}>
                  {SMS_INDUSTRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid two-col">
              <label>
                EIN status
                <select
                  name="smsBusinessRegistrationIdentifier"
                  defaultValue={smsApplication?.businessRegistrationIdentifier || "EIN"}
                >
                  {SMS_REGISTRATION_IDENTIFIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small className="muted onboarding-field-help">
                  We do not collect EIN, tax ID, or SSN in the app. If Twilio needs it, handle it through Twilio&apos;s
                  secure setup process or a direct setup call.
                </small>
              </label>
              <label>
                Company type
                <select name="smsCompanyType" defaultValue={smsApplication?.companyType || "private"}>
                  {SMS_COMPANY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Website
                <input
                  name="smsWebsiteUrl"
                  defaultValue={smsApplication?.websiteUrl || organization.website || ""}
                  placeholder="https://abcsiding.com"
                />
              </label>
            </div>

            <label>
              Facebook, Google Business, or other social links
              <textarea
                name="smsSocialMediaProfileUrls"
                defaultValue={smsApplication?.socialMediaProfileUrls || ""}
                rows={2}
                placeholder="https://www.facebook.com/abcsiding"
              />
            </label>

            <h4 className="onboarding-section-title">Business address</h4>
            <label>
              Business name for mailing address
              <input
                name="smsCustomerName"
                defaultValue={smsApplication?.customerName || organization.legalName || organization.name}
                placeholder="ABC Roofing LLC"
              />
            </label>
            <div className="grid two-col">
              <label>
                Street address
                <input
                  name="smsStreet"
                  defaultValue={smsApplication?.street || organization.addressLine1 || ""}
                  placeholder="123 Main St"
                />
              </label>
              <label>
                Suite / unit
                <input
                  name="smsStreetSecondary"
                  defaultValue={smsApplication?.streetSecondary || organization.addressLine2 || ""}
                  placeholder="Suite 200"
                />
              </label>
            </div>
            <div className="grid two-col">
              <label>
                City
                <input name="smsCity" defaultValue={smsApplication?.city || organization.city || ""} placeholder="Tacoma" />
              </label>
              <label>
                State
                <input name="smsRegion" defaultValue={smsApplication?.region || organization.state || ""} placeholder="WA" />
              </label>
            </div>
            <div className="grid two-col">
              <label>
                ZIP
                <input name="smsPostalCode" defaultValue={smsApplication?.postalCode || organization.zip || ""} placeholder="98402" />
              </label>
              <label>
                Country
                <input name="smsIsoCountry" defaultValue={smsApplication?.isoCountry || "US"} disabled />
              </label>
            </div>

            <h4 className="onboarding-section-title">Owner or manager contact</h4>
            <div className="grid two-col">
              <label>
                First name
                <input name="smsAuthorizedFirstName" defaultValue={smsApplication?.authorizedFirstName || ""} placeholder="First name" />
              </label>
              <label>
                Last name
                <input name="smsAuthorizedLastName" defaultValue={smsApplication?.authorizedLastName || ""} placeholder="Last name" />
              </label>
            </div>
            <div className="grid two-col">
              <label>
                Job title
                <input name="smsAuthorizedTitle" defaultValue={smsApplication?.authorizedTitle || "Owner"} placeholder="Owner" />
              </label>
              <label>
                Job level
                <select name="smsAuthorizedJobPosition" defaultValue={smsApplication?.authorizedJobPosition || "CEO"}>
                  {SMS_JOB_POSITION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid two-col">
              <label>
                Contact phone
                <input
                  name="smsAuthorizedPhoneE164"
                  defaultValue={smsApplication?.authorizedPhoneE164 || organization.phone || ""}
                  placeholder="+12065550123"
                />
              </label>
              <label>
                Contact email
                <input
                  name="smsAuthorizedEmail"
                  defaultValue={smsApplication?.authorizedEmail || organization.email || ""}
                  placeholder="owner@example.com"
                />
              </label>
            </div>
            <div className="grid two-col">
              <label>
                Brand contact email
                <input
                  name="smsBrandContactEmail"
                  defaultValue={smsApplication?.brandContactEmail || ""}
                  placeholder="owner@example.com"
                />
              </label>
            </div>

            <h4 className="onboarding-section-title">What the texts are for</h4>
            <label>
              Texting use
              <select name="smsCampaignUseCase" defaultValue={smsApplication?.campaignUseCase || "LOW_VOLUME"}>
                {SMS_CAMPAIGN_USE_CASE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What will you text customers about?
              <textarea
                name="smsCampaignDescription"
                defaultValue={
                  smsApplication?.campaignDescription ||
                  `${sampleBrandName} will text customers about estimate scheduling, appointment reminders, job updates, customer questions, and follow-up after the customer has asked for service.`
                }
                rows={3}
              />
            </label>
            <label>
              How do customers say yes to texts?
              <textarea
                name="smsMessageFlow"
                defaultValue={
                  smsApplication?.messageFlow ||
                  `Customers give permission by submitting the website form, calling the business, or asking for service. The form includes a checkbox agreeing to receive customer service and appointment texts from ${sampleBrandName}. The checkbox explains message frequency varies, message and data rates may apply, and customers can reply STOP to opt out or HELP for help.`
                }
                rows={4}
              />
            </label>

            <div className="grid two-col">
              <label>
                Privacy policy link
                <input
                  name="smsPrivacyPolicyUrl"
                  defaultValue={smsApplication?.privacyPolicyUrl || ""}
                  placeholder="https://example.com/privacy"
                />
                <small className="muted onboarding-field-help">
                  The policy should say mobile numbers are not shared for third-party marketing.
                </small>
              </label>
              <label>
                Terms link
                <input
                  name="smsTermsOfServiceUrl"
                  defaultValue={smsApplication?.termsOfServiceUrl || ""}
                  placeholder="https://example.com/terms"
                />
                <small className="muted onboarding-field-help">
                  The terms should mention message frequency, rates, STOP, HELP, and carrier delivery limits.
                </small>
              </label>
            </div>
            <label>
              Opt-in page or screenshot link
              <input
                name="smsOptInProofUrl"
                defaultValue={smsApplication?.optInProofUrl || ""}
                placeholder="https://example.com/contact"
              />
            </label>

            <h4 className="onboarding-section-title">Sample texts</h4>
            <label>
              Sample text 1
              <textarea
                name="smsSampleMessage1"
                defaultValue={
                  smsApplication?.sampleMessage1 ||
                  `Hi [customer name], this is ${sampleBrandName}. We got your request for [job type]. What address should we come look at? Reply STOP to opt out.`
                }
                rows={3}
              />
            </label>
            <label>
              Sample text 2
              <textarea
                name="smsSampleMessage2"
                defaultValue={
                  smsApplication?.sampleMessage2 ||
                  `Hi [customer name], this is ${sampleBrandName}. Confirming your estimate for [date] at [time]. Reply YES to confirm or STOP to opt out.`
                }
                rows={3}
              />
            </label>
            <div className="grid two-col">
              <label>
                Sample text 3
                <textarea name="smsSampleMessage3" defaultValue={smsApplication?.sampleMessage3 || ""} rows={3} />
              </label>
              <label>
                Sample text 4
                <textarea name="smsSampleMessage4" defaultValue={smsApplication?.sampleMessage4 || ""} rows={3} />
              </label>
            </div>
            <label>
              Sample text 5
              <textarea name="smsSampleMessage5" defaultValue={smsApplication?.sampleMessage5 || ""} rows={3} />
            </label>

            <div className="template-pills">
              <label className="inline-toggle">
                <input type="checkbox" name="smsHasEmbeddedLinks" defaultChecked={Boolean(smsApplication?.hasEmbeddedLinks)} />
                Texts may include links
              </label>
              <label className="inline-toggle">
                <input type="checkbox" name="smsHasEmbeddedPhone" defaultChecked={Boolean(smsApplication?.hasEmbeddedPhone)} />
                Texts may include phone numbers
              </label>
            </div>

            <h4 className="onboarding-section-title">STOP and HELP replies</h4>
            <div className="grid two-col">
              <label>
                Opt-in keywords
                <input name="smsOptInKeywords" defaultValue={smsApplication?.optInKeywords || "START"} placeholder="START" />
              </label>
              <label>
                Opt-out keywords
                <input name="smsOptOutKeywords" defaultValue={smsApplication?.optOutKeywords || "STOP"} placeholder="STOP" />
              </label>
            </div>
            <label>
              Opt-in reply
              <input
                name="smsOptInMessage"
                defaultValue={
                  smsApplication?.optInMessage ||
                  `${sampleBrandName}: you are signed up for customer texts. Reply HELP for help or STOP to opt out.`
                }
              />
            </label>
            <label>
              Opt-out reply
              <input
                name="smsOptOutMessage"
                defaultValue={
                  smsApplication?.optOutMessage ||
                  `${sampleBrandName}: you are opted out and will not receive more texts.`
                }
              />
            </label>
            <div className="grid two-col">
              <label>
                Help keywords
                <input name="smsHelpKeywords" defaultValue={smsApplication?.helpKeywords || "HELP"} placeholder="HELP" />
              </label>
              <label>
                Estimated texts per month
                <input
                  name="smsEstimatedMonthlyMessages"
                  inputMode="numeric"
                  defaultValue={smsApplication?.estimatedMonthlyMessages || ""}
                  placeholder="300"
                />
              </label>
            </div>
            <label>
              Help reply
              <input
                name="smsHelpMessage"
                defaultValue={
                  smsApplication?.helpMessage ||
                  `${sampleBrandName}: reply STOP to opt out or call us for help.`
                }
              />
            </label>
            <label>
              Existing Twilio number, if you already have one
              <input
                name="smsDesiredSenderNumberE164"
                defaultValue={smsApplication?.desiredSenderNumberE164 || ""}
                placeholder="+12065550100"
              />
            </label>

            <label className="inline-toggle">
              <input
                type="checkbox"
                name="smsCustomerConsentConfirmed"
                defaultChecked={Boolean(smsApplication?.customerConsentConfirmed)}
              />
              Customers have a clear way to agree to receive texts, including who is texting, what the texts are for,
              message frequency, message/data rates, and how to reply STOP.
            </label>
            <label className="inline-toggle">
              <input
                type="checkbox"
                name="smsRegistrationSubmissionAuthorized"
                defaultChecked={Boolean(smsApplication?.registrationSubmissionAuthorized)}
              />
              I am authorized to submit this business and allow TieGui to share this information with Twilio, carriers,
              and The Campaign Registry for texting registration.
            </label>

            <div className="quick-links">
              <button
                type="submit"
                formAction={saveSmsRegistrationAction}
                className="btn secondary"
                aria-label="Save texting approval application"
              >
                Save texting application
              </button>
            </div>

            {smsApplication ? (
              <div className="onboarding-sms-delete">
                <h4>Delete saved application info</h4>
                <p className="muted">
                  This removes TieGui&apos;s saved copy of the Twilio application answers, including owner contact fields.
                  If the information was already sent to Twilio, carriers, or The Campaign Registry,
                  deletion there may depend on their rules and legal retention requirements.
                </p>
                <label>
                  Type DELETE to confirm
                  <input name="deleteSmsApplicationConfirm" placeholder="DELETE" />
                </label>
                <button
                  type="submit"
                  formAction={deleteSmsRegistrationAction}
                  className="btn secondary"
                  aria-label="Delete saved texting application info"
                >
                  Delete application info
                </button>
              </div>
            ) : null}
          </section>

          <label className="inline-toggle">
            <input type="checkbox" name="enableTexting" defaultChecked={Boolean(organization.smsFromNumberE164)} />
            Send live texts from this account now
          </label>

          <div className="onboarding-messaging-fields">
            <label>
              Live sending number (E.164)
              <input name="smsFromNumberE164" defaultValue={organization.smsFromNumberE164 || ""} placeholder="+12065550100" />
            </label>

            <label>
              Send test SMS to
              <input name="testPhoneE164" placeholder="+12065550199" />
            </label>

            <div className="quick-links">
              <button type="submit" name="intent" value="save" className="btn secondary" aria-label="Save messaging settings">
                Save messaging
              </button>
              <button type="submit" name="intent" value="test" className="btn secondary" aria-label="Send test sms">
                Send test SMS
              </button>
              <Link className="btn secondary" href={withOrgQuery("/api/integrations/google/connect?write=1", scope.orgId, scope.internalUser)}>
                Connect Google
              </Link>
              <Link className="btn secondary" href={withOrgQuery("/app/settings/integrations", scope.orgId, scope.internalUser)}>
                Sync now
              </Link>
            </div>
          </div>

          {!twilioReady ? (
            <p className="muted">Texting can be approved first, then turned on after the Twilio number is ready.</p>
          ) : null}
          {smsApplicationNotice === "saved" ? <p className="form-status">Texting application saved for review.</p> : null}
          {smsApplicationNotice === "deleted" ? <p className="form-status">Saved texting application info deleted.</p> : null}
          {saved === "1" ? <p className="form-status">Messaging settings saved.</p> : null}
          {error === "sender" ? <p className="form-status">Enter a valid sender number.</p> : null}
          {error === "sms-required" ? <p className="form-status">Finish the required texting approval fields.</p> : null}
          {error === "sms-phone" ? <p className="form-status">Use valid phone numbers like +12065550123.</p> : null}
          {error === "sms-email" ? <p className="form-status">Use a valid contact email.</p> : null}
          {error === "sms-campaign" ? (
            <p className="form-status">Add more detail about what the texts are for and how customers say yes.</p>
          ) : null}
          {error === "sms-samples" ? (
            <p className="form-status">Add at least two sample texts with 20 or more characters each.</p>
          ) : null}
          {error === "sms-consent" ? <p className="form-status">Check both approval boxes before saving.</p> : null}
          {error === "sms-delete-confirm" ? <p className="form-status">Type DELETE before deleting the application info.</p> : null}
          {error === "test-number" ? (
            <p className="form-status">Enter valid sender + test number to send test SMS.</p>
          ) : null}
          {smsTest ? (
            <p className="form-status">
              Test result: {decodeURIComponent(smsTest)}
            </p>
          ) : null}
          {!canGoLive ? (
            <p className="muted">Complete Business Setup + Scheduling rules + texting application or live number to go live.</p>
          ) : null}
          {error === "go-live-prereq" ? (
            <p className="form-status">Complete Business Setup + Scheduling rules + texting application or live number before Go Live.</p>
          ) : null}

          <div className="onboarding-sticky-actions">
            <Link className="btn secondary" href={onboardingUrl(scope.orgId, scope.internalUser, 3)}>
              Back
            </Link>
            <button
              formAction={completeOnboardingAction}
              className="btn primary"
              type="submit"
              disabled={!canGoLive}
              title={!canGoLive ? "Complete Business Setup + Scheduling rules to go live." : undefined}
              aria-label="Go Live"
            >
              Go Live
            </button>
          </div>
        </form>
      ) : null}

      {step === 5 ? (
        <section className="stack-cell" style={{ marginTop: 14 }}>
          <h3 className="onboarding-live-title">You&apos;re live ✅</h3>
          <p className="muted">Core workflow is ready. Start scheduling now, then work your day from mobile.</p>
          <div className="onboarding-live-summary">
            <p className="onboarding-live-summary-title">What&apos;s configured</p>
            <div className="onboarding-live-summary-grid">
              <p>
                <span>Timezone</span>
                <strong>{settings.calendarTimezone}</strong>
              </p>
              <p>
                <span>Working days</span>
                <strong>{workingDaysSummary}</strong>
              </p>
              <p>
                <span>Slot length</span>
                <strong>{settings.defaultSlotMinutes} min</strong>
              </p>
              <p>
                <span>Crew count</span>
                <strong>{crewCount}</strong>
              </p>
            </div>
          </div>
          <div className="quick-links onboarding-live-actions">
            <Link className="btn primary" href={withOrgQuery("/app/calendar", scope.orgId, scope.internalUser)}>
              Go to Calendar
            </Link>
            <Link className="btn secondary" href={firstLeadHref}>
              Add your first lead
            </Link>
          </div>
          {!photoStorage.productionReady ? (
            <p className="form-status">Pilot go-live blocked: {photoStorage.blockingReason}</p>
          ) : null}
        </section>
      ) : null}

    </section>
  );
}
