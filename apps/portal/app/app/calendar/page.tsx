import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { DEFAULT_CALENDAR_TIMEZONE, DEFAULT_SLOT_MINUTES } from "@/lib/calendar/dates";
import { getOrgCalendarSettings, type OrgCalendarSettings } from "@/lib/calendar/availability";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import PremiumJobCalendar from "./premium-job-calendar";

export const dynamic = "force-dynamic";

export default async function ClientCalendarPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    const requestedOrgId = getParam(searchParams?.orgId);
    const scope = await resolveAppScope({
      nextPath: "/app/calendar",
      requestedOrgId,
    });

    if (!scope.onboardingComplete) {
      return (
        <section className="card">
          <h2>Calendar</h2>
          <div className="portal-empty-state">
            <strong>No events yet in your schedule.</strong>
            <p className="muted">Add a job or set working hours to populate your calendar.</p>
            <div className="portal-empty-actions">
              <a className="btn primary" href={scope.internalUser ? `/app?quickAdd=1&orgId=${encodeURIComponent(scope.orgId)}` : "/app?quickAdd=1"}>
                Add Lead
              </a>
              <a
                className="btn secondary"
                href={scope.internalUser ? `/app/onboarding?step=1&orgId=${encodeURIComponent(scope.orgId)}` : "/app/onboarding?step=1"}
              >
                Set Working Hours
              </a>
            </div>
          </div>
        </section>
      );
    }

    const user = await requireSessionUser("/app/calendar");

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
      const rows = await prisma.user.findMany({
        where: {
          OR: [{ orgId: scope.orgId }, { role: "INTERNAL" }],
        },
        select: {
          id: true,
          name: true,
          email: true,
          calendarAccessRole: true,
          role: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
        take: 100,
      });
      workers = rows.map((row) => ({
        ...row,
        calendarAccessRole: row.calendarAccessRole,
      }));
    } catch (error) {
      console.error("ClientCalendarPage failed to load worker calendar roles. Falling back to WORKER roles.", error);
      const rows = await prisma.user.findMany({
        where: {
          OR: [{ orgId: scope.orgId }, { role: "INTERNAL" }],
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
        take: 100,
      });
      workers = rows.map((row) => ({
        ...row,
        calendarAccessRole: scope.internalUser ? "OWNER" : "WORKER",
      }));
    }

    let currentUserCalendarRole: "OWNER" | "ADMIN" | "WORKER" | "READ_ONLY" = scope.internalUser ? "OWNER" : "WORKER";
    if (!scope.internalUser && user.id) {
      try {
        const currentUserRecord = await prisma.user.findUnique({
          where: { id: user.id || "" },
          select: {
            calendarAccessRole: true,
          },
        });
        if (currentUserRecord?.calendarAccessRole) {
          currentUserCalendarRole = currentUserRecord.calendarAccessRole;
        }
      } catch (error) {
        console.error("ClientCalendarPage failed to load current user calendar role. Using WORKER.", error);
      }
    }

    return (
      <PremiumJobCalendar
        orgId={scope.orgId}
        orgName={scope.orgName}
        internalUser={scope.internalUser}
        currentUserId={user.id || ""}
        currentUserCalendarRole={currentUserCalendarRole}
        defaultSettings={settings}
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
    return (
      <section className="card">
        <h2>Calendar is temporarily unavailable</h2>
        <p className="muted">
          We hit a server issue loading this workspace calendar. Please refresh in a moment.
        </p>
      </section>
    );
  }
}
