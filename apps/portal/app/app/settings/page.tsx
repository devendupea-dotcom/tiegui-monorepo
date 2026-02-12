import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CALENDAR_TIMEZONE, ensureTimeZone, isValidTimeZone } from "@/lib/calendar/dates";
import { getRequestTranslator } from "@/lib/i18n";
import { normalizeE164 } from "@/lib/phone";
import { isInternalRole, requireSessionUser } from "@/lib/session";
import { getParam, requireAppOrgAccess, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

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

async function updateSettingsAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings", orgId);

  const senderRaw = String(formData.get("smsFromNumberE164") || "").trim();
  const messageLanguageRaw = String(formData.get("messageLanguage") || "").trim();
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
  if (senderRaw && !sender) {
    redirect(withOrgQuery("/app/settings?error=invalid-sender", orgId, internalUser));
  }

  if (!messageLanguage) {
    redirect(withOrgQuery("/app/settings?error=invalid-message-language", orgId, internalUser));
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
  let ghostBustingMaxNudges = 2;
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
      messageLanguage,
      missedCallAutoReplyOn,
      missedCallAutoReplyBody: missedCallMessageEn || missedCallMessageEs || null,
      missedCallAutoReplyBodyEn: missedCallMessageEn || null,
      missedCallAutoReplyBodyEs: missedCallMessageEs || null,
      intakeAskLocationBody: intakeAskLocationBodyEn || intakeAskLocationBodyEs || null,
      intakeAskLocationBodyEn: intakeAskLocationBodyEn || null,
      intakeAskLocationBodyEs: intakeAskLocationBodyEs || null,
      intakeAskWorkTypeBody: intakeAskWorkTypeBodyEn || intakeAskWorkTypeBodyEs || null,
      intakeAskWorkTypeBodyEn: intakeAskWorkTypeBodyEn || null,
      intakeAskWorkTypeBodyEs: intakeAskWorkTypeBodyEs || null,
      intakeAskCallbackBody: intakeAskCallbackBodyEn || intakeAskCallbackBodyEs || null,
      intakeAskCallbackBodyEn: intakeAskCallbackBodyEn || null,
      intakeAskCallbackBodyEs: intakeAskCallbackBodyEs || null,
      intakeCompletionBody: intakeCompletionBodyEn || intakeCompletionBodyEs || null,
      intakeCompletionBodyEn: intakeCompletionBodyEn || null,
      intakeCompletionBodyEs: intakeCompletionBodyEs || null,
      allowWorkerLeadCreate: canManageLeadEntrySetting ? allowWorkerLeadCreate : undefined,
      ghostBustingEnabled: canManageAutomationSettings ? ghostBustingEnabled : undefined,
      voiceNotesEnabled: canManageAutomationSettings ? voiceNotesEnabled : undefined,
      metaCapiEnabled: canManageAutomationSettings ? metaCapiEnabled : undefined,
      offlineModeEnabled: canManageAutomationSettings ? offlineModeEnabled : undefined,
      ghostBustingQuietHoursStart: canManageAutomationSettings ? quietStartMinute! : undefined,
      ghostBustingQuietHoursEnd: canManageAutomationSettings ? quietEndMinute! : undefined,
      ghostBustingMaxNudges: canManageAutomationSettings ? ghostBustingMaxNudges : undefined,
      ghostBustingTemplateText: canManageAutomationSettings ? (ghostTemplateText || null) : undefined,
    },
  });

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
      messageLanguage: true,
      missedCallAutoReplyOn: true,
      missedCallAutoReplyBody: true,
      missedCallAutoReplyBodyEn: true,
      missedCallAutoReplyBodyEs: true,
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
      dashboardConfig: {
        select: {
          jobReminderMinutesBefore: true,
          googleReviewUrl: true,
          calendarTimezone: true,
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

  const saved = getParam(searchParams?.saved) === "1";
  const error = getParam(searchParams?.error);

  return (
    <section className="card">
      <h2>{t("settings.title")}</h2>
      <p className="muted">{t("settings.subtitle", { organizationName: organization.name })}</p>
      <div className="quick-links" style={{ marginTop: 12 }}>
        <Link
          className="btn secondary"
          href={withOrgQuery("/app/settings/integrations", scope.orgId, scope.internalUser)}
        >
          {t("buttons.openIntegrations")}
        </Link>
      </div>

      <form action={updateSettingsAction} className="auth-form" style={{ marginTop: 12 }}>
        <input type="hidden" name="orgId" value={organization.id} />

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

        <label className="inline-toggle">
          <input
            type="checkbox"
            name="missedCallAutoReplyOn"
            defaultChecked={organization.missedCallAutoReplyOn}
          />
          {t("settings.missedCallToggle")}
        </label>

        <label>
          {t("settings.missedCallMessageEnLabel")}
          <textarea
            name="missedCallAutoReplyBodyEn"
            rows={4}
            maxLength={1600}
            defaultValue={organization.missedCallAutoReplyBodyEn || organization.missedCallAutoReplyBody || ""}
            placeholder={t("settings.missedCallPlaceholderEn")}
          />
        </label>

        <label>
          {t("settings.missedCallMessageEsLabel")}
          <textarea
            name="missedCallAutoReplyBodyEs"
            rows={4}
            maxLength={1600}
            defaultValue={organization.missedCallAutoReplyBodyEs || ""}
            placeholder={t("settings.missedCallPlaceholderEs")}
          />
        </label>

        <h3 style={{ marginTop: 10 }}>{t("settings.templatesHeading")}</h3>

        <label>
          {t("settings.intakeAskLocationEnLabel")}
          <textarea
            name="intakeAskLocationBodyEn"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeAskLocationBodyEn || organization.intakeAskLocationBody || ""}
            placeholder={t("settings.intakeAskLocationPlaceholderEn")}
          />
        </label>

        <label>
          {t("settings.intakeAskLocationEsLabel")}
          <textarea
            name="intakeAskLocationBodyEs"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeAskLocationBodyEs || ""}
            placeholder={t("settings.intakeAskLocationPlaceholderEs")}
          />
        </label>

        <label>
          {t("settings.intakeAskWorkTypeEnLabel")}
          <textarea
            name="intakeAskWorkTypeBodyEn"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeAskWorkTypeBodyEn || organization.intakeAskWorkTypeBody || ""}
            placeholder={t("settings.intakeAskWorkTypePlaceholderEn")}
          />
        </label>

        <label>
          {t("settings.intakeAskWorkTypeEsLabel")}
          <textarea
            name="intakeAskWorkTypeBodyEs"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeAskWorkTypeBodyEs || ""}
            placeholder={t("settings.intakeAskWorkTypePlaceholderEs")}
          />
        </label>

        <label>
          {t("settings.intakeAskCallbackEnLabel")}
          <textarea
            name="intakeAskCallbackBodyEn"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeAskCallbackBodyEn || organization.intakeAskCallbackBody || ""}
            placeholder={t("settings.intakeAskCallbackPlaceholderEn")}
          />
        </label>

        <label>
          {t("settings.intakeAskCallbackEsLabel")}
          <textarea
            name="intakeAskCallbackBodyEs"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeAskCallbackBodyEs || ""}
            placeholder={t("settings.intakeAskCallbackPlaceholderEs")}
          />
        </label>

        <label>
          {t("settings.intakeCompletionEnLabel")}
          <textarea
            name="intakeCompletionBodyEn"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeCompletionBodyEn || organization.intakeCompletionBody || ""}
            placeholder={t("settings.intakeCompletionPlaceholderEn")}
          />
        </label>

        <label>
          {t("settings.intakeCompletionEsLabel")}
          <textarea
            name="intakeCompletionBodyEs"
            rows={2}
            maxLength={1600}
            defaultValue={organization.intakeCompletionBodyEs || ""}
            placeholder={t("settings.intakeCompletionPlaceholderEs")}
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

        <label className="inline-toggle">
            <input
              type="checkbox"
              name="allowWorkerLeadCreate"
              defaultChecked={organization.allowWorkerLeadCreate}
              disabled={!canManageLeadEntrySetting}
            />
          {t("settings.allowWorkerLeadCreate")}
        </label>
        {!canManageLeadEntrySetting ? (
          <p className="muted">{t("settings.allowWorkerLeadCreateNote")}</p>
        ) : null}

        <h3 style={{ marginTop: 10 }}>{t("settings.automationFlagsHeading")}</h3>
        <label className="inline-toggle">
          <input
            type="checkbox"
            name="ghostBustingEnabled"
            defaultChecked={organization.ghostBustingEnabled}
            disabled={!canManageAutomationSettings}
          />
          {t("settings.ghostBustingToggle")}
        </label>
        <label className="inline-toggle">
          <input
            type="checkbox"
            name="voiceNotesEnabled"
            defaultChecked={organization.voiceNotesEnabled}
            disabled={!canManageAutomationSettings}
          />
          {t("settings.voiceNotesToggle")}
        </label>
        <label className="inline-toggle">
          <input
            type="checkbox"
            name="metaCapiEnabled"
            defaultChecked={organization.metaCapiEnabled}
            disabled={!canManageAutomationSettings}
          />
          {t("settings.metaCapiToggle")}
        </label>
        <label className="inline-toggle">
          <input
            type="checkbox"
            name="offlineModeEnabled"
            defaultChecked={organization.offlineModeEnabled}
            disabled={!canManageAutomationSettings}
          />
          {t("settings.offlineModeToggle")}
        </label>

        <h3 style={{ marginTop: 10 }}>{t("settings.ghostRulesHeading")}</h3>
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
            defaultValue={
              organization.ghostBustingTemplateText ||
              t("settings.ghostTemplateDefault")
            }
          />
        </label>
        {!canManageAutomationSettings ? (
          <p className="muted">{t("settings.automationFlagsNote")}</p>
        ) : null}

        <button className="btn primary" type="submit">
          {t("buttons.saveSettings")}
        </button>

        {saved ? <p className="form-status">{t("settings.saved")}</p> : null}
        {error === "missing-org" ? <p className="form-status">{t("settings.errors.missingOrg")}</p> : null}
        {error === "invalid-sender" ? <p className="form-status">{t("settings.errors.invalidSender")}</p> : null}
        {error === "invalid-message-language" ? (
          <p className="form-status">{t("settings.errors.invalidMessageLanguage")}</p>
        ) : null}
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
        {error === "invalid-ghost-hours" ? (
          <p className="form-status">{t("settings.errors.invalidGhostHours")}</p>
        ) : null}
        {error === "invalid-ghost-max" ? (
          <p className="form-status">{t("settings.errors.invalidGhostMax")}</p>
        ) : null}
        {error === "invalid-ghost-template" ? (
          <p className="form-status">{t("settings.errors.invalidGhostTemplate")}</p>
        ) : null}
      </form>
    </section>
  );
}
