import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { normalizeEnvValue } from "./env";
import { prisma } from "./prisma";

function hashSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim().toLowerCase();
  return trimmed || null;
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value || "").replace(/\D/g, "");
  return digits || null;
}

function toNumber(value: { toString(): string } | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.toString());
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

export async function sendMetaCapiPurchaseForInvoice(input: { invoiceId: string }): Promise<{
  sent: boolean;
  skipped: boolean;
  reason?: string;
}> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: {
      org: {
        select: {
          id: true,
          metaCapiEnabled: true,
        },
      },
      customer: {
        select: {
          id: true,
          email: true,
          phoneE164: true,
        },
      },
      job: {
        select: {
          id: true,
          fbClickId: true,
          fbBrowserId: true,
        },
      },
    },
  });

  if (!invoice) {
    return { sent: false, skipped: true, reason: "invoice-not-found" };
  }

  if (!invoice.org.metaCapiEnabled) {
    return { sent: false, skipped: true, reason: "meta-capi-disabled" };
  }

  if (invoice.status !== "PAID") {
    return { sent: false, skipped: true, reason: "invoice-not-paid" };
  }

  const pixelId = normalizeEnvValue(process.env.META_PIXEL_ID);
  const accessToken = normalizeEnvValue(process.env.META_CAPI_ACCESS_TOKEN);
  if (!pixelId || !accessToken) {
    return { sent: false, skipped: true, reason: "missing-meta-env" };
  }

  const eventId = `invoice-paid-${invoice.id}`;

  const existing = await prisma.metaCapiEvent.findUnique({
    where: {
      orgId_eventId: {
        orgId: invoice.orgId,
        eventId,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (existing?.status === "SENT") {
    return { sent: false, skipped: true, reason: "already-sent" };
  }

  const normalizedEmail = normalizeEmail(invoice.customer.email);
  const normalizedPhone = normalizePhone(invoice.customer.phoneE164);
  const userData: Record<string, unknown> = {};
  if (normalizedEmail) {
    userData.em = hashSha256(normalizedEmail);
  }
  if (normalizedPhone) {
    userData.ph = hashSha256(normalizedPhone);
  }
  if (invoice.job?.fbClickId) {
    userData.fbc = invoice.job.fbClickId;
  }
  if (invoice.job?.fbBrowserId) {
    userData.fbp = invoice.job.fbBrowserId;
  }

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "system_generated",
        user_data: userData,
        custom_data: {
          value: toNumber(invoice.total),
          currency: "USD",
          order_id: `invoice-${invoice.invoiceNumber}`,
        },
      },
    ],
  };
  const payloadJson = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;

  const eventRecord =
    existing ||
    (await prisma.metaCapiEvent.create({
      data: {
        orgId: invoice.orgId,
        leadId: invoice.jobId || null,
        invoiceId: invoice.id,
        eventName: "Purchase",
        eventId,
        status: "PENDING",
        payloadJson,
      },
      select: { id: true, status: true },
    }));

  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(pixelId)}/events`;
  const url = `${endpoint}?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseJson = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const message = `Meta CAPI request failed (${response.status}).`;
      await prisma.metaCapiEvent.update({
        where: { id: eventRecord.id },
        data: {
          status: "ERROR",
          errorMessage: message,
          responseJson: responseJson as never,
        },
      });
      return { sent: false, skipped: false, reason: "meta-api-error" };
    }

    await prisma.metaCapiEvent.update({
      where: { id: eventRecord.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        responseJson: responseJson as never,
      },
    });

    return { sent: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta CAPI request failed.";
    await prisma.metaCapiEvent.update({
      where: { id: eventRecord.id },
      data: {
        status: "ERROR",
        errorMessage: message.slice(0, 2000),
      },
    });
    return { sent: false, skipped: false, reason: "meta-request-error" };
  }
}
