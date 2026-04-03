import type { JobEventType, MessageStatus, Prisma } from "@prisma/client";
import {
  dispatchStatusFromDb,
  formatDispatchCustomerSms,
  formatDispatchStatusLabel,
  serializeDispatchNotificationSettings,
  shouldSendDispatchStatusNotification,
  type DispatchNotificationSettings,
} from "@/lib/dispatch";
import { upsertCommunicationEvent, buildCommunicationIdempotencyKey } from "@/lib/communication-events";
import { AppApiError } from "@/lib/app-api-permissions";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendOutboundSms } from "@/lib/sms";
import { isWithinSmsSendWindow } from "@/lib/sms-quiet-hours";

export type DispatchPersistedJobEvent = {
  id: string;
  eventType: JobEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
};

type NotificationSettingsPayload = {
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

export async function maybeSendDispatchCustomerNotifications(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  events: DispatchPersistedJobEvent[];
}) {
  if (input.events.length === 0) {
    return;
  }

  const [settings, job] = await Promise.all([
    getDispatchNotificationSettings(input.orgId),
    prisma.job.findFirst({
      where: {
        id: input.jobId,
        orgId: input.orgId,
      },
      select: {
        id: true,
        orgId: true,
        customerId: true,
        leadId: true,
        customerName: true,
        phone: true,
        serviceType: true,
        scheduledDate: true,
        scheduledStartTime: true,
        scheduledEndTime: true,
        dispatchStatus: true,
        org: {
          select: {
            name: true,
            smsFromNumberE164: true,
            smsQuietHoursStartMinute: true,
            smsQuietHoursEndMinute: true,
            dashboardConfig: {
              select: {
                calendarTimezone: true,
              },
            },
            messagingSettings: {
              select: {
                timezone: true,
              },
            },
          },
        },
        lead: {
          select: {
            id: true,
            status: true,
            customerId: true,
            conversationState: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const toNumberE164 = normalizeE164(job?.phone || null);
  if (!job || !toNumberE164 || !job.scheduledDate) {
    return;
  }

  const status = dispatchStatusFromDb(job.dispatchStatus);
  const candidateEvents = input.events.filter((event) => {
    if (event.eventType === "STATUS_CHANGED") {
      return typeof event.toValue === "string" && event.toValue.trim() === status;
    }
    if (event.eventType === "JOB_CREATED") {
      return true;
    }
    return false;
  });

  if (candidateEvents.length === 0 || !shouldSendDispatchStatusNotification(settings, status)) {
    return;
  }

  if (job.lead?.status === "DNC") {
    return;
  }

  const timeZone =
    job.org.messagingSettings?.timezone || job.org.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
  const inSendWindow = isWithinSmsSendWindow({
    at: new Date(),
    timeZone,
    startMinute: job.org.smsQuietHoursStartMinute,
    endMinute: job.org.smsQuietHoursEndMinute,
  });

  if (!inSendWindow) {
    return;
  }

  const body = formatDispatchCustomerSms({
    orgName: job.org.name,
    serviceType: job.serviceType,
    scheduledDate: job.scheduledDate.toISOString().slice(0, 10),
    scheduledStartTime: job.scheduledStartTime,
    scheduledEndTime: job.scheduledEndTime,
    status,
    timeZone,
  });

  const dispatched = await sendOutboundSms({
    orgId: input.orgId,
    fromNumberE164: job.org.smsFromNumberE164 || null,
    toNumberE164,
    body,
  });

  if (dispatched.suppressed) {
    return;
  }

  if (dispatched.status === "FAILED") {
    return;
  }

  const event = candidateEvents[0];
  if (!event) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    let messageId: string | null = null;

    if (job.leadId) {
      const message = await tx.message.create({
        data: {
          orgId: input.orgId,
          leadId: job.leadId,
          direction: "OUTBOUND",
          type: "SYSTEM_NUDGE",
          fromNumberE164: dispatched.resolvedFromNumberE164 || job.org.smsFromNumberE164 || "",
          toNumberE164,
          body,
          provider: "TWILIO",
          providerMessageSid: dispatched.providerMessageSid,
          status: dispatched.status as MessageStatus,
        },
        select: {
          id: true,
        },
      });
      messageId = message.id;

      await tx.lead.update({
        where: { id: job.leadId },
        data: {
          lastContactedAt: event.createdAt,
          lastOutboundAt: event.createdAt,
        },
      });

      await tx.leadConversationState.updateMany({
        where: {
          leadId: job.leadId,
        },
        data: {
          lastOutboundAt: event.createdAt,
        },
      });
    }

    await upsertCommunicationEvent(tx, {
      orgId: input.orgId,
      leadId: job.leadId,
      contactId: job.customerId || job.lead?.customerId || null,
      conversationId: job.lead?.conversationState?.id || null,
      messageId,
      actorUserId: input.actorUserId,
      type: "OUTBOUND_SMS_SENT",
      channel: "SMS",
      occurredAt: event.createdAt,
      summary: `Dispatch update: ${formatDispatchStatusLabel(status)}`,
      metadataJson: {
        body,
        dispatchJobId: job.id,
        dispatchStatus: status,
      } satisfies Prisma.InputJsonValue,
      provider: "TWILIO",
      providerMessageSid: dispatched.providerMessageSid,
      providerStatus: dispatched.status,
      idempotencyKey: buildCommunicationIdempotencyKey("dispatch-status-sms", input.orgId, event.id, status),
    });
  });
}
