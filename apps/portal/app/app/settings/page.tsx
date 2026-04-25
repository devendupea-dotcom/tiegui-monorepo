import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Prisma, type CalendarAccessRole, type MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isR2Configured } from "@/lib/r2";
import {
  computeAvailabilityForWorker,
  getOrgCalendarSettings,
} from "@/lib/calendar/availability";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  ensureTimeZone,
  isValidTimeZone,
} from "@/lib/calendar/dates";
import {
  buildSmsAgentPlaybookInput,
  normalizeSmsAgentPlaybook,
} from "@/lib/conversational-sms-agent-playbook";
import {
  containsAutomationRevealLanguage,
  normalizeCustomTemplates,
} from "@/lib/conversational-sms-templates";
import { getRequestLocale, getRequestTranslator } from "@/lib/i18n";
import type { ResolvedMessageLocale } from "@/lib/message-language";
import { sendEmail } from "@/lib/mailer";
import { normalizeE164 } from "@/lib/phone";
import { requireSessionUser } from "@/lib/session";
import {
  getMessagingAutomationHealthSummary,
} from "@/lib/messaging-automation-health";
import {
  buildTeamMembershipCompatibilityUpdate,
  isTeamCalendarAccessRole,
  TEAM_CALENDAR_ROLE_OPTIONS,
  wouldLeaveWorkspaceWithoutOwner,
} from "@/lib/team-management";
import { createResetToken } from "@/lib/tokens";
import {
  resolveTwilioMessagingReadiness,
  type TwilioMessagingReadinessCode,
} from "@/lib/twilio-readiness";
import {
  createProvisionedPortalUser,
  syncClientUserOrganizationAccess,
} from "@/lib/user-provisioning";
import { getConfiguredBaseUrl } from "@/lib/urls";
import { listWorkspaceUsers } from "@/lib/workspace-users";
import {
  getParam,
  requireAppOrgActor,
  resolveAppScope,
  withOrgQuery,
} from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import CommunicationDiagnosticsCard from "./communication-diagnostics-card";
import MessagingAutomationHealthCard from "./messaging-automation-health-card";
import OrgLogoUploader from "./branding/org-logo-uploader";
import {
  SmsVoiceSection,
  type SmsAgentPlaybookFormValues,
  type SmsVoiceCustomTemplates,
} from "./sms-voice-section";

export const dynamic = "force-dynamic";

type WorkspaceTeamMember = {
  userId: string;
  name: string | null;
  email: string;
  phoneE164: string | null;
  timezone: string | null;
  role: CalendarAccessRole;
  status: MembershipStatus;
  createdAt: Date;
  mustChangePassword: boolean;
};

const TEAM_STATUS_RANK: Record<MembershipStatus, number> = {
  ACTIVE: 0,
  INVITED: 1,
  SUSPENDED: 2,
};

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
):
  | "FRIENDLY"
  | "PROFESSIONAL"
  | "DIRECT"
  | "SALES"
  | "PREMIUM"
  | "BILINGUAL"
  | "CUSTOM"
  | null {
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

function getTwilioReadinessKey(code: TwilioMessagingReadinessCode) {
  switch (code) {
    case "ACTIVE":
      return "active";
    case "PENDING_A2P":
      return "pending";
    case "PAUSED":
      return "paused";
    case "SEND_DISABLED":
      return "sendDisabled";
    case "TOKEN_KEY_MISSING":
      return "tokenMissing";
    default:
      return "notConfigured";
  }
}

function buildSettingsPath(input: {
  orgId: string;
  internalUser: boolean;
  params?: Record<string, string | undefined>;
  hash?: string;
}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(input.params || {})) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return withOrgQuery(
    `/app/settings${query ? `?${query}` : ""}${input.hash || ""}`,
    input.orgId,
    input.internalUser,
  );
}

function redirectToTeamManagement(input: {
  orgId: string;
  internalUser: boolean;
  saved?: string;
  error?: string;
  teamSetupToken?: string;
  teamSetupEmail?: string;
}): never {
  return redirect(
    buildSettingsPath({
      orgId: input.orgId,
      internalUser: input.internalUser,
      params: {
        ...(input.saved ? { teamSaved: input.saved } : {}),
        ...(input.error ? { teamError: input.error } : {}),
        ...(input.teamSetupToken ? { teamSetupToken: input.teamSetupToken } : {}),
        ...(input.teamSetupEmail ? { teamSetupEmail: input.teamSetupEmail } : {}),
      },
      hash: "#settings-team-management",
    }),
  );
}

function revalidateWorkspaceTeamPaths(orgId: string) {
  revalidatePath("/app");
  revalidatePath("/app/settings");
  revalidatePath("/app/calendar");
  revalidatePath("/app/jobs");
  revalidatePath("/app/inbox");
  revalidatePath("/hq/businesses");
  revalidatePath(`/hq/businesses/${orgId}`);
}

function sortWorkspaceTeamMembers(members: WorkspaceTeamMember[]) {
  return [...members].sort((left, right) => {
    const statusDiff =
      (TEAM_STATUS_RANK[left.status] ?? 99) -
      (TEAM_STATUS_RANK[right.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;

    const roleDiff =
      TEAM_CALENDAR_ROLE_OPTIONS.indexOf(left.role) -
      TEAM_CALENDAR_ROLE_OPTIONS.indexOf(right.role);
    if (roleDiff !== 0) return roleDiff;

    const leftLabel = (left.name || left.email).toLowerCase();
    const rightLabel = (right.name || right.email).toLowerCase();
    const labelDiff = leftLabel.localeCompare(rightLabel);
    if (labelDiff !== 0) return labelDiff;

    return left.userId.localeCompare(right.userId);
  });
}

function getTeamRoleTranslationKey(role: CalendarAccessRole) {
  switch (role) {
    case "OWNER":
      return "owner";
    case "ADMIN":
      return "admin";
    case "WORKER":
      return "worker";
    default:
      return "readOnly";
  }
}

function getTeamStatusTranslationKey(status: MembershipStatus) {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "INVITED":
      return "invited";
    default:
      return "suspended";
  }
}

async function requireTeamManagementAccess(orgId: string) {
  const actor = await requireAppOrgActor("/app/settings", orgId);
  const internalUser = actor.internalUser;
  const canManageTeam =
    actor.internalUser ||
    actor.calendarAccessRole === "OWNER" ||
    actor.calendarAccessRole === "ADMIN";

  if (!canManageTeam) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "forbidden",
    });
  }

  return {
    actor,
    internalUser,
  };
}

async function requireTeamMemberActionAccess(formData: FormData) {
  const orgId = String(formData.get("orgId") || "").trim();
  const userId = String(formData.get("userId") || "").trim();

  if (!orgId || !userId) {
    redirect("/app/settings?error=missing-org");
  }

  const { actor, internalUser } = await requireTeamManagementAccess(orgId);
  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId,
      },
    },
    select: {
      organizationId: true,
      role: true,
      status: true,
      user: {
        select: {
          id: true,
          role: true,
          orgId: true,
        },
      },
    },
  });

  if (!membership || membership.user.role !== "CLIENT") {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "memberMissing",
    });
  }

  return {
    actor,
    internalUser,
    orgId,
    membership,
  };
}

