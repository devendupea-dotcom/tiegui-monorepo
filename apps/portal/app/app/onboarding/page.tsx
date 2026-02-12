import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { sendOutboundSms } from "@/lib/sms";
import { canAccessOrg, isInternalRole, requireSessionUser } from "@/lib/session";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { ensureTimeZone, isValidTimeZone, toUtcFromLocalDateTime } from "@/lib/calendar/dates";
import { getPhotoStorageReadiness } from "@/lib/storage";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";
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

function onboardingUrl(orgId: string, internalUser: boolean, step: OnboardingStep | "finish", query?: Record<string, string>) {
  const base = withOrgQuery(`/app/onboarding?step=${step === 5 ? "finish" : step}`, orgId, internalUser);
  if (!query || Object.keys(query).length === 0) {
    return base;
  }
  const extra = new URLSearchParams(query).toString();
  return `${base}&${extra}`;
}

async function requireOnboardingEditor(orgId: string) {
  const user = await requireSessionUser("/app/onboarding");
  if (!canAccessOrg(user, orgId)) {
    redirect("/app");
  }

  const dbUser = user.id
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          role: true,
          orgId: true,
          calendarAccessRole: true,
        },
      })
    : null;

  if (!dbUser) {
    redirect("/app");
  }

  const internalUser = isInternalRole(dbUser.role);
  const canEdit = internalUser || dbUser.calendarAccessRole === "OWNER" || dbUser.calendarAccessRole === "ADMIN";
  if (!canEdit) {
    redirect("/app");
  }

  return {
    id: dbUser.id,
    internalUser,
    orgId: internalUser ? orgId : dbUser.orgId || orgId,
    calendarAccessRole: dbUser.calendarAccessRole,
  };
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
  const workers = await prisma.user.findMany({
    where: {
      orgId,
      role: "CLIENT",
      calendarAccessRole: { not: "READ_ONLY" },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }],
  });

  const workingHoursWrites = workers.flatMap((worker) =>
    Array.from({ length: 7 }, (_, dayOfWeek) =>
      prisma.workingHours.upsert({
        where: {
          orgId_workerUserId_dayOfWeek: {
            orgId,
            workerUserId: worker.id,
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
          workerUserId: worker.id,
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

    await prisma.user.updateMany({
      where: {
        id: workerId,
        orgId,
        role: "CLIENT",
      },
      data: {
        calendarAccessRole: nextRole,
        timezone,
        phoneE164: phoneNormalized,
      },
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
      select: { id: true, orgId: true },
    });

    if (existing && existing.orgId !== orgId) {
      redirect(onboardingUrl(orgId, actor.internalUser, 2, { error: "email" }));
    }

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: name || undefined,
          calendarAccessRole: role,
          timezone,
          phoneE164,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          orgId,
          role: "CLIENT",
          calendarAccessRole: role,
          name: name || "Worker",
          email,
          phoneE164,
          timezone,
        },
      });
    }
  }

  const workerCount = await prisma.user.count({
    where: {
      orgId,
      role: "CLIENT",
      calendarAccessRole: { in: ["OWNER", "WORKER", "ADMIN"] },
    },
  });

  if (workerCount === 0) {
    await prisma.user.update({
      where: { id: actor.id },
      data: { calendarAccessRole: "OWNER" },
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
  const workers = await prisma.user.findMany({
    where: {
      orgId,
      role: "CLIENT",
      calendarAccessRole: { not: "READ_ONLY" },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }],
  });
  const roundRobinLastWorkerId = roundRobinEnabled ? workers[0]?.id || null : null;

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
      missedCallAutoReplyOn: enableTexting,
      onboardingStep: 4,
      onboardingSkippedAt: null,
    },
  });

  if (intent === "test") {
    const toNumber = normalizeE164(testPhoneRaw);
    const fromNumber = sender || normalizeE164(process.env.DEFAULT_OUTBOUND_FROM_E164 || null);
    if (!toNumber || !fromNumber) {
      redirect(onboardingUrl(orgId, actor.internalUser, 4, { error: "test-number" }));
    }

    const result = await sendOutboundSms({
      fromNumberE164: fromNumber,
      toNumberE164: toNumber,
      body: "TieGui onboarding test: this confirms SMS routing is configured.",
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

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      smsFromNumberE164: sender,
      missedCallAutoReplyOn: enableTexting,
      onboardingStep: 4,
      onboardingCompletedAt: new Date(),
      onboardingSkippedAt: null,
    },
  });

  revalidatePath("/app");
  revalidatePath("/app/onboarding");
  revalidatePath(`/hq/businesses/${orgId}`);

  redirect(onboardingUrl(orgId, actor.internalUser, "finish"));
}

