import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isR2Configured } from "@/lib/r2";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { DEFAULT_CALENDAR_TIMEZONE, ensureTimeZone, isValidTimeZone } from "@/lib/calendar/dates";
import { containsAutomationRevealLanguage, normalizeCustomTemplates } from "@/lib/conversational-sms-templates";
import { getRequestTranslator } from "@/lib/i18n";
import type { ResolvedMessageLocale } from "@/lib/message-language";
import { normalizeE164 } from "@/lib/phone";
import { isInternalRole, requireSessionUser } from "@/lib/session";
import { getParam, requireAppOrgAccess, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";
import OrgLogoUploader from "./branding/org-logo-uploader";
import { SmsVoiceSection, type SmsVoiceCustomTemplates } from "./sms-voice-section";

export const dynamic = "force-dynamic";

function parseQuietHourMinute(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function minuteToTimeInput(value: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.floor(value)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseMessageLanguage(value: string): "EN" | "ES" | "AUTO" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "en") return "EN";
  if (normalized === "es") return "ES";
  if (normalized === "auto") return "AUTO";
  return null;
}

function parseSmsTone(
  value: string,
): "FRIENDLY" | "PROFESSIONAL" | "DIRECT" | "SALES" | "PREMIUM" | "BILINGUAL" | "CUSTOM" | null {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "FRIENDLY" ||
    normalized === "PROFESSIONAL" ||
    normalized === "DIRECT" ||
    normalized === "SALES" ||
    normalized === "PREMIUM" ||
    normalized === "BILINGUAL" ||
    normalized === "CUSTOM"
  ) {
    return normalized;
  }
  return null;
}