async function createTeamMemberAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings?error=missing-org");
  }

  const { internalUser } = await requireTeamManagementAccess(orgId);

  const name = String(formData.get("name") || "").trim() || null;
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const phoneRaw = String(formData.get("phoneE164") || "").trim();
  const timezoneInput = String(formData.get("timezone") || "").trim();
  const roleInput = String(formData.get("role") || "").trim().toUpperCase();

  if (!email || !email.includes("@")) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "invalidTeamEmail",
    });
  }

  if (!isTeamCalendarAccessRole(roleInput)) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "invalidTeamRole",
    });
  }

  const normalizedPhone = phoneRaw ? normalizeE164(phoneRaw) : null;
  if (phoneRaw && !normalizedPhone) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "invalidTeamPhone",
    });
  }

  if (timezoneInput && !isValidTimeZone(timezoneInput)) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "invalidTeamTimezone",
    });
  }

  const timezone = timezoneInput ? ensureTimeZone(timezoneInput) : null;
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!organization) {
    redirect("/app/settings?error=missing-org");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      name: true,
      phoneE164: true,
      timezone: true,
      organizationMemberships: {
        where: {
          organizationId: orgId,
        },
        select: {
          organizationId: true,
        },
        take: 1,
      },
    },
  });

  if (existingUser?.organizationMemberships.length) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "memberExists",
    });
  }

  if (existingUser && existingUser.role !== "CLIENT") {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "emailConflict",
    });
  }

  if (!existingUser) {
    const baseUrl = getConfiguredBaseUrl();
    if (!baseUrl) {
      redirectToTeamManagement({
        orgId,
        internalUser,
        error: "inviteLinkUnavailable",
      });
    }

    const { token, tokenHash } = createResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await createProvisionedPortalUser({
        tx,
        email,
        name,
        role: "CLIENT",
        orgId,
        calendarAccessRole: roleInput,
        phoneE164: normalizedPhone,
        timezone,
        mustChangePassword: true,
      });

      await tx.passwordResetToken.create({
        data: {
          tokenHash,
          userId: createdUser.id,
          expiresAt,
        },
      });

      return createdUser;
    });

    const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await sendEmail({
        to: user.email,
        subject: `Set up your ${organization.name} portal access`,
        text:
          `You now have access to ${organization.name} in the TieGui Portal.\n\n` +
          `Set your password here:\n${setupUrl}\n\n` +
          `This link expires in 60 minutes.\n\n` +
          `After setting your password, you can sign in at:\n${baseUrl}/login`,
      });
    } catch (error) {
      console.error("settings:create-team-member sendEmail failed", error);
      revalidateWorkspaceTeamPaths(orgId);
      redirectToTeamManagement({
        orgId,
        internalUser,
        saved: "memberCreatedManual",
        teamSetupToken: token,
        teamSetupEmail: email,
      });
    }

    revalidateWorkspaceTeamPaths(orgId);
    redirectToTeamManagement({
      orgId,
      internalUser,
      saved: "memberCreated",
    });
  }

  await prisma.$transaction(async (tx) => {
    if (name || normalizedPhone || timezone) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          ...(name ? { name } : {}),
          ...(normalizedPhone ? { phoneE164: normalizedPhone } : {}),
          ...(timezone ? { timezone } : {}),
        },
      });
    }

    await syncClientUserOrganizationAccess({
      tx,
      userId: existingUser.id,
      organizationId: orgId,
      role: roleInput,
    });
  });

  revalidateWorkspaceTeamPaths(orgId);
  redirectToTeamManagement({
    orgId,
    internalUser,
    saved: "memberAdded",
  });
}

async function updateTeamMemberRoleAction(formData: FormData) {
  "use server";

  const nextRole = String(formData.get("role") || "").trim().toUpperCase();
  if (!isTeamCalendarAccessRole(nextRole)) {
    const orgId = String(formData.get("orgId") || "").trim();
    const { internalUser } = orgId
      ? await requireTeamManagementAccess(orgId)
      : { internalUser: false };
    if (orgId) {
      redirectToTeamManagement({
        orgId,
        internalUser,
        error: "invalidTeamRole",
      });
    }
    redirect("/app/settings?error=missing-org");
  }

  const { internalUser, orgId, membership } =
    await requireTeamMemberActionAccess(formData);
  const activeOwnerCount = await prisma.organizationMembership.count({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: "OWNER",
    },
  });

  if (
    wouldLeaveWorkspaceWithoutOwner({
      currentRole: membership.role,
      currentStatus: membership.status,
      nextRole,
      nextStatus: membership.status,
      activeOwnerCount,
    })
  ) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "lastOwner",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: membership.user.id,
        },
      },
      data: {
        role: nextRole,
      },
    });

    if (membership.status === "ACTIVE") {
      const compatibilityUpdate = buildTeamMembershipCompatibilityUpdate({
        currentOrgId: membership.user.orgId,
        targetOrgId: orgId,
        role: nextRole,
        nextStatus: "ACTIVE",
      });

      if (compatibilityUpdate) {
        await tx.user.update({
          where: { id: membership.user.id },
          data: compatibilityUpdate,
        });
      }
    }
  });

  revalidateWorkspaceTeamPaths(orgId);
  redirectToTeamManagement({
    orgId,
    internalUser,
    saved: "memberRoleUpdated",
  });
}

