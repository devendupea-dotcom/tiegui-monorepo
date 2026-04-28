export type IntegrationActorAccess = {
  internalUser: boolean;
  calendarAccessRole: "OWNER" | "ADMIN" | "WORKER" | "READ_ONLY";
};

export function canAdministerIntegrations(actor: IntegrationActorAccess): boolean {
  if (actor.internalUser) return true;
  return actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";
}
