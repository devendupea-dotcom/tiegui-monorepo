import type { CalendarAccessRole } from "@prisma/client";
import { requireAppOrgActor } from "./portal-scope";

export type AppPageViewer = {
  id: string;
  orgId: string;
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
  accessibleOrgCount: number;
};

export function isWorkerScopedPageViewer(viewer: AppPageViewer): boolean {
  return !viewer.internalUser && viewer.calendarAccessRole === "WORKER";
}

export async function requireAppPageViewer(input: {
  nextPath: string;
  orgId: string;
}): Promise<AppPageViewer> {
  const actor = await requireAppOrgActor(input.nextPath, input.orgId);

  return {
    id: actor.id,
    orgId: actor.orgId,
    internalUser: actor.internalUser,
    calendarAccessRole: actor.calendarAccessRole,
    accessibleOrgCount: actor.accessibleOrgs.length,
  };
}
