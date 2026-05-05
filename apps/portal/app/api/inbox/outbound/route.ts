import { NextResponse } from "next/server";
import type { MessageStatus, MessageType } from "@prisma/client";
import { sanitizeConversationSnippet } from "@/lib/inbox-message-display";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OutboundMessageRow = {
  id: string;
  leadId: string;
  contactName: string;
  phoneE164: string;
  toNumberE164: string;
  body: string;
  bodyPreview: string;
  type: MessageType;
  status: MessageStatus | null;
  providerMessageSid: string | null;
  createdAt: string;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const requestedOrgId = url.searchParams.get("orgId");
    const orgId = await resolveActorOrgId({ actor, requestedOrgId });
    const limit = clampInt(Number(url.searchParams.get("limit") || 120), 20, 300);
    const workerScoped =
      !actor.internalUser && actor.calendarAccessRole === "WORKER";

    const messages = await prisma.message.findMany({
      where: {
        orgId,
        direction: "OUTBOUND",
        ...(workerScoped
          ? {
              lead: {
                OR: [
                  { assignedToUserId: actor.id },
                  { createdByUserId: actor.id },
                  { events: { some: { assignedToUserId: actor.id } } },
                  {
                    events: {
                      some: {
                        workerAssignments: {
                          some: { workerUserId: actor.id },
                        },
                      },
                    },
                  },
                ],
              },
            }
          : {}),
      },
      select: {
        id: true,
        leadId: true,
        toNumberE164: true,
        body: true,
        type: true,
        status: true,
        providerMessageSid: true,
        createdAt: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const outboundMessages: OutboundMessageRow[] = messages.map((message) => {
      const contactName =
        message.lead.contactName ||
        message.lead.businessName ||
        message.lead.phoneE164 ||
        message.toNumberE164;

      return {
        id: message.id,
        leadId: message.leadId,
        contactName,
        phoneE164: message.lead.phoneE164,
        toNumberE164: message.toNumberE164,
        body: message.body,
        bodyPreview: sanitizeConversationSnippet({
          body: message.body,
          status: message.status,
          direction: "outbound",
        }),
        type: message.type,
        status: message.status,
        providerMessageSid: message.providerMessageSid,
        createdAt: message.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ ok: true, outboundMessages });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load outbound messages.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
