import { prisma } from "@/lib/prisma";
import { getRequestTranslator } from "@/lib/i18n";
import { resolveLeadLocationLabel } from "@/lib/lead-location";
import { DEFAULT_CALENDAR_TIMEZONE, DEFAULT_SLOT_MINUTES } from "@/lib/calendar/dates";
import { getOrgCalendarSettings, type OrgCalendarSettings } from "@/lib/calendar/availability";
import { listWorkspaceUsers, sortWorkspaceUsersByUserRoleThenLabel } from "@/lib/workspace-users";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import PremiumJobCalendar from "./premium-job-calendar";

export const dynamic = "force-dynamic";

export default async function ClientCalendarPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    const t = await getRequestTranslator();
    const requestedOrgId = getParam(searchParams?.orgId);
    const quickLeadId = getParam(searchParams?.leadId);
    const scope = await resolveAppScope({
      nextPath: "/app/calendar",
      requestedOrgId,
    });

    if (!scope.onboardingComplete) {
      return (
        <section className="card">
          <h2>{t("calendar.title")}</h2>
          <div className="portal-empty-state">
            <strong>{t("calendar.emptyTitle")}</strong>
            <p className="muted">{t("calendar.emptyBody")}</p>
            <div className="portal-empty-actions">
              <a className="btn primary" href={scope.internalUser ? `/app?quickAdd=1&orgId=${encodeURIComponent(scope.orgId)}` : "/app?quickAdd=1"}>
                {t("buttons.addLead")}
              </a>
              <a
                className="btn secondary"
                href={scope.internalUser ? `/app/onboarding?step=1&orgId=${encodeURIComponent(scope.orgId)}` : "/app/onboarding?step=1"}
              >
                {t("buttons.setWorkingHours")}
              </a>
            </div>
          </div>
        </section>
      );
    }

    const viewer = await requireAppPageViewer({
      nextPath: "/app/calendar",
      orgId: scope.orgId,
    });

    const fallbackSettings: OrgCalendarSettings = {
      allowOverlaps: false,
      defaultSlotMinutes: DEFAULT_SLOT_MINUTES,
      defaultUntimedStartHour: 9,
      calendarTimezone: DEFAULT_CALENDAR_TIMEZONE,
      weekStartsOn: 0,
    };

    let settings = fallbackSettings;
    try {
      settings = await getOrgCalendarSettings(scope.orgId);
    } catch (error) {
      console.error("ClientCalendarPage failed to load org calendar settings. Using defaults.", error);
    }

    let workers: Array<{
      id: string;
      name: string | null;
      email: string;
      role: "INTERNAL" | "CLIENT";
      calendarAccessRole: "OWNER" | "ADMIN" | "WORKER" | "READ_ONLY";
    }> = [];
    try {
      workers = sortWorkspaceUsersByUserRoleThenLabel(
        await listWorkspaceUsers({
          organizationId: scope.orgId,
          includeInternal: true,
        }),
      ).slice(0, 100);
    } catch (error) {
      console.error("ClientCalendarPage failed to load membership-backed worker roster.", error);
    }

    const currentUserCalendarRole = viewer.calendarAccessRole;

    const quickScheduleLead = quickLeadId
      ? await prisma.lead.findFirst({
          where: {
            id: quickLeadId,
            orgId: scope.orgId,
          },
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            city: true,
            intakeLocationText: true,
            customer: {
              select: {
                addressLine: true,
              },
            },
          },
        })
      : null;

    return (
      <PremiumJobCalendar
        orgId={scope.orgId}
        orgName={scope.orgName}
        internalUser={viewer.internalUser}
        currentUserId={viewer.id}
        currentUserCalendarRole={currentUserCalendarRole}
        defaultSettings={settings}
        quickScheduleLead={
          quickScheduleLead
            ? {
                id: quickScheduleLead.id,
                title:
                  quickScheduleLead.contactName ||
                  quickScheduleLead.businessName ||
                  quickScheduleLead.phoneE164,
                customerName:
                  quickScheduleLead.contactName ||
                  quickScheduleLead.businessName ||
                  quickScheduleLead.phoneE164,
                addressLine:
                  resolveLeadLocationLabel({
                    customerAddressLine: quickScheduleLead.customer?.addressLine,
                    intakeLocationText: quickScheduleLead.intakeLocationText,
                    city: quickScheduleLead.city,
                  }) || "",
              }
            : null
        }
        workers={workers.map((worker) => ({
          id: worker.id,
          name: worker.name || worker.email || "Worker",
          email: worker.email,
          calendarAccessRole: worker.calendarAccessRole,
          role: worker.role,
        }))}
      />
    );
  } catch (error) {
    console.error("ClientCalendarPage hard failure.", error);
    const t = await getRequestTranslator();
    return (
      <section className="card">
        <h2>{t("calendar.unavailableTitle")}</h2>
        <p className="muted">{t("calendar.unavailableBody")}</p>
      </section>
    );
  }
}
