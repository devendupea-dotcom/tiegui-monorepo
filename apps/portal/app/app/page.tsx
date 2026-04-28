import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestTranslator } from "@/lib/i18n";
import { isNextNavigationSignal } from "@/lib/next-navigation-signal";
import OwnerCommandCenter from "./owner-command-center";
import WorkerOpsDashboard from "./worker-ops-dashboard";
import { getParam, resolveAppScope, withOrgQuery } from "./_lib/portal-scope";
import { requireAppPageViewer } from "./_lib/portal-viewer";

export const dynamic = "force-dynamic";

export default async function AppHomePage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const t = await getRequestTranslator();

  try {
    const requestedOrgId = getParam(searchParams?.orgId);
    const scope = await resolveAppScope({ nextPath: "/app", requestedOrgId });

    if (scope.internalUser) {
      redirect(withOrgQuery("/app/calendar", scope.orgId, true));
    }

    const viewer = await requireAppPageViewer({
      nextPath: "/app",
      orgId: scope.orgId,
    });

    if (viewer.calendarAccessRole === "OWNER" || viewer.calendarAccessRole === "ADMIN") {
      return <OwnerCommandCenter scope={scope} viewer={viewer} />;
    }

    return <WorkerOpsDashboard scope={scope} viewer={viewer} />;
  } catch (error) {
    if (isNextNavigationSignal(error)) {
      throw error;
    }
    console.error("AppHomePage hard failure.", error);
    return (
      <section className="card">
        <h2>{t("dashboard.error.title")}</h2>
        <p className="muted">{t("dashboard.error.body")}</p>
        <div className="quick-actions" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href="/app/calendar">
            {t("dashboard.error.openCalendar")}
          </Link>
          <Link className="btn secondary" href="/app/inbox">
            {t("dashboard.error.openInbox")}
          </Link>
        </div>
      </section>
    );
  }
}
