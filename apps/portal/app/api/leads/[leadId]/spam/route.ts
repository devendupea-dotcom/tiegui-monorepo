import { NextResponse } from "next/server";
import { deriveLeadBookingProjection } from "@/lib/booking-read-model";
import { findBlockedCallerByPhone } from "@/lib/blocked-callers";
import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import { normalizeLeadCity } from "@/lib/lead-location";
import { blockLeadAsSpam, derivePotentialSpamSignals } from "@/lib/lead-spam";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  assertOrgWriteAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

type RouteContext = {
  params: { leadId: string };
};

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        id: true,
        orgId: true,
        phoneE164: true,
      },
    });

    if (!lead) {
      throw new AppApiError("Lead not found.", 404);
    }

    assertOrgWriteAccess(actor, lead.orgId);

    if (!canManageAnyOrgJobs(actor)) {
      await assertCanMutateLeadJob({
        actor,
        orgId: lead.orgId,
        leadId: lead.id,
      });
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await blockLeadAsSpam(tx, {
        orgId: lead.orgId,
        leadId: lead.id,
        phoneE164: lead.phoneE164,
        userId: actor.id ?? null,
        at: now,
        blockedCallerReason: "Blocked from inbox as spam or junk lead.",
        noteBody:
          "[Spam] Caller blocked from inbox. Future auto-text and forwarding should stay suppressed.",
      });

      const nextLead = await tx.lead.findUnique({
        where: { id: lead.id },
        select: {
          id: true,
          orgId: true,
          contactName: true,
          businessName: true,
          phoneE164: true,
          city: true,
          businessType: true,
          status: true,
          priority: true,
          nextFollowUpAt: true,
          estimatedRevenueCents: true,
          notes: true,
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              addressLine: true,
            },
          },
          events: {
            where: {
              type: {
                in: ["JOB", "ESTIMATE"],
              },
            },
            select: {
              id: true,
              jobId: true,
              type: true,
              status: true,
              startAt: true,
              endAt: true,
              createdAt: true,
              updatedAt: true,
            },
            take: 12,
          },
          _count: {
            select: {
              messages: {
                where: {
                  direction: "OUTBOUND",
                  status: "FAILED",
                },
              },
            },
          },
        },
      });

      if (!nextLead) {
        throw new AppApiError("Lead not found after spam block.", 404);
      }

      return nextLead;
    });

    const bookingProjection = deriveLeadBookingProjection({
      leadStatus: updated.status,
      events: updated.events,
    });
    const blockedCaller = await findBlockedCallerByPhone({
      orgId: updated.orgId,
      phone: updated.phoneE164,
    });
    const potentialSpamSignals = derivePotentialSpamSignals({
      isBlockedCaller: Boolean(blockedCaller),
      failedOutboundCount: updated._count.messages,
    });

    return NextResponse.json({
      ok: true,
      lead: {
        id: updated.id,
        orgId: updated.orgId,
        contactName: updated.contactName,
        businessName: updated.businessName,
        phoneE164: updated.phoneE164,
        city: normalizeLeadCity(updated.city),
        businessType: sanitizeLeadBusinessTypeLabel(updated.businessType),
        status: bookingProjection.derivedLeadStatus,
        priority: updated.priority,
        nextFollowUpAt:
          bookingProjection.hasActiveBooking || !updated.nextFollowUpAt
            ? null
            : updated.nextFollowUpAt.toISOString(),
        estimatedRevenueCents: updated.estimatedRevenueCents,
        notes: updated.notes,
        customer: updated.customer,
        isBlockedCaller: Boolean(blockedCaller),
        potentialSpam: potentialSpamSignals.length > 0,
        potentialSpamSignals,
        failedOutboundCount: updated._count.messages,
      },
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to block lead as spam.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
