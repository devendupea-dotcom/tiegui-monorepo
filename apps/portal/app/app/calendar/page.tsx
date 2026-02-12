import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import { getOrgCalendarSettings } from "@/lib/calendar/availability";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import PremiumJobCalendar from "./premium-job-calendar";

export const dynamic = "force-dynamic";

export default async function ClientCalendarPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/calendar",
    requestedOrgId,
  });

  const user = await requireSessionUser("/app/calendar");
  const [settings, workers, currentUserRecord] = await Promise.all([
    getOrgCalendarSettings(scope.orgId),
    prisma.user.findMany({
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
    }),
    prisma.user.findUnique({
      where: { id: user.id || "" },
      select: {
        id: true,
        calendarAccessRole: true,
      },
    }),
  ]);

  return (
    <PremiumJobCalendar
      orgId={scope.orgId}
      orgName={scope.orgName}
      internalUser={scope.internalUser}
      currentUserId={currentUserRecord?.id || user.id || ""}
      currentUserCalendarRole={currentUserRecord?.calendarAccessRole || "WORKER"}
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
}
