import type { DispatchNotificationSettings } from "@/lib/dispatch";
import { serializeDispatchNotificationSettings } from "@/lib/dispatch";
import { AppApiError } from "@/lib/app-api-permissions";
import { prisma } from "@/lib/prisma";

export type NotificationSettingsPayload = {
  smsEnabled?: unknown;
  notifyScheduled?: unknown;
  notifyOnTheWay?: unknown;
  notifyRescheduled?: unknown;
  notifyCompleted?: unknown;
};

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export async function getDispatchNotificationSettings(orgId: string): Promise<DispatchNotificationSettings> {
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      messagingSettings: {
        select: {
          dispatchSmsEnabled: true,
          dispatchSmsScheduled: true,
          dispatchSmsOnTheWay: true,
          dispatchSmsRescheduled: true,
          dispatchSmsCompleted: true,
        },
      },
      twilioConfig: {
        select: {
          phoneNumber: true,
          status: true,
        },
      },
    },
  });

  if (!organization) {
    throw new AppApiError("Workspace not found.", 404);
  }

  const canSend = Boolean(organization.twilioConfig?.phoneNumber && organization.twilioConfig?.status !== "PAUSED");
  return serializeDispatchNotificationSettings(organization.messagingSettings, canSend);
}

export async function updateDispatchNotificationSettings(input: {
  orgId: string;
  payload: NotificationSettingsPayload | null;
}): Promise<DispatchNotificationSettings> {
  const current = await getDispatchNotificationSettings(input.orgId);
  const payload = input.payload || {};

  await prisma.organizationMessagingSettings.upsert({
    where: {
      orgId: input.orgId,
    },
    update: {
      dispatchSmsEnabled: parseBoolean(payload.smsEnabled, current.smsEnabled),
      dispatchSmsScheduled: parseBoolean(payload.notifyScheduled, current.notifyScheduled),
      dispatchSmsOnTheWay: parseBoolean(payload.notifyOnTheWay, current.notifyOnTheWay),
      dispatchSmsRescheduled: parseBoolean(payload.notifyRescheduled, current.notifyRescheduled),
      dispatchSmsCompleted: parseBoolean(payload.notifyCompleted, current.notifyCompleted),
    },
    create: {
      orgId: input.orgId,
      dispatchSmsEnabled: parseBoolean(payload.smsEnabled, current.smsEnabled),
      dispatchSmsScheduled: parseBoolean(payload.notifyScheduled, current.notifyScheduled),
      dispatchSmsOnTheWay: parseBoolean(payload.notifyOnTheWay, current.notifyOnTheWay),
      dispatchSmsRescheduled: parseBoolean(payload.notifyRescheduled, current.notifyRescheduled),
      dispatchSmsCompleted: parseBoolean(payload.notifyCompleted, current.notifyCompleted),
    },
  });

  return getDispatchNotificationSettings(input.orgId);
}
