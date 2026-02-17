import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isInternalRole } from "@/lib/session";
import { normalizeE164 } from "@/lib/phone";
import { sendOutboundSms } from "@/lib/sms";

type RouteContext = {
  params: { leadId: string };
};

// Twilio inbound webhook plan:
// 1) Normalize inbound From number to E.164.
// 2) Resolve orgId from the destination Twilio number.
// 3) Find lead by { orgId, phoneE164: fromNumber }.
// 4) If found, create INBOUND Message linked to that lead.
// 5) If not found, create Lead first, then create linked Message.

async function getScopedLeadOrResponse(leadId: string) {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user) {
    return { response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      orgId: true,
      phoneE164: true,
      status: true,
    },
  });

  if (!lead) {
    return { response: NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 }) };
  }

  if (!isInternalRole(user.role)) {
    if (!user.orgId || user.orgId !== lead.orgId) {
      return { response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
    }
  }

  return { lead, user };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const leadId = params.leadId;
  const scoped = await getScopedLeadOrResponse(leadId);
  if ("response" in scoped) {
    return scoped.response;
  }

  const messages = await prisma.message.findMany({
    where: { leadId: scoped.lead.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      fromNumberE164: true,
      toNumberE164: true,
      body: true,
      type: true,
      provider: true,
      providerMessageSid: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, messages });
}

export async function POST(req: Request, { params }: RouteContext) {
  const leadId = params.leadId;
  const scoped = await getScopedLeadOrResponse(leadId);
  if ("response" in scoped) {
    return scoped.response;
  }

  let body = "";
  let fromNumberE164: string | null = null;
  try {
    const payload = (await req.json()) as {
      body?: unknown;
      fromNumberE164?: unknown;
    };
    body = typeof payload.body === "string" ? payload.body : "";
    fromNumberE164 =
      typeof payload.fromNumberE164 === "string" ? normalizeE164(payload.fromNumberE164) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const cleanedBody = body.trim();
  if (!cleanedBody) {
    return NextResponse.json({ ok: false, error: "Message body is required." }, { status: 400 });
  }

  if (scoped.lead.status === "DNC") {
    return NextResponse.json(
      {
        ok: false,
        error: "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
      },
      { status: 403 },
    );
  }

  if (cleanedBody.length > 1600) {
    return NextResponse.json({ ok: false, error: "Message must be 1600 characters or less." }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: scoped.lead.orgId },
    select: {
      smsFromNumberE164: true,
      twilioConfig: {
        select: {
          phoneNumber: true,
        },
      },
    },
  });

  const resolvedFromNumber =
    fromNumberE164 ||
    normalizeE164(organization?.twilioConfig?.phoneNumber || null) ||
    normalizeE164(organization?.smsFromNumberE164 || null);

  if (!resolvedFromNumber) {
    return NextResponse.json(
      {
        ok: false,
        error: "No outbound SMS number is configured for this business yet.",
      },
      { status: 400 },
    );
  }

  const now = new Date();

  const providerResult = await sendOutboundSms({
    orgId: scoped.lead.orgId,
    fromNumberE164: resolvedFromNumber,
    toNumberE164: scoped.lead.phoneE164,
    body: cleanedBody,
  });
  const finalFromNumber = providerResult.resolvedFromNumberE164 || resolvedFromNumber;

  if (!finalFromNumber) {
    return NextResponse.json(
      {
        ok: false,
        error: providerResult.notice || "No outbound SMS number is configured for this business yet.",
      },
      { status: 400 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        orgId: scoped.lead.orgId,
        leadId: scoped.lead.id,
        direction: "OUTBOUND",
        type: "MANUAL",
        fromNumberE164: finalFromNumber,
        toNumberE164: scoped.lead.phoneE164,
        body: cleanedBody,
        provider: "TWILIO",
        providerMessageSid: providerResult.providerMessageSid,
        status: providerResult.status,
      },
      select: {
        id: true,
        direction: true,
        type: true,
        fromNumberE164: true,
        toNumberE164: true,
        body: true,
        provider: true,
        providerMessageSid: true,
        status: true,
        createdAt: true,
      },
    });

    await tx.lead.update({
      where: { id: scoped.lead.id },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
      },
    });

    return message;
  });

  return NextResponse.json({ ok: true, message: created, notice: providerResult.notice });
}
