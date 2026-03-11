import Link from "next/link";
import type { CalendarAccessRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { isNotFoundError } from "next/dist/client/components/not-found";
import { isRedirectError } from "next/dist/client/components/redirect";
import type { AnalyticsRange } from "@/lib/portal-analytics";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import OwnerCommandCenter from "./owner-command-center";
import WorkerOpsDashboard from "./worker-ops-dashboard";
import { getParam, resolveAppScope, withOrgQuery } from "./_lib/portal-scope";

export const dynamic = "force-dynamic";

function normalizeDashboardRange(value: string): AnalyticsRange {
  if (value === "7d" || value === "30d") return value;
  return "7d";
}

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    const requestedOrgId = getParam(searchParams?.orgId);
    const scope = await resolveAppScope({ nextPath: "/app", requestedOrgId });

    if (scope.internalUser) {
      redirect(withOrgQuery("/app/calendar", scope.orgId, true));
    }

    const sessionUser = await requireSessionUser("/app");
    let calendarAccessRole: CalendarAccessRole = "WORKER";

    if (sessionUser.id) {
      try {
        const currentUser = await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { calendarAccessRole: true },
        });
        calendarAccessRole = currentUser?.calendarAccessRole || "WORKER";
      } catch (error) {
        console.error("AppHomePage failed to load calendar access role. Falling back to worker dashboard.", error);
      }
    }

    const viewer = {
      id: sessionUser.id || "",
      internalUser: false,
      calendarAccessRole,
      orgId: scope.orgId,
    };

    if (calendarAccessRole === "OWNER" || calendarAccessRole === "ADMIN") {
      return <OwnerCommandCenter scope={scope} viewer={viewer} range={normalizeDashboardRange(getParam(searchParams?.range))} />;
    }

    return <WorkerOpsDashboard scope={scope} viewer={viewer} />;
  } catch (error) {
    if (isRedirectError(error) || isNotFoundError(error)) {
      throw error;
    }
    console.error("AppHomePage hard failure.", error);
    return (
      <section className="card">
        <h2>Dashboard is temporarily unavailable</h2>
        <p className="muted">We hit a server issue loading this workspace. Use calendar or inbox while we recover the dashboard.</p>
        <div className="quick-actions" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href="/app/calendar">
            Open Calendar
          </Link>
          <Link className="btn secondary" href="/app/inbox">
            Open Inbox
          </Link>
        </div>
      </section>
    );
  }
}