async function skipOnboardingAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app");
  }
  const actor = await requireOnboardingEditor(orgId);

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      onboardingSkippedAt: new Date(),
    },
  });

  revalidatePath("/app");
  revalidatePath("/app/onboarding");

  const fallback = withOrgQuery("/app", orgId, actor.internalUser);
  redirect(fallback);
}

export default async function AppOnboardingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/onboarding", requestedOrgId });
  const user = await requireSessionUser("/app/onboarding");
  const dbUser = user.id
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          role: true,
          calendarAccessRole: true,
          orgId: true,
        },
      })
    : null;

  const canEdit = dbUser
    ? isInternalRole(dbUser.role) || dbUser.calendarAccessRole === "OWNER" || dbUser.calendarAccessRole === "ADMIN"
    : false;
  if (!canEdit) {
    redirect(withOrgQuery("/app", scope.orgId, scope.internalUser));
  }

  const step = clampStep(getParam(searchParams?.step) || "1");
  const activeStep: VisibleOnboardingStep = step === 5 ? 4 : step;
  const progressPercent = Math.round((activeStep / ONBOARDING_STEPS.length) * 100);
  const error = getParam(searchParams?.error);
  const saved = getParam(searchParams?.saved);
  const smsTest = getParam(searchParams?.smsTest);

  const [organization, settings, workers, workingDayRows] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: {
        id: true,
        name: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingSkippedAt: true,
        smsFromNumberE164: true,
        dashboardConfig: {
          select: {
            roundRobinLastWorkerId: true,
          },
        },
      },
    }),
    getOrgCalendarSettings(scope.orgId),
    prisma.user.findMany({
      where: {
        orgId: scope.orgId,
        role: "CLIENT",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phoneE164: true,
        calendarAccessRole: true,
        timezone: true,
      },
      orderBy: [{ createdAt: "asc" }],
      take: 50,
    }),
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
        {ONBOARDING_STEPS.map((item) => (
          <span
            key={item.value}
            className={`tab-chip onboarding-step-chip ${activeStep === item.value ? "active" : ""} ${activeStep > item.value ? "done" : ""}`}
          >
            <span className="onboarding-step-number">{item.value}.</span> {item.label}
          </span>
        ))}
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

          <h3>Messaging + Integrations</h3>
          <label className="inline-toggle">
            <input type="checkbox" name="enableTexting" defaultChecked={Boolean(organization.smsFromNumberE164)} />
            Enable texting
          </label>

          <label>
            Sending number (E.164)
            <input name="smsFromNumberE164" defaultValue={organization.smsFromNumberE164 || ""} placeholder="+12065550100" />
          </label>

          <label>
            Send test SMS to
            <input name="testPhoneE164" placeholder="+12065550199" />
          </label>

          <div className="quick-links">
            <button type="submit" name="intent" value="save" className="btn secondary">
              Save messaging
            </button>
            <button type="submit" name="intent" value="test" className="btn secondary">
              Send test SMS
            </button>
            <Link className="btn secondary" href={withOrgQuery("/api/integrations/google/connect?write=1", scope.orgId, scope.internalUser)}>
              Connect Google
            </Link>
            <Link className="btn secondary" href={withOrgQuery("/app/settings/integrations", scope.orgId, scope.internalUser)}>
              Sync now
            </Link>
          </div>

          {!twilioReady ? (
            <p className="muted">Twilio credentials are not configured yet. Core scheduling can still go live.</p>
          ) : null}
          {saved === "1" ? <p className="form-status">Messaging settings saved.</p> : null}
          {error === "sender" ? <p className="form-status">Enter a valid sender number.</p> : null}
          {error === "test-number" ? (
            <p className="form-status">Enter valid sender + test number to send test SMS.</p>
          ) : null}
          {smsTest ? (
            <p className="form-status">
              Test result: {decodeURIComponent(smsTest)}
            </p>
          ) : null}

          <div className="onboarding-sticky-actions">
            <Link className="btn secondary" href={onboardingUrl(scope.orgId, scope.internalUser, 3)}>
              Back
            </Link>
            <button formAction={completeOnboardingAction} className="btn primary" type="submit">
              Save &amp; Continue
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

      {step !== 5 ? (
        <form action={skipOnboardingAction} className="onboarding-skip-row" style={{ marginTop: 16 }}>
          <input type="hidden" name="orgId" value={scope.orgId} />
          <button type="submit" className="btn secondary">
            Skip for now
          </button>
        </form>
      ) : null}
    </section>
  );
}