async function updateTeamMemberStatusAction(formData: FormData) {
  "use server";

  const nextStatus = String(formData.get("status") || "").trim().toUpperCase();
  if (nextStatus !== "ACTIVE" && nextStatus !== "SUSPENDED") {
    const orgId = String(formData.get("orgId") || "").trim();
    const { internalUser } = orgId
      ? await requireTeamManagementAccess(orgId)
      : { internalUser: false };
    if (orgId) {
      redirectToTeamManagement({
        orgId,
        internalUser,
        error: "invalidTeamStatus",
      });
    }
    redirect("/app/settings?error=missing-org");
  }

  const { internalUser, orgId, membership } =
    await requireTeamMemberActionAccess(formData);
  const activeOwnerCount = await prisma.organizationMembership.count({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: "OWNER",
    },
  });

  if (
    wouldLeaveWorkspaceWithoutOwner({
      currentRole: membership.role,
      currentStatus: membership.status,
      nextRole: membership.role,
      nextStatus,
      activeOwnerCount,
    })
  ) {
    redirectToTeamManagement({
      orgId,
      internalUser,
      error: "lastOwner",
    });
  }

  const fallbackActiveMembership =
    nextStatus === "SUSPENDED" && membership.user.orgId === orgId
      ? await prisma.organizationMembership.findFirst({
          where: {
            userId: membership.user.id,
            organizationId: {
              not: orgId,
            },
            status: "ACTIVE",
          },
          orderBy: {
            createdAt: "asc",
          },
          select: {
            organizationId: true,
            role: true,
          },
        })
      : null;

  const compatibilityUpdate = buildTeamMembershipCompatibilityUpdate({
    currentOrgId: membership.user.orgId,
    targetOrgId: orgId,
    role: membership.role,
    nextStatus,
    fallbackActiveMembership,
  });

  await prisma.$transaction(async (tx) => {
    await tx.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: membership.user.id,
        },
      },
      data: {
        status: nextStatus,
      },
    });

    if (compatibilityUpdate) {
      await tx.user.update({
        where: { id: membership.user.id },
        data: compatibilityUpdate,
      });
    }
  });

  revalidateWorkspaceTeamPaths(orgId);
  redirectToTeamManagement({
    orgId,
    internalUser,
    saved: nextStatus === "ACTIVE" ? "memberReactivated" : "memberSuspended",
  });
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

  const workers = await listWorkspaceUsers({
    organizationId: input.orgId,
    excludeReadOnly: true,
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
    const date = formatInTimeZone(
      addDays(now, offset),
      input.timezone || settings.calendarTimezone,
      "yyyy-MM-dd",
    );
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
        const day = formatInTimeZone(
          slotDate,
          input.timezone || settings.calendarTimezone,
          "EEE",
        );
        const time = formatInTimeZone(
          slotDate,
          input.timezone || settings.calendarTimezone,
          "h:mmaaa",
        ).toLowerCase();
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

  const actor = await requireAppOrgActor("/app/settings", orgId);
  const internalUser = actor.internalUser;
  const canManageLeadEntrySetting =
    actor.internalUser ||
    actor.calendarAccessRole === "OWNER" ||
    actor.calendarAccessRole === "ADMIN";
  const canManageAutomationSettings = canManageLeadEntrySetting;
  const currentOrganization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      autoReplyEnabled: true,
      followUpsEnabled: true,
      autoBookingEnabled: true,
      missedCallAutoReplyOn: true,
      ghostBustingEnabled: true,
      twilioConfig: {
        select: {
          phoneNumber: true,
          status: true,
        },
      },
      messagingSettings: {
        select: {
          autoReplyEnabled: true,
          followUpsEnabled: true,
          autoBookingEnabled: true,
        },
      },
    },
  });

  if (!currentOrganization) {
    redirect(
      withOrgQuery("/app/settings?error=missing-org", orgId, internalUser),
    );
  }

  const twilioReadiness = resolveTwilioMessagingReadiness({
    twilioConfig: currentOrganization.twilioConfig,
  });
  const canManageLiveAutomation =
    canManageAutomationSettings && twilioReadiness.canSend;

  const senderRaw = String(formData.get("smsFromNumberE164") || "").trim();
  const organizationName = String(
    formData.get("organizationName") || "",
  ).trim();
  const messageLanguageRaw = String(
    formData.get("messageLanguage") || "",
  ).trim();
  const smsToneRaw = String(formData.get("smsTone") || "").trim();
  const autoReplyEnabled =
    String(formData.get("autoReplyEnabled") || "") === "on";
  const followUpsEnabled =
    String(formData.get("followUpsEnabled") || "") === "on";
  const autoBookingEnabled =
    String(formData.get("autoBookingEnabled") || "") === "on";
  const smsGreetingLine = String(formData.get("smsGreetingLine") || "").trim();
  const smsWorkingHoursText = String(
    formData.get("smsWorkingHoursText") || "",
  ).trim();
  const smsWebsiteSignature = String(
    formData.get("smsWebsiteSignature") || "",
  ).trim();
  const workingHoursStartRaw = String(
    formData.get("workingHoursStart") || "",
  ).trim();
  const workingHoursEndRaw = String(
    formData.get("workingHoursEnd") || "",
  ).trim();
  const slotDurationMinutesRaw = String(
    formData.get("slotDurationMinutes") || "",
  ).trim();
  const bufferMinutesRaw = String(formData.get("bufferMinutes") || "").trim();
  const daysAheadRaw = String(formData.get("daysAhead") || "").trim();
  const messagingTimezoneRaw = String(
    formData.get("messagingTimezone") || "",
  ).trim();
  const customTemplateGreeting = String(
    formData.get("customTemplateGreeting") || "",
  ).trim();
  const customTemplateAskAddress = String(
    formData.get("customTemplateAskAddress") || "",
  ).trim();
  const customTemplateAskTimeframe = String(
    formData.get("customTemplateAskTimeframe") || "",
  ).trim();
  const customTemplateOfferBooking = String(
    formData.get("customTemplateOfferBooking") || "",
  ).trim();
  const customTemplateBookingConfirmation = String(
    formData.get("customTemplateBookingConfirmation") || "",
  ).trim();
  const customTemplateFollowUp1 = String(
    formData.get("customTemplateFollowUp1") || "",
  ).trim();
  const customTemplateFollowUp2 = String(
    formData.get("customTemplateFollowUp2") || "",
  ).trim();
  const customTemplateFollowUp3 = String(
    formData.get("customTemplateFollowUp3") || "",
  ).trim();
  const smsAgentPrimaryGoal = String(
    formData.get("smsAgentPrimaryGoal") || "",
  ).trim();
  const smsAgentBusinessContext = String(
    formData.get("smsAgentBusinessContext") || "",
  ).trim();
  const smsAgentServicesSummary = String(
    formData.get("smsAgentServicesSummary") || "",
  ).trim();
  const smsAgentServiceAreaSummary = String(
    formData.get("smsAgentServiceAreaSummary") || "",
  ).trim();
  const smsAgentRequiredDetails = String(
    formData.get("smsAgentRequiredDetails") || "",
  ).trim();
  const smsAgentHandoffTriggers = String(
    formData.get("smsAgentHandoffTriggers") || "",
  ).trim();
  const smsAgentToneNotes = String(
    formData.get("smsAgentToneNotes") || "",
  ).trim();
  const smsAgentEstimatorName = String(
    formData.get("smsAgentEstimatorName") || "",
  ).trim();
  const smsAgentSchedulingNotes = String(
    formData.get("smsAgentSchedulingNotes") || "",
  ).trim();
  const smsAgentDoNotPromise = String(
    formData.get("smsAgentDoNotPromise") || "",
  ).trim();
  const smsAgentUseInboundPhoneAsCallback =
    String(formData.get("smsAgentUseInboundPhoneAsCallback") || "") === "on";
  const missedCallAutoReplyOn =
    String(formData.get("missedCallAutoReplyOn") || "") === "on";
  const missedCallMessageEn = String(
    formData.get("missedCallAutoReplyBodyEn") || "",
  ).trim();
  const missedCallMessageEs = String(
    formData.get("missedCallAutoReplyBodyEs") || "",
  ).trim();
  const intakeAskLocationBodyEn = String(
    formData.get("intakeAskLocationBodyEn") || "",
  ).trim();
  const intakeAskLocationBodyEs = String(
    formData.get("intakeAskLocationBodyEs") || "",
  ).trim();
  const intakeAskWorkTypeBodyEn = String(
    formData.get("intakeAskWorkTypeBodyEn") || "",
  ).trim();
  const intakeAskWorkTypeBodyEs = String(
    formData.get("intakeAskWorkTypeBodyEs") || "",
  ).trim();
  const intakeAskCallbackBodyEn = String(
    formData.get("intakeAskCallbackBodyEn") || "",
  ).trim();
  const intakeAskCallbackBodyEs = String(
    formData.get("intakeAskCallbackBodyEs") || "",
  ).trim();
  const intakeCompletionBodyEn = String(
    formData.get("intakeCompletionBodyEn") || "",
  ).trim();
  const intakeCompletionBodyEs = String(
    formData.get("intakeCompletionBodyEs") || "",
  ).trim();
  const reminderMinutesInput = String(
    formData.get("jobReminderMinutesBefore") || "",
  ).trim();
  const googleReviewUrl = String(formData.get("googleReviewUrl") || "").trim();
  const allowWorkerLeadCreate =
    String(formData.get("allowWorkerLeadCreate") || "") === "on";
  const ghostBustingEnabled =
    String(formData.get("ghostBustingEnabled") || "") === "on";
  const voiceNotesEnabled =
    String(formData.get("voiceNotesEnabled") || "") === "on";
  const metaCapiEnabled =
    String(formData.get("metaCapiEnabled") || "") === "on";
  const offlineModeEnabled =
    String(formData.get("offlineModeEnabled") || "") === "on";
  const quietStartRaw = String(
    formData.get("ghostBustingQuietHoursStart") || "",
  ).trim();
  const quietEndRaw = String(
    formData.get("ghostBustingQuietHoursEnd") || "",
  ).trim();
  const smsQuietStartRaw = String(
    formData.get("smsQuietHoursStartMinute") || "",
  ).trim();
  const smsQuietEndRaw = String(
    formData.get("smsQuietHoursEndMinute") || "",
  ).trim();
  const maxNudgesRaw = String(
    formData.get("ghostBustingMaxNudges") || "",
  ).trim();
  const ghostTemplateText = String(
    formData.get("ghostBustingTemplateText") || "",
  ).trim();
  const calendarTimezoneInput = String(
    formData.get("calendarTimezone") || "",
  ).trim();
  const userTimezoneInput = String(formData.get("userTimezone") || "").trim();
  const calendarTimezone = calendarTimezoneInput || DEFAULT_CALENDAR_TIMEZONE;
  const userTimezone = userTimezoneInput || null;

  const sender = senderRaw ? normalizeE164(senderRaw) : null;
  const messageLanguage = parseMessageLanguage(messageLanguageRaw);
  const smsTone = parseSmsTone(smsToneRaw);
  if (senderRaw && !sender) {
    redirect(
      withOrgQuery("/app/settings?error=invalid-sender", orgId, internalUser),
    );
  }

  if (!messageLanguage) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-message-language",
        orgId,
        internalUser,
      ),
    );
  }

  if (canManageAutomationSettings && !smsTone) {
    redirect(
      withOrgQuery("/app/settings?error=invalid-sms-tone", orgId, internalUser),
    );
  }

  if (
    smsGreetingLine.length > 220 ||
    smsWorkingHoursText.length > 220 ||
    smsWebsiteSignature.length > 220
  ) {
    redirect(
      withOrgQuery("/app/settings?error=invalid-message", orgId, internalUser),
    );
  }

  const workingHoursStart = parseTimeInput(workingHoursStartRaw || "09:00");
  const workingHoursEnd = parseTimeInput(workingHoursEndRaw || "17:00");
  const slotDurationMinutes = clampInt(
    Number.parseInt(slotDurationMinutesRaw || "60", 10),
    15,
    180,
  );
  const bufferMinutes = clampInt(
    Number.parseInt(bufferMinutesRaw || "15", 10),
    0,
    120,
  );
  const daysAhead = clampInt(Number.parseInt(daysAheadRaw || "3", 10), 1, 14);
  const messagingTimezone = messagingTimezoneRaw || calendarTimezone;

  if (!workingHoursStart || !workingHoursEnd) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-working-hours",
        orgId,
        internalUser,
      ),
    );
  }

  if (!isValidTimeZone(messagingTimezone)) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-messaging-timezone",
        orgId,
        internalUser,
      ),
    );
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
  const smsAgentPlaybookInput: SmsAgentPlaybookFormValues = {
    primaryGoal: smsAgentPrimaryGoal,
    businessContext: smsAgentBusinessContext,
    servicesSummary: smsAgentServicesSummary,
    serviceAreaSummary: smsAgentServiceAreaSummary,
    requiredDetails: smsAgentRequiredDetails,
    handoffTriggers: smsAgentHandoffTriggers,
    toneNotes: smsAgentToneNotes,
    estimatorName: smsAgentEstimatorName,
    schedulingNotes: smsAgentSchedulingNotes,
    doNotPromise: smsAgentDoNotPromise,
    useInboundPhoneAsCallback: smsAgentUseInboundPhoneAsCallback,
  };

  for (const value of Object.values(customTemplatesInput)) {
    if (value.length > 1600) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-message",
          orgId,
          internalUser,
        ),
      );
    }
    if (containsAutomationRevealLanguage(value)) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-custom-template",
          orgId,
          internalUser,
        ),
      );
    }
  }

  for (const [key, value] of Object.entries(smsAgentPlaybookInput)) {
    if (typeof value === "string" && value.length > 1600) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-message",
          orgId,
          internalUser,
        ),
      );
    }
    if (
      key === "estimatorName" &&
      typeof value === "string" &&
      value.length > 120
    ) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-message",
          orgId,
          internalUser,
        ),
      );
    }
  }

  const customTemplatesJson = normalizeCustomTemplates(customTemplatesInput);
  const smsAgentPlaybookJson = buildSmsAgentPlaybookInput(
    smsAgentPlaybookInput,
  );
  const customModeEnabled = canManageAutomationSettings && smsTone === "CUSTOM";
  const legacyInitial = customModeEnabled
    ? customTemplateGreeting || null
    : undefined;
  const legacyAskAddress = customModeEnabled
    ? customTemplateAskAddress || null
    : undefined;
  const legacyAskTimeframe = customModeEnabled
    ? customTemplateAskTimeframe || null
    : undefined;
  const legacyOfferBooking = customModeEnabled
    ? customTemplateOfferBooking || null
    : undefined;
  const legacyBookingConfirmation = customModeEnabled
    ? customTemplateBookingConfirmation || null
    : undefined;
  const missedCallLegacy =
    missedCallMessageEn || missedCallMessageEs || legacyInitial || null;
  const intakeAskLocationLegacy =
    intakeAskLocationBodyEn ||
    intakeAskLocationBodyEs ||
    legacyAskAddress ||
    null;
  const intakeAskWorkTypeLegacy =
    intakeAskWorkTypeBodyEn ||
    intakeAskWorkTypeBodyEs ||
    legacyAskTimeframe ||
    null;
  const intakeAskCallbackLegacy =
    intakeAskCallbackBodyEn ||
    intakeAskCallbackBodyEs ||
    legacyOfferBooking ||
    null;
  const intakeCompletionLegacy =
    intakeCompletionBodyEn ||
    intakeCompletionBodyEs ||
    legacyBookingConfirmation ||
    null;

  if (!organizationName || organizationName.length > 120) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-business-name",
        orgId,
        internalUser,
      ),
    );
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
    redirect(
      withOrgQuery("/app/settings?error=invalid-message", orgId, internalUser),
    );
  }

  const reminderMinutesBefore = Number.parseInt(reminderMinutesInput, 10);
  if (
    !Number.isFinite(reminderMinutesBefore) ||
    reminderMinutesBefore < 15 ||
    reminderMinutesBefore > 1440
  ) {
    redirect(
      withOrgQuery("/app/settings?error=invalid-reminder", orgId, internalUser),
    );
  }

  if (!isValidTimeZone(calendarTimezone)) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-calendar-timezone",
        orgId,
        internalUser,
      ),
    );
  }

  if (userTimezone && !isValidTimeZone(userTimezone)) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-user-timezone",
        orgId,
        internalUser,
      ),
    );
  }

  if (googleReviewUrl) {
    try {
      const parsed = new URL(googleReviewUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-review-url",
          orgId,
          internalUser,
        ),
      );
    }
  }

  let quietStartMinute: number | null = null;
  let quietEndMinute: number | null = null;
  const smsQuietStartMinute = parseQuietHourMinute(smsQuietStartRaw);
  const smsQuietEndMinute = parseQuietHourMinute(smsQuietEndRaw);
  let ghostBustingMaxNudges = 2;
  if (smsQuietStartMinute === null || smsQuietEndMinute === null) {
    redirect(
      withOrgQuery(
        "/app/settings?error=invalid-sms-quiet-hours",
        orgId,
        internalUser,
      ),
    );
  }

  if (canManageAutomationSettings) {
    quietStartMinute = parseQuietHourMinute(quietStartRaw);
    quietEndMinute = parseQuietHourMinute(quietEndRaw);
    if (quietStartMinute === null || quietEndMinute === null) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-ghost-hours",
          orgId,
          internalUser,
        ),
      );
    }

    ghostBustingMaxNudges = Number.parseInt(maxNudgesRaw, 10);
    if (
      !Number.isFinite(ghostBustingMaxNudges) ||
      ghostBustingMaxNudges < 1 ||
      ghostBustingMaxNudges > 10
    ) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-ghost-max",
          orgId,
          internalUser,
        ),
      );
    }

    if (ghostTemplateText.length > 1600) {
      redirect(
        withOrgQuery(
          "/app/settings?error=invalid-ghost-template",
          orgId,
          internalUser,
        ),
      );
    }
  }

  const currentAutoReplyEnabled =
    currentOrganization.messagingSettings?.autoReplyEnabled ??
    currentOrganization.autoReplyEnabled;
  const currentFollowUpsEnabled =
    currentOrganization.messagingSettings?.followUpsEnabled ??
    currentOrganization.followUpsEnabled;
  const currentAutoBookingEnabled =
    currentOrganization.messagingSettings?.autoBookingEnabled ??
    currentOrganization.autoBookingEnabled;
  const nextMissedCallAutoReplyOn = canManageLiveAutomation
    ? missedCallAutoReplyOn
    : currentOrganization.missedCallAutoReplyOn;
  const nextGhostBustingEnabled = canManageLiveAutomation
    ? ghostBustingEnabled
    : currentOrganization.ghostBustingEnabled;
  const nextAutoReplyEnabled = canManageLiveAutomation
    ? autoReplyEnabled
    : currentAutoReplyEnabled;
  const nextFollowUpsEnabled = canManageLiveAutomation
    ? followUpsEnabled
    : currentFollowUpsEnabled;
  const nextAutoBookingEnabled = canManageLiveAutomation
    ? autoBookingEnabled
    : currentAutoBookingEnabled;

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      smsFromNumberE164: sender,
      name: organizationName,
      messageLanguage,
      smsTone: canManageAutomationSettings ? smsTone! : undefined,
      autoReplyEnabled: canManageAutomationSettings
        ? nextAutoReplyEnabled
        : undefined,
      followUpsEnabled: canManageAutomationSettings
        ? nextFollowUpsEnabled
        : undefined,
      autoBookingEnabled: canManageAutomationSettings
        ? nextAutoBookingEnabled
        : undefined,
      smsGreetingLine: canManageAutomationSettings
        ? smsGreetingLine || null
        : undefined,
      smsWorkingHoursText: canManageAutomationSettings
        ? smsWorkingHoursText || null
        : undefined,
      smsWebsiteSignature: canManageAutomationSettings
        ? smsWebsiteSignature || null
        : undefined,
      missedCallAutoReplyOn: nextMissedCallAutoReplyOn,
      missedCallAutoReplyBody: canManageAutomationSettings
        ? missedCallLegacy
        : undefined,
      missedCallAutoReplyBodyEn: canManageAutomationSettings
        ? missedCallMessageEn || null
        : undefined,
      missedCallAutoReplyBodyEs: canManageAutomationSettings
        ? missedCallMessageEs || null
        : undefined,
      intakeAskLocationBody: canManageAutomationSettings
        ? intakeAskLocationLegacy
        : undefined,
      intakeAskLocationBodyEn: canManageAutomationSettings
        ? intakeAskLocationBodyEn || null
        : undefined,
      intakeAskLocationBodyEs: canManageAutomationSettings
        ? intakeAskLocationBodyEs || null
        : undefined,
      intakeAskWorkTypeBody: canManageAutomationSettings
        ? intakeAskWorkTypeLegacy
        : undefined,
      intakeAskWorkTypeBodyEn: canManageAutomationSettings
        ? intakeAskWorkTypeBodyEn || null
        : undefined,
      intakeAskWorkTypeBodyEs: canManageAutomationSettings
        ? intakeAskWorkTypeBodyEs || null
        : undefined,
      intakeAskCallbackBody: canManageAutomationSettings
        ? intakeAskCallbackLegacy
        : undefined,
      intakeAskCallbackBodyEn: canManageAutomationSettings
        ? intakeAskCallbackBodyEn || null
        : undefined,
      intakeAskCallbackBodyEs: canManageAutomationSettings
        ? intakeAskCallbackBodyEs || null
        : undefined,
      intakeCompletionBody: canManageAutomationSettings
        ? intakeCompletionLegacy
        : undefined,
      intakeCompletionBodyEn: canManageAutomationSettings
        ? intakeCompletionBodyEn || null
        : undefined,
      intakeCompletionBodyEs: canManageAutomationSettings
        ? intakeCompletionBodyEs || null
        : undefined,
      allowWorkerLeadCreate: canManageLeadEntrySetting
        ? allowWorkerLeadCreate
        : undefined,
      ghostBustingEnabled: canManageAutomationSettings
        ? nextGhostBustingEnabled
        : undefined,
      voiceNotesEnabled: canManageAutomationSettings
        ? voiceNotesEnabled
        : undefined,
      metaCapiEnabled: canManageAutomationSettings
        ? metaCapiEnabled
        : undefined,
      offlineModeEnabled: canManageAutomationSettings
        ? offlineModeEnabled
        : undefined,
      ghostBustingQuietHoursStart: canManageAutomationSettings
        ? quietStartMinute!
        : undefined,
      ghostBustingQuietHoursEnd: canManageAutomationSettings
        ? quietEndMinute!
        : undefined,
      ghostBustingMaxNudges: canManageAutomationSettings
        ? ghostBustingMaxNudges
        : undefined,
      ghostBustingTemplateText: canManageAutomationSettings
        ? ghostTemplateText || null
        : undefined,
      smsQuietHoursStartMinute: smsQuietStartMinute,
      smsQuietHoursEndMinute: smsQuietEndMinute,
    },
  });

  if (canManageAutomationSettings) {
    await prisma.organizationMessagingSettings.upsert({
      where: { orgId },
      update: {
        smsTone: smsTone!,
        autoReplyEnabled: nextAutoReplyEnabled,
        followUpsEnabled: nextFollowUpsEnabled,
        autoBookingEnabled: nextAutoBookingEnabled,
        workingHoursStart: workingHoursStart!,
        workingHoursEnd: workingHoursEnd!,
        slotDurationMinutes,
        bufferMinutes,
        daysAhead,
        timezone: ensureTimeZone(messagingTimezone),
        customTemplates: customModeEnabled
          ? (customTemplatesJson as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        aiIntakeProfile:
          smsAgentPlaybookJson as unknown as Prisma.InputJsonValue,
      },
      create: {
        orgId,
        smsTone: smsTone || "FRIENDLY",
        autoReplyEnabled: nextAutoReplyEnabled,
        followUpsEnabled: nextFollowUpsEnabled,
        autoBookingEnabled: nextAutoBookingEnabled,
        workingHoursStart: workingHoursStart || "09:00",
        workingHoursEnd: workingHoursEnd || "17:00",
        slotDurationMinutes,
        bufferMinutes,
        daysAhead,
        timezone: ensureTimeZone(messagingTimezone),
        customTemplates:
          smsTone === "CUSTOM"
            ? (customTemplatesJson as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        aiIntakeProfile:
          smsAgentPlaybookJson as unknown as Prisma.InputJsonValue,
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

  if (actor.id) {
    await prisma.user.update({
      where: { id: actor.id },
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

export default async function ClientSettingsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const locale = await getRequestLocale();
  const isSpanish = locale === "es";
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/settings",
    requestedOrgId,
  });

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
          aiIntakeProfile: true,
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

  const viewer = await requireAppPageViewer({
    nextPath: "/app/settings",
    orgId: scope.orgId,
  });
  const sessionUser = await requireSessionUser("/app/settings");
  const currentUserSettings = sessionUser.id
    ? await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          timezone: true,
        },
      })
    : null;
  const canManageLeadEntrySetting =
    viewer.internalUser ||
    viewer.calendarAccessRole === "OWNER" ||
    viewer.calendarAccessRole === "ADMIN";
  const canManageAutomationSettings = canManageLeadEntrySetting;
  const canManageTeam = canManageLeadEntrySetting;

  if (!organization) {
    redirect(scope.internalUser ? "/hq/businesses" : "/app");
  }

  const [googleConnectedCount, messagingAutomationHealth, rawTeamMembers] =
    await Promise.all([
    prisma.googleAccount.count({
      where: {
        orgId: scope.orgId,
        isEnabled: true,
      },
    }),
    getMessagingAutomationHealthSummary(scope.orgId),
    prisma.organizationMembership.findMany({
      where: {
        organizationId: scope.orgId,
        user: {
          role: "CLIENT",
        },
      },
      select: {
        role: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneE164: true,
            timezone: true,
            mustChangePassword: true,
          },
        },
      },
    }),
  ]);

  const teamMembers = sortWorkspaceTeamMembers(
    rawTeamMembers.map((membership) => ({
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      phoneE164: membership.user.phoneE164,
      timezone: membership.user.timezone,
      role: membership.role,
      status: membership.status,
      createdAt: membership.createdAt,
      mustChangePassword: membership.user.mustChangePassword,
    })),
  );
  const activeOwnerCount = teamMembers.filter(
    (member) => member.status === "ACTIVE" && member.role === "OWNER",
  ).length;

  const twilioReadiness = resolveTwilioMessagingReadiness({
    twilioConfig: organization.twilioConfig,
  });
  const twilioReadinessKey = getTwilioReadinessKey(twilioReadiness.code);
  const twilioAutomationReady = twilioReadiness.canSend;
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
  const effectiveAutoReplyEnabled =
    messagingSettings?.autoReplyEnabled ?? organization.autoReplyEnabled;
  const effectiveFollowUpsEnabled =
    messagingSettings?.followUpsEnabled ?? organization.followUpsEnabled;
  const effectiveAutoBookingEnabled =
    messagingSettings?.autoBookingEnabled ?? organization.autoBookingEnabled;
  const effectiveWorkingHoursStart =
    messagingSettings?.workingHoursStart || "09:00";
  const effectiveWorkingHoursEnd =
    messagingSettings?.workingHoursEnd || "17:00";
  const effectiveSlotDurationMinutes =
    messagingSettings?.slotDurationMinutes ||
    organization.dashboardConfig?.defaultSlotMinutes ||
    60;
  const effectiveBufferMinutes = messagingSettings?.bufferMinutes ?? 15;
  const effectiveDaysAhead = messagingSettings?.daysAhead ?? 3;
  const effectiveMessagingTimezone =
    messagingSettings?.timezone ||
    organization.dashboardConfig?.calendarTimezone ||
    DEFAULT_CALENDAR_TIMEZONE;
  const normalizedCustomTemplates = normalizeCustomTemplates(
    messagingSettings?.customTemplates,
  );
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
  const normalizedSmsAgentPlaybook = normalizeSmsAgentPlaybook(
    messagingSettings?.aiIntakeProfile,
  );
  const initialAgentPlaybook: SmsAgentPlaybookFormValues = {
    primaryGoal: normalizedSmsAgentPlaybook.primaryGoal,
    businessContext: normalizedSmsAgentPlaybook.businessContext,
    servicesSummary: normalizedSmsAgentPlaybook.servicesSummary,
    serviceAreaSummary: normalizedSmsAgentPlaybook.serviceAreaSummary,
    requiredDetails: normalizedSmsAgentPlaybook.requiredDetails,
    handoffTriggers: normalizedSmsAgentPlaybook.handoffTriggers,
    toneNotes: normalizedSmsAgentPlaybook.toneNotes,
    estimatorName: normalizedSmsAgentPlaybook.estimatorName,
    schedulingNotes: normalizedSmsAgentPlaybook.schedulingNotes,
    doNotPromise: normalizedSmsAgentPlaybook.doNotPromise,
    useInboundPhoneAsCallback:
      normalizedSmsAgentPlaybook.useInboundPhoneAsCallback,
  };
  const previewLocale: ResolvedMessageLocale =
    organization.messageLanguage === "ES" ? "ES" : "EN";
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
  const teamSaved = getParam(searchParams?.teamSaved);
  const teamError = getParam(searchParams?.teamError);
  const teamSetupToken = getParam(searchParams?.teamSetupToken);
  const teamSetupEmail = getParam(searchParams?.teamSetupEmail);
  const configuredBaseUrl = getConfiguredBaseUrl();
  const teamSetupUrl =
    teamSetupToken && configuredBaseUrl
      ? `${configuredBaseUrl}/reset-password?token=${encodeURIComponent(teamSetupToken)}`
      : null;
  const canViewCommunicationDiagnostics = canManageLeadEntrySetting;
  const settingsCopy = isSpanish
    ? {
        reviewMessagingSetup: "Revisar mensajeria",
        configureIntakeTemplates: "Configurar plantillas de intake",
        brandingTitle: "Marca e facturas",
        brandingBody: "Logo y datos del negocio para PDFs de facturas.",
        openBranding: "Abrir marca",
        businessLogo: "Logo del negocio",
        openFullBranding: "Abrir marca completa",
        businessLogoBody:
          "Sube aqui el logo de tu empresa para que facturas y PDFs se vean oficiales.",
        objectStorageFallback:
          "El almacenamiento de objetos no esta disponible. Las subidas de logo usaran almacenamiento en linea.",
        templateOverridesBody:
          "Usa estas plantillas a nivel cuenta cuando un negocio necesite texto distinto para llamadas perdidas o intake.",
        missedCallIntroEn: "Introduccion de llamada perdida (ingles)",
        missedCallIntroEs: "Introduccion de llamada perdida (espanol)",
        askAddressEn: "Pedir direccion o ciudad (ingles)",
        askAddressEs: "Pedir direccion o ciudad (espanol)",
        askProjectDetailsEn: "Pedir detalles del proyecto (ingles)",
        askProjectDetailsEs: "Pedir detalles del proyecto (espanol)",
        offerCallbackEn: "Ofrecer horario de llamada o estimado (ingles)",
        offerCallbackEs: "Ofrecer horario de llamada o estimado (espanol)",
        completionEn: "Confirmacion de cierre (ingles)",
        completionEs: "Confirmacion de cierre (espanol)",
        fallbackBody:
          "Deja cualquier campo vacio para usar el pack SMS Voice seleccionado. La logica STOP, la cadencia de seguimiento y el estado de conversacion siguen bloqueados por confiabilidad.",
        stopNotice:
          "La primera respuesta automatica a llamada perdida siempre incluye la linea STOP requerida.",
        invalidSmsTone: "Selecciona una voz SMS valida.",
        invoiceTemplatesTitle: "Plantillas de factura",
        invoiceTemplatesBody:
          "Elige el diseno predeterminado para vistas previas y PDFs imprimibles.",
        openInvoiceTemplates: "Abrir plantillas",
      }
    : {
        reviewMessagingSetup: "Review Messaging Setup",
        configureIntakeTemplates: "Configure Intake Templates",
        brandingTitle: "Branding & Invoices",
        brandingBody: "Logo and business details for invoice PDFs.",
        openBranding: "Open Branding",
        businessLogo: "Business Logo",
        openFullBranding: "Open Full Branding",
        businessLogoBody:
          "Upload your company logo here so invoices and PDF exports look official for your business.",
        objectStorageFallback:
          "Object storage is unavailable. Logo uploads will fall back to inline storage.",
        templateOverridesBody:
          "Use these account-level overrides when a business needs different missed-call or intake copy than the default SMS Voice pack.",
        missedCallIntroEn: "Missed-call intro (English)",
        missedCallIntroEs: "Missed-call intro (Spanish)",
        askAddressEn: "Ask address or city (English)",
        askAddressEs: "Ask address or city (Spanish)",
        askProjectDetailsEn: "Ask project details (English)",
        askProjectDetailsEs: "Ask project details (Spanish)",
        offerCallbackEn: "Offer callback or estimate slot (English)",
        offerCallbackEs: "Offer callback or estimate slot (Spanish)",
        completionEn: "Completion confirmation (English)",
        completionEs: "Completion confirmation (Spanish)",
        fallbackBody:
          "Leave any field blank to fall back to the selected SMS Voice template pack. STOP handling, follow-up cadence, and conversation state logic remain locked for reliability.",
        stopNotice:
          "The first automated missed-call reply always includes the required STOP opt-out line.",
        invalidSmsTone: "Invalid SMS voice selection.",
        invoiceTemplatesTitle: "Invoice Templates",
        invoiceTemplatesBody:
          "Choose the default layout used for invoice previews and printable PDFs.",
        openInvoiceTemplates: "Open Templates",
      };
  const twilioStatusLabel = t(
    `settings.twilioStatus.${twilioReadinessKey}` as never,
  );
  const twilioReadinessBody = t(
    `settings.twilioReadiness.${twilioReadinessKey}` as never,
  );
  const teamSavedMessage = teamSaved
    ? (() => {
        switch (teamSaved) {
          case "memberCreated":
          case "memberCreatedManual":
          case "memberAdded":
          case "memberRoleUpdated":
          case "memberSuspended":
          case "memberReactivated":
            return t(`settings.teamSaved.${teamSaved}` as never);
          default:
            return null;
        }
      })()
    : null;
  const teamErrorMessage = teamError
    ? (() => {
        switch (teamError) {
          case "forbidden":
          case "memberMissing":
          case "memberExists":
          case "emailConflict":
          case "invalidTeamEmail":
          case "invalidTeamRole":
          case "invalidTeamPhone":
          case "invalidTeamTimezone":
          case "invalidTeamStatus":
          case "lastOwner":
          case "inviteLinkUnavailable":
            return t(`settings.teamErrors.${teamError}` as never);
          default:
            return null;
        }
      })()
    : null;

  return (
    <>
      <section className="card">
        <h2>{t("settings.title")}</h2>
        <p className="muted">
          {t("settings.subtitle", { organizationName: organization.name })}
        </p>
        <div className="settings-integrations-grid" style={{ marginTop: 12 }}>
          <article className="settings-integration-card">
            <strong>{t("settings.integrationGoogle")}</strong>
            <p
              className={`settings-integration-status ${googleConfigured ? "connected" : "warning"}`}
            >
              {t(
                googleConfigured
                  ? "settings.statusConnected"
                  : "settings.statusNotConnected",
              )}
            </p>
            <Link
              className="btn secondary"
              href={withOrgQuery(
                "/app/settings/integrations",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {t("buttons.openIntegrations")}
            </Link>
          </article>

          <article className="settings-integration-card">
            <strong>{t("settings.integrationTwilio")}</strong>
            <p
              className={`settings-integration-status ${twilioAutomationReady ? "connected" : "warning"}`}
            >
              {twilioStatusLabel}
            </p>
            <p className="muted">{twilioReadinessBody}</p>
            <a className="btn secondary" href="#settings-messaging">
              {settingsCopy.reviewMessagingSetup}
            </a>
          </article>

          <article className="settings-integration-card">
            <strong>{t("settings.integrationIntake")}</strong>
            <p
              className={`settings-integration-status ${intakeConfigured ? "connected" : "warning"}`}
            >
              {intakeConfigured
                ? t("settings.statusConfigured")
                : t("settings.statusNotConnected")}
            </p>
            <a className="btn secondary" href="#settings-templates">
              {settingsCopy.configureIntakeTemplates}
            </a>
          </article>

          <article className="settings-integration-card">
            <strong>{settingsCopy.brandingTitle}</strong>
            <p className="settings-integration-status">
              {settingsCopy.brandingBody}
            </p>
            <Link
              className="btn secondary"
              href={withOrgQuery(
                "/app/settings/branding",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {settingsCopy.openBranding}
            </Link>
          </article>

          <article className="settings-integration-card">
            <strong>{settingsCopy.invoiceTemplatesTitle}</strong>
            <p className="settings-integration-status">
              {settingsCopy.invoiceTemplatesBody}
            </p>
            <Link
              className="btn secondary"
              href={withOrgQuery(
                "/app/settings/invoice",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {settingsCopy.openInvoiceTemplates}
            </Link>
          </article>
        </div>

        <article
          className="settings-integration-card"
          style={{ marginTop: 12 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <strong>{settingsCopy.businessLogo}</strong>
            <Link
              className="btn secondary"
              href={withOrgQuery(
                "/app/settings/branding",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {settingsCopy.openFullBranding}
            </Link>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {settingsCopy.businessLogoBody}
          </p>
          {!logoUploadsReady ? (
            <p className="form-status">{settingsCopy.objectStorageFallback}</p>
          ) : null}
          <OrgLogoUploader orgId={organization.id} />
        </article>

        <form
          action={updateSettingsAction}
          className="auth-form"
          style={{ marginTop: 12 }}
        >
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
                    defaultValue={
                      organization.dashboardConfig?.calendarTimezone ||
                      DEFAULT_CALENDAR_TIMEZONE
                    }
                    placeholder={t("settings.timezonePlaceholder")}
                  />
                </label>

                <label>
                  {t("settings.yourTimezoneLabel")}
                  <input
                    name="userTimezone"
                    defaultValue={currentUserSettings?.timezone || ""}
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
                    defaultValue={
                      organization.dashboardConfig?.jobReminderMinutesBefore ||
                      120
                    }
                  />
                  <span className="muted">
                    {t("settings.reminderTimingNote")}
                  </span>
                </label>

                <label>
                  {t("settings.googleReviewLinkLabel")}
                  <input
                    type="url"
                    name="googleReviewUrl"
                    defaultValue={
                      organization.dashboardConfig?.googleReviewUrl || ""
                    }
                    placeholder={t("settings.googleReviewPlaceholder")}
                  />
                </label>
              </div>
            </details>

            <details id="settings-messaging" open>
              <summary>{t("settings.sectionMessaging")}</summary>
              <div className="settings-accordion-body">
                <article className="settings-integration-card">
                  <strong>{t("settings.twilioReadinessTitle")}</strong>
                  <p
                    className={`settings-integration-status ${twilioAutomationReady ? "connected" : "warning"}`}
                  >
                    {twilioStatusLabel}
                  </p>
                  <p className="muted">{twilioReadinessBody}</p>
                  {!twilioAutomationReady ? (
                    <p className="muted">
                      {t("settings.twilioAutomationLocked")}
                    </p>
                  ) : null}
                </article>

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
                  <select
                    name="messageLanguage"
                    defaultValue={organization.messageLanguage.toLowerCase()}
                  >
                    <option value="en">
                      {t("settings.messageLanguage.en")}
                    </option>
                    <option value="es">
                      {t("settings.messageLanguage.es")}
                    </option>
                    <option value="auto">
                      {t("settings.messageLanguage.auto")}
                    </option>
                  </select>
                </label>

                <SmsVoiceSection
                  businessName={organization.name}
                  locale={previewLocale}
                  canManage={canManageAutomationSettings}
                  canManageAutomationControls={
                    canManageAutomationSettings && twilioAutomationReady
                  }
                  automationLockedNotice={
                    canManageAutomationSettings && !twilioAutomationReady
                      ? t("settings.twilioAutomationLocked")
                      : null
                  }
                  initialTone={effectiveTone}
                  initialAutoReplyEnabled={effectiveAutoReplyEnabled}
                  initialFollowUpsEnabled={effectiveFollowUpsEnabled}
                  initialAutoBookingEnabled={effectiveAutoBookingEnabled}
                  initialGreetingLine={organization.smsGreetingLine || ""}
                  initialWorkingHoursText={
                    organization.smsWorkingHoursText || ""
                  }
                  initialWebsiteSignature={
                    organization.smsWebsiteSignature || ""
                  }
                  initialWorkingHoursStart={effectiveWorkingHoursStart}
                  initialWorkingHoursEnd={effectiveWorkingHoursEnd}
                  initialSlotDurationMinutes={effectiveSlotDurationMinutes}
                  initialBufferMinutes={effectiveBufferMinutes}
                  initialDaysAhead={effectiveDaysAhead}
                  initialTimeZone={ensureTimeZone(effectiveMessagingTimezone)}
                  initialAgentPlaybook={initialAgentPlaybook}
                  initialCustomTemplates={initialCustomTemplates}
                  previewSlots={previewSlots}
                />

                <label>
                  {t("settings.smsQuietStartLabel")}
                  <input
                    type="time"
                    name="smsQuietHoursStartMinute"
                    defaultValue={minuteToTimeInput(
                      organization.smsQuietHoursStartMinute,
                    )}
                  />
                </label>
                <label>
                  {t("settings.smsQuietEndLabel")}
                  <input
                    type="time"
                    name="smsQuietHoursEndMinute"
                    defaultValue={minuteToTimeInput(
                      organization.smsQuietHoursEndMinute,
                    )}
                  />
                </label>
                <p className="muted settings-toggle-help">
                  {t("settings.helperSmsQuietHours")}
                </p>

                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    name="missedCallAutoReplyOn"
                    defaultChecked={organization.missedCallAutoReplyOn}
                    disabled={
                      !canManageAutomationSettings || !twilioAutomationReady
                    }
                  />
                  {t("settings.missedCallToggle")}
                </label>
                <p className="muted settings-toggle-help">
                  {t("settings.helperMissedCallToggle")}
                </p>

                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    name="ghostBustingEnabled"
                    defaultChecked={organization.ghostBustingEnabled}
                    disabled={
                      !canManageAutomationSettings || !twilioAutomationReady
                    }
                  />
                  {t("settings.ghostBustingToggle")}
                </label>
                <p className="muted settings-toggle-help">
                  {t("settings.helperGhostBusting")}
                </p>

                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    name="voiceNotesEnabled"
                    defaultChecked={organization.voiceNotesEnabled}
                    disabled={!canManageAutomationSettings}
                  />
                  {t("settings.voiceNotesToggle")}
                </label>
                <p className="muted settings-toggle-help">
                  {t("settings.helperVoiceNotes")}
                </p>

                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    name="metaCapiEnabled"
                    defaultChecked={organization.metaCapiEnabled}
                    disabled={!canManageAutomationSettings}
                  />
                  {t("settings.metaCapiToggle")}
                </label>
                <p className="muted settings-toggle-help">
                  {t("settings.helperMetaCapi")}
                </p>

                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    name="offlineModeEnabled"
                    defaultChecked={organization.offlineModeEnabled}
                    disabled={!canManageAutomationSettings}
                  />
                  {t("settings.offlineModeToggle")}
                </label>
                <p className="muted settings-toggle-help">
                  {t("settings.helperOfflineMode")}
                </p>

                <label>
                  {t("settings.ghostQuietStartLabel")}
                  <input
                    type="time"
                    name="ghostBustingQuietHoursStart"
                    defaultValue={minuteToTimeInput(
                      organization.ghostBustingQuietHoursStart,
                    )}
                    disabled={!canManageAutomationSettings}
                  />
                </label>
                <label>
                  {t("settings.ghostQuietEndLabel")}
                  <input
                    type="time"
                    name="ghostBustingQuietHoursEnd"
                    defaultValue={minuteToTimeInput(
                      organization.ghostBustingQuietHoursEnd,
                    )}
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
                    defaultValue={
                      organization.ghostBustingTemplateText ||
                      t("settings.ghostTemplateDefault")
                    }
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
                <p className="muted">{settingsCopy.templateOverridesBody}</p>
                <div className="sms-voice-grid-two">
                  <label>
                    {settingsCopy.missedCallIntroEn}
                    <textarea
                      name="missedCallAutoReplyBodyEn"
                      rows={4}
                      maxLength={1600}
                      defaultValue={
                        organization.missedCallAutoReplyBodyEn ||
                        organization.missedCallAutoReplyBody ||
                        ""
                      }
                      disabled={!canManageAutomationSettings}
                      placeholder="Hey, this is [Business Name]. Sorry we missed your call..."
                    />
                  </label>
                  <label>
                    {settingsCopy.missedCallIntroEs}
                    <textarea
                      name="missedCallAutoReplyBodyEs"
                      rows={4}
                      maxLength={1600}
                      defaultValue={
                        organization.missedCallAutoReplyBodyEs || ""
                      }
                      disabled={!canManageAutomationSettings}
                      placeholder="Hola, habla [Business Name]. Perdón que perdimos tu llamada..."
                    />
                  </label>
                  <label>
                    {settingsCopy.askAddressEn}
                    <textarea
                      name="intakeAskLocationBodyEn"
                      rows={3}
                      maxLength={1600}
                      defaultValue={
                        organization.intakeAskLocationBodyEn ||
                        organization.intakeAskLocationBody ||
                        ""
                      }
                      disabled={!canManageAutomationSettings}
                      placeholder="What is the address or city for the project?"
                    />
                  </label>
                  <label>
                    {settingsCopy.askAddressEs}
                    <textarea
                      name="intakeAskLocationBodyEs"
                      rows={3}
                      maxLength={1600}
                      defaultValue={organization.intakeAskLocationBodyEs || ""}
                      disabled={!canManageAutomationSettings}
                      placeholder="¿Cuál es la dirección o ciudad del proyecto?"
                    />
                  </label>
                  <label>
                    {settingsCopy.askProjectDetailsEn}
                    <textarea
                      name="intakeAskWorkTypeBodyEn"
                      rows={3}
                      maxLength={1600}
                      defaultValue={
                        organization.intakeAskWorkTypeBodyEn ||
                        organization.intakeAskWorkTypeBody ||
                        ""
                      }
                      disabled={!canManageAutomationSettings}
                      placeholder="What kind of project do you need help with?"
                    />
                  </label>
                  <label>
                    {settingsCopy.askProjectDetailsEs}
                    <textarea
                      name="intakeAskWorkTypeBodyEs"
                      rows={3}
                      maxLength={1600}
                      defaultValue={organization.intakeAskWorkTypeBodyEs || ""}
                      disabled={!canManageAutomationSettings}
                      placeholder="¿Qué tipo de proyecto necesitas?"
                    />
                  </label>
                  <label>
                    {settingsCopy.offerCallbackEn}
                    <textarea
                      name="intakeAskCallbackBodyEn"
                      rows={3}
                      maxLength={1600}
                      defaultValue={
                        organization.intakeAskCallbackBodyEn ||
                        organization.intakeAskCallbackBody ||
                        ""
                      }
                      disabled={!canManageAutomationSettings}
                      placeholder="Pick one of these callback times:"
                    />
                  </label>
                  <label>
                    {settingsCopy.offerCallbackEs}
                    <textarea
                      name="intakeAskCallbackBodyEs"
                      rows={3}
                      maxLength={1600}
                      defaultValue={organization.intakeAskCallbackBodyEs || ""}
                      disabled={!canManageAutomationSettings}
                      placeholder="Elige uno de estos horarios de llamada:"
                    />
                  </label>
                  <label>
                    {settingsCopy.completionEn}
                    <textarea
                      name="intakeCompletionBodyEn"
                      rows={3}
                      maxLength={1600}
                      defaultValue={
                        organization.intakeCompletionBodyEn ||
                        organization.intakeCompletionBody ||
                        ""
                      }
                      disabled={!canManageAutomationSettings}
                      placeholder="Perfect, you're set for {{time}}. We'll follow up then."
                    />
                  </label>
                  <label>
                    {settingsCopy.completionEs}
                    <textarea
                      name="intakeCompletionBodyEs"
                      rows={3}
                      maxLength={1600}
                      defaultValue={organization.intakeCompletionBodyEs || ""}
                      disabled={!canManageAutomationSettings}
                      placeholder="Perfecto, quedas agendado para {{time}}."
                    />
                  </label>
                </div>
                <p className="muted">
                  {settingsCopy.fallbackBody} {settingsCopy.stopNotice}
                </p>
                {!canManageAutomationSettings ? (
                  <p className="muted">{t("settings.automationFlagsNote")}</p>
                ) : null}
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
                <p className="muted settings-toggle-help">
                  {t("settings.helperWorkerLeadCreate")}
                </p>
                {!canManageLeadEntrySetting ? (
                  <p className="muted">
                    {t("settings.allowWorkerLeadCreateNote")}
                  </p>
                ) : null}
              </div>
            </details>
          </div>

          <button
            className="btn primary"
            type="submit"
            aria-label="Save settings"
          >
            {t("buttons.saveSettings")}
          </button>

          {saved ? <p className="form-status">{t("settings.saved")}</p> : null}
          {error === "missing-org" ? (
            <p className="form-status">{t("settings.errors.missingOrg")}</p>
          ) : null}
          {error === "invalid-sender" ? (
            <p className="form-status">{t("settings.errors.invalidSender")}</p>
          ) : null}
          {error === "invalid-message-language" ? (
            <p className="form-status">
              {t("settings.errors.invalidMessageLanguage")}
            </p>
          ) : null}
          {error === "invalid-sms-tone" ? (
            <p className="form-status">{settingsCopy.invalidSmsTone}</p>
          ) : null}
          {error === "invalid-message" ? (
            <p className="form-status">{t("settings.errors.invalidMessage")}</p>
          ) : null}
          {error === "invalid-reminder" ? (
            <p className="form-status">
              {t("settings.errors.invalidReminder")}
            </p>
          ) : null}
          {error === "invalid-review-url" ? (
            <p className="form-status">
              {t("settings.errors.invalidReviewUrl")}
            </p>
          ) : null}
          {error === "invalid-calendar-timezone" ? (
            <p className="form-status">
              {t("settings.errors.invalidCalendarTimezone")}
            </p>
          ) : null}
          {error === "invalid-user-timezone" ? (
            <p className="form-status">
              {t("settings.errors.invalidUserTimezone")}
            </p>
          ) : null}
          {error === "invalid-business-name" ? (
            <p className="form-status">
              {t("settings.errors.invalidBusinessName")}
            </p>
          ) : null}
          {error === "invalid-ghost-hours" ? (
            <p className="form-status">
              {t("settings.errors.invalidGhostHours")}
            </p>
          ) : null}
          {error === "invalid-ghost-max" ? (
            <p className="form-status">
              {t("settings.errors.invalidGhostMax")}
            </p>
          ) : null}
          {error === "invalid-ghost-template" ? (
            <p className="form-status">
              {t("settings.errors.invalidGhostTemplate")}
            </p>
          ) : null}
          {error === "invalid-sms-quiet-hours" ? (
            <p className="form-status">
              {t("settings.errors.invalidSmsQuietHours")}
            </p>
          ) : null}
        </form>
      </section>

      <section className="card" id="settings-team-management">
        <h2>{t("settings.teamManagementTitle")}</h2>
        <p className="muted">{t("settings.teamManagementBody")}</p>

        {teamSavedMessage ? <p className="form-status">{teamSavedMessage}</p> : null}
        {teamErrorMessage ? <p className="form-status">{teamErrorMessage}</p> : null}
        {teamSetupUrl ? (
          <article
            className="settings-integration-card"
            style={{ marginTop: 12 }}
          >
            <strong>{t("settings.teamManualInviteTitle")}</strong>
            <p className="muted">
              {t("settings.teamManualInviteBody", {
                email: teamSetupEmail || t("settings.teamPendingSetup"),
              })}
            </p>
            <label>
              {t("settings.teamSetupLinkLabel")}
              <input readOnly value={teamSetupUrl} />
            </label>
          </article>
        ) : null}

        {!canManageTeam ? (
          <p className="muted" style={{ marginTop: 12 }}>
            {t("settings.teamReadOnlyNote")}
          </p>
        ) : (
          <article
            className="settings-integration-card"
            style={{ marginTop: 12 }}
          >
            <strong>{t("settings.teamCreateTitle")}</strong>
            <p className="muted" style={{ marginTop: 8 }}>
              {t("settings.teamCreateBody")}
            </p>
            <form
              action={createTeamMemberAction}
              className="auth-form"
              style={{ marginTop: 12 }}
            >
              <input type="hidden" name="orgId" value={organization.id} />
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                }}
              >
                <label>
                  {t("settings.teamNameLabel")}
                  <input name="name" maxLength={120} />
                </label>
                <label>
                  {t("settings.teamEmailLabel")}
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  {t("settings.teamPhoneLabel")}
                  <input
                    name="phoneE164"
                    placeholder={t("settings.outboundNumberPlaceholder")}
                  />
                </label>
                <label>
                  {t("settings.teamTimezoneLabel")}
                  <input
                    name="timezone"
                    placeholder={t("settings.timezonePlaceholder")}
                  />
                </label>
                <label>
                  {t("settings.teamRoleLabel")}
                  <select name="role" defaultValue="WORKER">
                    {TEAM_CALENDAR_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {t(
                          `settings.teamRole.${getTeamRoleTranslationKey(role)}` as never,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="btn primary"
                type="submit"
                style={{ marginTop: 12 }}
              >
                {t("settings.teamAddMember")}
              </button>
            </form>
          </article>
        )}

        <article
          className="settings-integration-card"
          style={{ marginTop: 12 }}
        >
          <strong>{t("settings.teamMembersTitle")}</strong>
          {teamMembers.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              {t("settings.teamMembersEmpty")}
            </p>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {teamMembers.map((member) => {
                const protectedLastOwner =
                  member.status === "ACTIVE" &&
                  member.role === "OWNER" &&
                  activeOwnerCount <= 1;

                return (
                  <article
                    key={member.userId}
                    style={{
                      border: "1px solid var(--line, #d6d6d6)",
                      borderRadius: 14,
                      padding: 16,
                      display: "grid",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong>{member.name || member.email}</strong>
                        {member.name ? (
                          <div className="muted" style={{ marginTop: 4 }}>
                            {member.email}
                          </div>
                        ) : null}
                        <div className="muted" style={{ marginTop: 4 }}>
                          {member.phoneE164 || t("settings.teamNoPhone")}
                          {" • "}
                          {member.timezone || t("settings.teamNoTimezone")}
                        </div>
                        {member.mustChangePassword ? (
                          <div className="muted" style={{ marginTop: 6 }}>
                            <strong>{t("settings.teamPendingSetup")}</strong>
                            {" · "}
                            {t("settings.teamPendingSetupNote")}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          className={`settings-integration-status ${member.status === "ACTIVE" ? "connected" : "warning"}`}
                        >
                          {t(
                            `settings.teamStatus.${getTeamStatusTranslationKey(member.status)}` as never,
                          )}
                        </div>
                        <div className="muted" style={{ marginTop: 4 }}>
                          {t(
                            `settings.teamRole.${getTeamRoleTranslationKey(member.role)}` as never,
                          )}
                        </div>
                      </div>
                    </div>

                    {protectedLastOwner ? (
                      <p className="muted">{t("settings.teamLastOwnerNote")}</p>
                    ) : null}

                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        alignItems: "end",
                      }}
                    >
                      <form
                        action={updateTeamMemberRoleAction}
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "end",
                        }}
                      >
                        <input type="hidden" name="orgId" value={organization.id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <label style={{ minWidth: 180 }}>
                          {t("settings.teamRoleLabel")}
                          <select
                            name="role"
                            defaultValue={member.role}
                            disabled={!canManageTeam || protectedLastOwner}
                          >
                            {TEAM_CALENDAR_ROLE_OPTIONS.map((role) => (
                              <option key={role} value={role}>
                                {t(
                                  `settings.teamRole.${getTeamRoleTranslationKey(role)}` as never,
                                )}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="btn secondary"
                          type="submit"
                          disabled={!canManageTeam || protectedLastOwner}
                        >
                          {t("settings.teamSaveRole")}
                        </button>
                      </form>

                      <form action={updateTeamMemberStatusAction}>
                        <input type="hidden" name="orgId" value={organization.id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <input
                          type="hidden"
                          name="status"
                          value={member.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"}
                        />
                        <button
                          className="btn secondary"
                          type="submit"
                          disabled={!canManageTeam || protectedLastOwner}
                        >
                          {member.status === "SUSPENDED"
                            ? t("settings.teamReactivate")
                            : t("settings.teamSuspend")}
                        </button>
                      </form>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>
      </section>

      <MessagingAutomationHealthCard
        summary={messagingAutomationHealth}
        locale={locale}
        internalUser={scope.internalUser}
        orgId={organization.id}
      />

      {canViewCommunicationDiagnostics ? (
        <CommunicationDiagnosticsCard
          orgId={organization.id}
          internalUser={scope.internalUser}
        />
      ) : null}
    </>
  );
}