function parseTimeInput(value: string): string | null {
  const minute = parseQuietHourMinute(value);
  if (minute === null) return null;
  return minuteToTimeInput(minute);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function buildSettingsPreviewSlots(input: {
  orgId: string;
  connected: boolean;
  slotDurationMinutes: number;
  daysAhead: number;
  timezone: string;
}): Promise<string[]> {
  if (!input.connected) {
    return ["Tomorrow 10:00am", "Thu 2:00pm", "Fri 9:00am"];
  }

  const workers = await prisma.user.findMany({
    where: {
      orgId: input.orgId,
      calendarAccessRole: { not: "READ_ONLY" },
    },
    select: { id: true },
    take: 8,
  });
  if (workers.length === 0) {
    return ["Tomorrow 10:00am", "Thu 2:00pm", "Fri 9:00am"];
  }

  const settings = await getOrgCalendarSettings(input.orgId);
  const now = new Date();
  const slots: string[] = [];
  const seen = new Set<string>();
  const maxDays = clampInt(input.daysAhead, 1, 14);

  for (let offset = 0; offset < maxDays; offset += 1) {
    const date = formatInTimeZone(addDays(now, offset), input.timezone || settings.calendarTimezone, "yyyy-MM-dd");
    for (const worker of workers) {
      if (slots.length >= 3) break;
      const availability = await computeAvailabilityForWorker({
        orgId: input.orgId,
        workerUserId: worker.id,
        date,
        durationMinutes: clampInt(input.slotDurationMinutes, 15, 180),
      });
      for (const slotUtc of availability.slotsUtc) {
        const slotDate = new Date(slotUtc);
        if (slotDate <= now) continue;
        if (seen.has(slotUtc)) continue;
        seen.add(slotUtc);
        const day = formatInTimeZone(slotDate, input.timezone || settings.calendarTimezone, "EEE");
        const time = formatInTimeZone(slotDate, input.timezone || settings.calendarTimezone, "h:mmaaa").toLowerCase();
        slots.push(`${day} ${time}`);
        if (slots.length >= 3) break;
      }
    }
    if (slots.length >= 3) break;
  }

  if (slots.length === 0) {
    return ["Tomorrow 10:00am", "Thu 2:00pm", "Fri 9:00am"];
  }
  return slots;
}

async function updateSettingsAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings", orgId);

  const senderRaw = String(formData.get("smsFromNumberE164") || "").trim();
  const organizationName = String(formData.get("organizationName") || "").trim();
  const messageLanguageRaw = String(formData.get("messageLanguage") || "").trim();
  const smsToneRaw = String(formData.get("smsTone") || "").trim();
  const autoReplyEnabled = String(formData.get("autoReplyEnabled") || "") === "on";
  const followUpsEnabled = String(formData.get("followUpsEnabled") || "") === "on";
  const autoBookingEnabled = String(formData.get("autoBookingEnabled") || "") === "on";
  const smsGreetingLine = String(formData.get("smsGreetingLine") || "").trim();
  const smsWorkingHoursText = String(formData.get("smsWorkingHoursText") || "").trim();
  const smsWebsiteSignature = String(formData.get("smsWebsiteSignature") || "").trim();
  const workingHoursStartRaw = String(formData.get("workingHoursStart") || "").trim();
  const workingHoursEndRaw = String(formData.get("workingHoursEnd") || "").trim();
  const slotDurationMinutesRaw = String(formData.get("slotDurationMinutes") || "").trim();
  const bufferMinutesRaw = String(formData.get("bufferMinutes") || "").trim();
  const daysAheadRaw = String(formData.get("daysAhead") || "").trim();
  const messagingTimezoneRaw = String(formData.get("messagingTimezone") || "").trim();
  const customTemplateGreeting = String(formData.get("customTemplateGreeting") || "").trim();
  const customTemplateAskAddress = String(formData.get("customTemplateAskAddress") || "").trim();
  const customTemplateAskTimeframe = String(formData.get("customTemplateAskTimeframe") || "").trim();
  const customTemplateOfferBooking = String(formData.get("customTemplateOfferBooking") || "").trim();
  const customTemplateBookingConfirmation = String(formData.get("customTemplateBookingConfirmation") || "").trim();
  const customTemplateFollowUp1 = String(formData.get("customTemplateFollowUp1") || "").trim();
  const customTemplateFollowUp2 = String(formData.get("customTemplateFollowUp2") || "").trim();
  const customTemplateFollowUp3 = String(formData.get("customTemplateFollowUp3") || "").trim();
  const missedCallAutoReplyOn = String(formData.get("missedCallAutoReplyOn") || "") === "on";
  const missedCallMessageEn = String(formData.get("missedCallAutoReplyBodyEn") || "").trim();
  const missedCallMessageEs = String(formData.get("missedCallAutoReplyBodyEs") || "").trim();
  const intakeAskLocationBodyEn = String(formData.get("intakeAskLocationBodyEn") || "").trim();
  const intakeAskLocationBodyEs = String(formData.get("intakeAskLocationBodyEs") || "").trim();
  const intakeAskWorkTypeBodyEn = String(formData.get("intakeAskWorkTypeBodyEn") || "").trim();
  const intakeAskWorkTypeBodyEs = String(formData.get("intakeAskWorkTypeBodyEs") || "").trim();
  const intakeAskCallbackBodyEn = String(formData.get("intakeAskCallbackBodyEn") || "").trim();
  const intakeAskCallbackBodyEs = String(formData.get("intakeAskCallbackBodyEs") || "").trim();
  const intakeCompletionBodyEn = String(formData.get("intakeCompletionBodyEn") || "").trim();
  const intakeCompletionBodyEs = String(formData.get("intakeCompletionBodyEs") || "").trim();
  const reminderMinutesInput = String(formData.get("jobReminderMinutesBefore") || "").trim();
  const googleReviewUrl = String(formData.get("googleReviewUrl") || "").trim();
  const allowWorkerLeadCreate = String(formData.get("allowWorkerLeadCreate") || "") === "on";
  const ghostBustingEnabled = String(formData.get("ghostBustingEnabled") || "") === "on";
  const voiceNotesEnabled = String(formData.get("voiceNotesEnabled") || "") === "on";
  const metaCapiEnabled = String(formData.get("metaCapiEnabled") || "") === "on";
  const offlineModeEnabled = String(formData.get("offlineModeEnabled") || "") === "on";
  const quietStartRaw = String(formData.get("ghostBustingQuietHoursStart") || "").trim();
  const quietEndRaw = String(formData.get("ghostBustingQuietHoursEnd") || "").trim();
  const smsQuietStartRaw = String(formData.get("smsQuietHoursStartMinute") || "").trim();
  const smsQuietEndRaw = String(formData.get("smsQuietHoursEndMinute") || "").trim();
  const maxNudgesRaw = String(formData.get("ghostBustingMaxNudges") || "").trim();
  const ghostTemplateText = String(formData.get("ghostBustingTemplateText") || "").trim();
  const calendarTimezoneInput = String(formData.get("calendarTimezone") || "").trim();
  const userTimezoneInput = String(formData.get("userTimezone") || "").trim();
  const calendarTimezone = calendarTimezoneInput || DEFAULT_CALENDAR_TIMEZONE;
  const userTimezone = userTimezoneInput || null;

  const user = await requireSessionUser("/app/settings");
  const dbUser = user.id
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: { calendarAccessRole: true, role: true },
      })
    : null;
  const canManageLeadEntrySetting = dbUser
    ? isInternalRole(dbUser.role) || dbUser.calendarAccessRole === "OWNER" || dbUser.calendarAccessRole === "ADMIN"
    : false;
  const canManageAutomationSettings = canManageLeadEntrySetting;

  const sender = senderRaw ? normalizeE164(senderRaw) : null;
  const messageLanguage = parseMessageLanguage(messageLanguageRaw);
  const smsTone = parseSmsTone(smsToneRaw);
  if (senderRaw && !sender) {
    redirect(withOrgQuery("/app/settings?error=invalid-sender", orgId, internalUser));
  }

  if (!messageLanguage) {
    redirect(withOrgQuery("/app/settings?error=invalid-message-language", orgId, internalUser));
  }

  if (canManageAutomationSettings && !smsTone) {
    redirect(withOrgQuery("/app/settings?error=invalid-sms-tone", orgId, internalUser));
  }

  if (smsGreetingLine.length > 220 || smsWorkingHoursText.length > 220 || smsWebsiteSignature.length > 220) {
    redirect(withOrgQuery("/app/settings?error=invalid-message", orgId, internalUser));
  }

  const workingHoursStart = parseTimeInput(workingHoursStartRaw || "09:00");
  const workingHoursEnd = parseTimeInput(workingHoursEndRaw || "17:00");
  const slotDurationMinutes = clampInt(Number.parseInt(slotDurationMinutesRaw || "60", 10), 15, 180);
  const bufferMinutes = clampInt(Number.parseInt(bufferMinutesRaw || "15", 10), 0, 120);
  const daysAhead = clampInt(Number.parseInt(daysAheadRaw || "3", 10), 1, 14);
  const messagingTimezone = messagingTimezoneRaw || calendarTimezone;

  if (!workingHoursStart || !workingHoursEnd) {
    redirect(withOrgQuery("/app/settings?error=invalid-working-hours", orgId, internalUser));
  }

  if (!isValidTimeZone(messagingTimezone)) {
    redirect(withOrgQuery("/app/settings?error=invalid-messaging-timezone", orgId, internalUser));
  }

  const customTemplatesInput: SmsVoiceCustomTemplates = {
    greeting: customTemplateGreeting,
    askAddress: customTemplateAskAddress,
    askTimeframe: customTemplateAskTimeframe,
    offerBooking: customTemplateOfferBooking,
    bookingConfirmation: customTemplateBookingConfirmation,
    followUp1: customTemplateFollowUp1,
    followUp2: customTemplateFollowUp2,
    followUp3: customTemplateFollowUp3,
  };

  for (const value of Object.values(customTemplatesInput)) {
    if (value.length > 1600) {
      redirect(withOrgQuery("/app/settings?error=invalid-message", orgId, internalUser));
    }
    if (containsAutomationRevealLanguage(value)) {
      redirect(withOrgQuery("/app/settings?error=invalid-custom-template", orgId, internalUser));
    }
  }

  const customTemplatesJson = normalizeCustomTemplates(customTemplatesInput);
  const customModeEnabled = canManageAutomationSettings && smsTone === "CUSTOM";
  const legacyInitial = customModeEnabled ? customTemplateGreeting || null : undefined;
  const legacyAskAddress = customModeEnabled ? customTemplateAskAddress || null : undefined;
  const legacyAskTimeframe = customModeEnabled ? customTemplateAskTimeframe || null : undefined;
  const legacyOfferBooking = customModeEnabled ? customTemplateOfferBooking || null : undefined;
  const legacyBookingConfirmation = customModeEnabled ? customTemplateBookingConfirmation || null : undefined;

  if (!organizationName || organizationName.length > 120) {
    redirect(withOrgQuery("/app/settings?error=invalid-business-name", orgId, internalUser));
  }

  const localizedMessageTemplates = [
    missedCallMessageEn,
    missedCallMessageEs,
    intakeAskLocationBodyEn,
    intakeAskLocationBodyEs,
    intakeAskWorkTypeBodyEn,
    intakeAskWorkTypeBodyEs,
    intakeAskCallbackBodyEn,
    intakeAskCallbackBodyEs,
    intakeCompletionBodyEn,
    intakeCompletionBodyEs,
  ];

  if (localizedMessageTemplates.some((template) => template.length > 1600)) {
    redirect(withOrgQuery("/app/settings?error=invalid-message", orgId, internalUser));
  }

  const reminderMinutesBefore = Number.parseInt(reminderMinutesInput, 10);
  if (!Number.isFinite(reminderMinutesBefore) || reminderMinutesBefore < 15 || reminderMinutesBefore > 1440) {
    redirect(withOrgQuery("/app/settings?error=invalid-reminder", orgId, internalUser));
  }

  if (!isValidTimeZone(calendarTimezone)) {
    redirect(withOrgQuery("/app/settings?error=invalid-calendar-timezone", orgId, internalUser));
  }

  if (userTimezone && !isValidTimeZone(userTimezone)) {
    redirect(withOrgQuery("/app/settings?error=invalid-user-timezone", orgId, internalUser));
  }

  if (googleReviewUrl) {
    try {
      const parsed = new URL(googleReviewUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      redirect(withOrgQuery("/app/settings?error=invalid-review-url", orgId, internalUser));
    }
  }

  let quietStartMinute: number | null = null;
  let quietEndMinute: number | null = null;
  const smsQuietStartMinute = parseQuietHourMinute(smsQuietStartRaw);
  const smsQuietEndMinute = parseQuietHourMinute(smsQuietEndRaw);
  let ghostBustingMaxNudges = 2;
  if (smsQuietStartMinute === null || smsQuietEndMinute === null) {
    redirect(withOrgQuery("/app/settings?error=invalid-sms-quiet-hours", orgId, internalUser));
  }

  if (canManageAutomationSettings) {
    quietStartMinute = parseQuietHourMinute(quietStartRaw);
    quietEndMinute = parseQuietHourMinute(quietEndRaw);
    if (quietStartMinute === null || quietEndMinute === null) {
      redirect(withOrgQuery("/app/settings?error=invalid-ghost-hours", orgId, internalUser));
    }

    ghostBustingMaxNudges = Number.parseInt(maxNudgesRaw, 10);
    if (!Number.isFinite(ghostBustingMaxNudges) || ghostBustingMaxNudges < 1 || ghostBustingMaxNudges > 10) {
      redirect(withOrgQuery("/app/settings?error=invalid-ghost-max", orgId, internalUser));
    }

    if (ghostTemplateText.length > 1600) {
      redirect(withOrgQuery("/app/settings?error=invalid-ghost-template", orgId, internalUser));
    }
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      smsFromNumberE164: sender,
      name: organizationName,
      messageLanguage,
      smsTone: canManageAutomationSettings ? smsTone! : undefined,
      autoReplyEnabled: canManageAutomationSettings ? autoReplyEnabled : undefined,
      followUpsEnabled: canManageAutomationSettings ? followUpsEnabled : undefined,
      autoBookingEnabled: canManageAutomationSettings ? autoBookingEnabled : undefined,
      smsGreetingLine: canManageAutomationSettings ? (smsGreetingLine || null) : undefined,
      smsWorkingHoursText: canManageAutomationSettings ? (smsWorkingHoursText || null) : undefined,
      smsWebsiteSignature: canManageAutomationSettings ? (smsWebsiteSignature || null) : undefined,
      missedCallAutoReplyOn,
      missedCallAutoReplyBody: legacyInitial,
      missedCallAutoReplyBodyEn: legacyInitial,
      intakeAskLocationBody: legacyAskAddress,
      intakeAskLocationBodyEn: legacyAskAddress,
      intakeAskWorkTypeBody: legacyAskTimeframe,
      intakeAskWorkTypeBodyEn: legacyAskTimeframe,
      intakeAskCallbackBody: legacyOfferBooking,
      intakeAskCallbackBodyEn: legacyOfferBooking,
      intakeCompletionBody: legacyBookingConfirmation,
      intakeCompletionBodyEn: legacyBookingConfirmation,
      allowWorkerLeadCreate: canManageLeadEntrySetting ? allowWorkerLeadCreate : undefined,
      ghostBustingEnabled: canManageAutomationSettings ? ghostBustingEnabled : undefined,
      voiceNotesEnabled: canManageAutomationSettings ? voiceNotesEnabled : undefined,
      metaCapiEnabled: canManageAutomationSettings ? metaCapiEnabled : undefined,
      offlineModeEnabled: canManageAutomationSettings ? offlineModeEnabled : undefined,
      ghostBustingQuietHoursStart: canManageAutomationSettings ? quietStartMinute! : undefined,
      ghostBustingQuietHoursEnd: canManageAutomationSettings ? quietEndMinute! : undefined,
      ghostBustingMaxNudges: canManageAutomationSettings ? ghostBustingMaxNudges : undefined,
      ghostBustingTemplateText: canManageAutomationSettings ? (ghostTemplateText || null) : undefined,
      smsQuietHoursStartMinute: smsQuietStartMinute,
      smsQuietHoursEndMinute: smsQuietEndMinute,
    },
  });

  if (canManageAutomationSettings) {
    await prisma.organizationMessagingSettings.upsert({
      where: { orgId },
      update: {
        smsTone: smsTone!,
        autoReplyEnabled,
        followUpsEnabled,
        autoBookingEnabled,
        workingHoursStart: workingHoursStart!,
        workingHoursEnd: workingHoursEnd!,
        slotDurationMinutes,
        bufferMinutes,
        daysAhead,
        timezone: ensureTimeZone(messagingTimezone),
        customTemplates: customModeEnabled ? (customTemplatesJson as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      create: {
        orgId,
        smsTone: smsTone || "FRIENDLY",
        autoReplyEnabled,
        followUpsEnabled,
        autoBookingEnabled,
        workingHoursStart: workingHoursStart || "09:00",
        workingHoursEnd: workingHoursEnd || "17:00",
        slotDurationMinutes,
        bufferMinutes,
        daysAhead,
        timezone: ensureTimeZone(messagingTimezone),
        customTemplates: smsTone === "CUSTOM" ? (customTemplatesJson as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  }

  await prisma.orgDashboardConfig.upsert({
    where: { orgId },
    update: {
      jobReminderMinutesBefore: reminderMinutesBefore,
      googleReviewUrl: googleReviewUrl || null,
      calendarTimezone: ensureTimeZone(calendarTimezone),
    },
    create: {
      orgId,
      jobReminderMinutesBefore: reminderMinutesBefore,
      googleReviewUrl: googleReviewUrl || null,
      calendarTimezone: ensureTimeZone(calendarTimezone),
    },
  });

  if (user.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        timezone: userTimezone ? ensureTimeZone(userTimezone) : null,
      },
    });
  }

  revalidatePath("/app/settings");
  revalidatePath("/app");
  revalidatePath("/app/calendar");
  revalidatePath("/hq/businesses");
  revalidatePath(`/hq/businesses/${orgId}`);

  redirect(withOrgQuery("/app/settings?saved=1", orgId, internalUser));
}

export default async function ClientSettingsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/settings", requestedOrgId });

  const organization = await prisma.organization.findUnique({
    where: { id: scope.orgId },
    select: {
      id: true,
      name: true,
      allowWorkerLeadCreate: true,
      ghostBustingEnabled: true,
      voiceNotesEnabled: true,
      metaCapiEnabled: true,
      offlineModeEnabled: true,
      ghostBustingQuietHoursStart: true,
      ghostBustingQuietHoursEnd: true,
      ghostBustingMaxNudges: true,
      ghostBustingTemplateText: true,
      smsFromNumberE164: true,
      twilioConfig: {
        select: {
          status: true,
          phoneNumber: true,
        },
      },
      messageLanguage: true,
      smsTone: true,
      autoReplyEnabled: true,
      followUpsEnabled: true,
      autoBookingEnabled: true,
      smsGreetingLine: true,
      smsWorkingHoursText: true,
      smsWebsiteSignature: true,
      missedCallAutoReplyOn: true,
      missedCallAutoReplyBody: true,
      missedCallAutoReplyBodyEn: true,
      missedCallAutoReplyBodyEs: true,
      smsQuietHoursStartMinute: true,
      smsQuietHoursEndMinute: true,
      intakeAskLocationBody: true,
      intakeAskLocationBodyEn: true,
      intakeAskLocationBodyEs: true,
      intakeAskWorkTypeBody: true,
      intakeAskWorkTypeBodyEn: true,
      intakeAskWorkTypeBodyEs: true,
      intakeAskCallbackBody: true,
      intakeAskCallbackBodyEn: true,
      intakeAskCallbackBodyEs: true,
      intakeCompletionBody: true,
      intakeCompletionBodyEn: true,
      intakeCompletionBodyEs: true,
      messagingSettings: {
        select: {
          smsTone: true,
          autoReplyEnabled: true,
          followUpsEnabled: true,
          autoBookingEnabled: true,
          workingHoursStart: true,
          workingHoursEnd: true,
          slotDurationMinutes: true,
          bufferMinutes: true,
          daysAhead: true,
          timezone: true,
          customTemplates: true,
        },
      },
      dashboardConfig: {
        select: {
          jobReminderMinutesBefore: true,
          googleReviewUrl: true,
          calendarTimezone: true,
          defaultSlotMinutes: true,
        },
      },
    },
  });

  const sessionUser = await requireSessionUser("/app/settings");
  const currentUser = sessionUser.id
    ? await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          role: true,
          calendarAccessRole: true,
          timezone: true,
        },
      })
    : null;
  const canManageLeadEntrySetting = currentUser
    ? isInternalRole(currentUser.role) || currentUser.calendarAccessRole === "OWNER" || currentUser.calendarAccessRole === "ADMIN"
    : false;
  const canManageAutomationSettings = canManageLeadEntrySetting;

  if (!organization) {
    redirect(scope.internalUser ? "/hq/businesses" : "/app");
  }

  const [googleConnectedCount] = await Promise.all([
    prisma.googleAccount.count({
      where: {
        orgId: scope.orgId,
        isEnabled: true,
      },
    }),
  ]);

  const twilioConfigured = Boolean(organization.twilioConfig?.phoneNumber && organization.twilioConfig?.status !== "PAUSED");
  const intakeConfigured = Boolean(
    organization.intakeAskLocationBodyEn ||
      organization.intakeAskLocationBodyEs ||
      organization.intakeAskWorkTypeBodyEn ||
      organization.intakeAskWorkTypeBodyEs ||
      organization.intakeAskCallbackBodyEn ||
      organization.intakeAskCallbackBodyEs ||
      organization.intakeCompletionBodyEn ||
      organization.intakeCompletionBodyEs,
  );
  const googleConfigured = googleConnectedCount > 0;
  const messagingSettings = organization.messagingSettings;
  const effectiveTone = messagingSettings?.smsTone || organization.smsTone;
  const effectiveAutoReplyEnabled = messagingSettings?.autoReplyEnabled ?? organization.autoReplyEnabled;
  const effectiveFollowUpsEnabled = messagingSettings?.followUpsEnabled ?? organization.followUpsEnabled;
  const effectiveAutoBookingEnabled = messagingSettings?.autoBookingEnabled ?? organization.autoBookingEnabled;
  const effectiveWorkingHoursStart = messagingSettings?.workingHoursStart || "09:00";
  const effectiveWorkingHoursEnd = messagingSettings?.workingHoursEnd || "17:00";
  const effectiveSlotDurationMinutes = messagingSettings?.slotDurationMinutes || organization.dashboardConfig?.defaultSlotMinutes || 60;
  const effectiveBufferMinutes = messagingSettings?.bufferMinutes ?? 15;
  const effectiveDaysAhead = messagingSettings?.daysAhead ?? 3;
  const effectiveMessagingTimezone =
    messagingSettings?.timezone || organization.dashboardConfig?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;
  const normalizedCustomTemplates = normalizeCustomTemplates(messagingSettings?.customTemplates);
  const initialCustomTemplates: SmsVoiceCustomTemplates = {
    greeting: normalizedCustomTemplates.greeting || "",
    askAddress: normalizedCustomTemplates.askAddress || "",
    askTimeframe: normalizedCustomTemplates.askTimeframe || "",
    offerBooking: normalizedCustomTemplates.offerBooking || "",
    bookingConfirmation: normalizedCustomTemplates.bookingConfirmation || "",
    followUp1: normalizedCustomTemplates.followUp1 || "",
    followUp2: normalizedCustomTemplates.followUp2 || "",
    followUp3: normalizedCustomTemplates.followUp3 || "",
  };
  const previewLocale: ResolvedMessageLocale = organization.messageLanguage === "ES" ? "ES" : "EN";
  const previewSlots = await buildSettingsPreviewSlots({
    orgId: organization.id,
    connected: googleConfigured,
    slotDurationMinutes: effectiveSlotDurationMinutes,
    daysAhead: effectiveDaysAhead,
    timezone: ensureTimeZone(effectiveMessagingTimezone),
  });
  const logoUploadsReady = isR2Configured();

  const saved = getParam(searchParams?.saved) === "1";
  const error = getParam(searchParams?.error);

  return (
    <section className="card">
      <h2>{t("settings.title")}</h2>
      <p className="muted">{t("settings.subtitle", { organizationName: organization.name })}</p>
      <div className="settings-integrations-grid" style={{ marginTop: 12 }}>
        <article className="settings-integration-card">
          <strong>{t("settings.integrationGoogle")}</strong>
          <p className={`settings-integration-status ${googleConfigured ? "connected" : "warning"}`}>
            {t(googleConfigured ? "settings.statusConnected" : "settings.statusNotConnected")}
          </p>
          <Link className="btn secondary" href={withOrgQuery("/app/settings/integrations", scope.orgId, scope.internalUser)}>
            {t("buttons.openIntegrations")}
          </Link>
        </article>

        <article className="settings-integration-card">
          <strong>{t("settings.integrationTwilio")}</strong>
          <p className={`settings-integration-status ${twilioConfigured ? "connected" : "warning"}`}>
            {twilioConfigured ? t("settings.statusConnected") : t("settings.statusNotConnected")}
          </p>
          <a className="btn secondary" href="#settings-messaging">
            Review Messaging Setup
          </a>
        </article>

        <article className="settings-integration-card">
          <strong>{t("settings.integrationIntake")}</strong>
          <p className={`settings-integration-status ${intakeConfigured ? "connected" : "warning"}`}>
            {intakeConfigured ? t("settings.statusConfigured") : t("settings.statusNotConnected")}
          </p>
          <a className="btn secondary" href="#settings-templates">
            Configure Intake Templates
          </a>
        </article>

        <article className="settings-integration-card">
          <strong>Branding & Invoices</strong>
          <p className="settings-integration-status">Logo and business details for invoice PDFs.</p>
          <Link className="btn secondary" href={withOrgQuery("/app/settings/branding", scope.orgId, scope.internalUser)}>
            Open Branding
          </Link>
        </article>
      </div>

      <article className="settings-integration-card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Business Logo</strong>
          <Link className="btn secondary" href={withOrgQuery("/app/settings/branding", scope.orgId, scope.internalUser)}>
            Open Full Branding
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Upload your company logo here so invoices and PDF exports look official for your business.
        </p>
        {!logoUploadsReady ? <p className="form-status">Object storage is unavailable. Logo uploads will fall back to inline storage.</p> : null}
        <OrgLogoUploader orgId={organization.id} />
      </article>

      <form action={updateSettingsAction} className="auth-form" style={{ marginTop: 12 }}>
        <input type="hidden" name="orgId" value={organization.id} />

        <div className="settings-accordion">
          <details open>
            <summary>{t("settings.sectionOrganization")}</summary>
            <div className="settings-accordion-body">
              <label>
                {t("settings.businessNameLabel")}
                <input
                  name="organizationName"
                  defaultValue={organization.name}
                  maxLength={120}
                  required
                />
              </label>

              <label>
                {t("settings.calendarTimezoneLabel")}
                <input
                  name="calendarTimezone"
                  defaultValue={organization.dashboardConfig?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE}
                  placeholder={t("settings.timezonePlaceholder")}
                />
              </label>

              <label>
                {t("settings.yourTimezoneLabel")}
                <input
                  name="userTimezone"
                  defaultValue={currentUser?.timezone || ""}
                  placeholder={t("settings.timezonePlaceholder")}
                />
              </label>

              <label>
                {t("settings.reminderTimingLabel")}
                <input
                  type="number"
                  min={15}
                  max={1440}
                  name="jobReminderMinutesBefore"
                  defaultValue={organization.dashboardConfig?.jobReminderMinutesBefore || 120}
                />
              </label>

              <label>
                {t("settings.googleReviewLinkLabel")}
                <input
                  type="url"
                  name="googleReviewUrl"
                  defaultValue={organization.dashboardConfig?.googleReviewUrl || ""}
                  placeholder={t("settings.googleReviewPlaceholder")}
                />
              </label>
            </div>
          </details>

          <details id="settings-messaging" open>
            <summary>{t("settings.sectionMessaging")}</summary>
            <div className="settings-accordion-body">
              <label>
                {t("settings.outboundNumberLabel")}
                <input
                  name="smsFromNumberE164"
                  defaultValue={organization.smsFromNumberE164 || ""}
                  placeholder={t("settings.outboundNumberPlaceholder")}
                />
              </label>

              <label>
                {t("settings.messageLanguageLabel")}
                <select name="messageLanguage" defaultValue={organization.messageLanguage.toLowerCase()}>
                  <option value="en">{t("settings.messageLanguage.en")}</option>
                  <option value="es">{t("settings.messageLanguage.es")}</option>
                  <option value="auto">{t("settings.messageLanguage.auto")}</option>
                </select>
              </label>

              <SmsVoiceSection
                businessName={organization.name}
                locale={previewLocale}
                canManage={canManageAutomationSettings}
                initialTone={effectiveTone}
                initialAutoReplyEnabled={effectiveAutoReplyEnabled}
                initialFollowUpsEnabled={effectiveFollowUpsEnabled}
                initialAutoBookingEnabled={effectiveAutoBookingEnabled}
                initialGreetingLine={organization.smsGreetingLine || ""}
                initialWorkingHoursText={organization.smsWorkingHoursText || ""}
                initialWebsiteSignature={organization.smsWebsiteSignature || ""}
                initialWorkingHoursStart={effectiveWorkingHoursStart}
                initialWorkingHoursEnd={effectiveWorkingHoursEnd}
                initialSlotDurationMinutes={effectiveSlotDurationMinutes}
                initialBufferMinutes={effectiveBufferMinutes}
                initialDaysAhead={effectiveDaysAhead}
                initialTimeZone={ensureTimeZone(effectiveMessagingTimezone)}
                initialCustomTemplates={initialCustomTemplates}
                previewSlots={previewSlots}
              />

              <label>
                {t("settings.smsQuietStartLabel")}
                <input
                  type="time"
                  name="smsQuietHoursStartMinute"
                  defaultValue={minuteToTimeInput(organization.smsQuietHoursStartMinute)}
                />
              </label>
              <label>
                {t("settings.smsQuietEndLabel")}
                <input
                  type="time"
                  name="smsQuietHoursEndMinute"
                  defaultValue={minuteToTimeInput(organization.smsQuietHoursEndMinute)}
                />
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperSmsQuietHours")}</p>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  name="missedCallAutoReplyOn"
                  defaultChecked={organization.missedCallAutoReplyOn}
                />
                {t("settings.missedCallToggle")}
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperMissedCallToggle")}</p>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  name="ghostBustingEnabled"
                  defaultChecked={organization.ghostBustingEnabled}
                  disabled={!canManageAutomationSettings}
                />
                {t("settings.ghostBustingToggle")}
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperGhostBusting")}</p>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  name="voiceNotesEnabled"
                  defaultChecked={organization.voiceNotesEnabled}
                  disabled={!canManageAutomationSettings}
                />
                {t("settings.voiceNotesToggle")}
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperVoiceNotes")}</p>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  name="metaCapiEnabled"
                  defaultChecked={organization.metaCapiEnabled}
                  disabled={!canManageAutomationSettings}
                />
                {t("settings.metaCapiToggle")}
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperMetaCapi")}</p>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  name="offlineModeEnabled"
                  defaultChecked={organization.offlineModeEnabled}
                  disabled={!canManageAutomationSettings}
                />
                {t("settings.offlineModeToggle")}
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperOfflineMode")}</p>

              <label>
                {t("settings.ghostQuietStartLabel")}
                <input
                  type="time"
                  name="ghostBustingQuietHoursStart"
                  defaultValue={minuteToTimeInput(organization.ghostBustingQuietHoursStart)}
                  disabled={!canManageAutomationSettings}
                />
              </label>
              <label>
                {t("settings.ghostQuietEndLabel")}
                <input
                  type="time"
                  name="ghostBustingQuietHoursEnd"
                  defaultValue={minuteToTimeInput(organization.ghostBustingQuietHoursEnd)}
                  disabled={!canManageAutomationSettings}
                />
              </label>
              <label>
                {t("settings.ghostMaxNudgesLabel")}
                <input
                  type="number"
                  min={1}
                  max={10}
                  name="ghostBustingMaxNudges"
                  defaultValue={organization.ghostBustingMaxNudges}
                  disabled={!canManageAutomationSettings}
                />
              </label>
              <label>
                {t("settings.ghostTemplateLabel")}
                <textarea
                  name="ghostBustingTemplateText"
                  rows={4}
                  maxLength={1600}
                  disabled={!canManageAutomationSettings}
                  defaultValue={organization.ghostBustingTemplateText || t("settings.ghostTemplateDefault")}
                />
              </label>
              {!canManageAutomationSettings ? (
                <p className="muted">{t("settings.automationFlagsNote")}</p>
              ) : null}
            </div>
          </details>

          <details id="settings-templates">
            <summary>{t("settings.sectionTemplates")}</summary>
            <div className="settings-accordion-body">
              <p className="muted">
                SMS template packs and custom copy are now managed in <strong>Messaging → SMS Voice</strong> above.
              </p>
              <p className="muted">
                Logic for STOP handling, stage transitions, follow-up cadence, and silent human takeover stays locked for
                compliance and reliability.
              </p>
            </div>
          </details>

          <details open>
            <summary>{t("settings.sectionTeam")}</summary>
            <div className="settings-accordion-body">
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  name="allowWorkerLeadCreate"
                  defaultChecked={organization.allowWorkerLeadCreate}
                  disabled={!canManageLeadEntrySetting}
                />
                {t("settings.allowWorkerLeadCreate")}
              </label>
              <p className="muted settings-toggle-help">{t("settings.helperWorkerLeadCreate")}</p>
              {!canManageLeadEntrySetting ? (
                <p className="muted">{t("settings.allowWorkerLeadCreateNote")}</p>
              ) : null}
            </div>
          </details>
        </div>

        <button className="btn primary" type="submit" aria-label="Save settings">
          {t("buttons.saveSettings")}
        </button>

        {saved ? <p className="form-status">{t("settings.saved")}</p> : null}
        {error === "missing-org" ? <p className="form-status">{t("settings.errors.missingOrg")}</p> : null}
        {error === "invalid-sender" ? <p className="form-status">{t("settings.errors.invalidSender")}</p> : null}
        {error === "invalid-message-language" ? (
          <p className="form-status">{t("settings.errors.invalidMessageLanguage")}</p>
        ) : null}
        {error === "invalid-sms-tone" ? <p className="form-status">Invalid SMS voice selection.</p> : null}
        {error === "invalid-message" ? <p className="form-status">{t("settings.errors.invalidMessage")}</p> : null}
        {error === "invalid-reminder" ? (
          <p className="form-status">{t("settings.errors.invalidReminder")}</p>
        ) : null}
        {error === "invalid-review-url" ? <p className="form-status">{t("settings.errors.invalidReviewUrl")}</p> : null}
        {error === "invalid-calendar-timezone" ? (
          <p className="form-status">{t("settings.errors.invalidCalendarTimezone")}</p>
        ) : null}
        {error === "invalid-user-timezone" ? (
          <p className="form-status">{t("settings.errors.invalidUserTimezone")}</p>
        ) : null}
        {error === "invalid-business-name" ? (
          <p className="form-status">{t("settings.errors.invalidBusinessName")}</p>
        ) : null}
        {error === "invalid-ghost-hours" ? (
          <p className="form-status">{t("settings.errors.invalidGhostHours")}</p>
        ) : null}
        {error === "invalid-ghost-max" ? (
          <p className="form-status">{t("settings.errors.invalidGhostMax")}</p>
        ) : null}
        {error === "invalid-ghost-template" ? (
          <p className="form-status">{t("settings.errors.invalidGhostTemplate")}</p>
        ) : null}
        {error === "invalid-sms-quiet-hours" ? (
          <p className="form-status">{t("settings.errors.invalidSmsQuietHours")}</p>
        ) : null}
      </form>
    </section>
  );
}
