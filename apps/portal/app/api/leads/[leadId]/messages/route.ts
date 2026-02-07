import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isInternalRole } from "@/lib/session";

type RouteContext = {
  params: { leadId: string };
};

// Twilio next phase design:
// 1) Normalize inbound From number to E.164.
// 2) Resolve orgId from the destination Twilio number.
// 3) Find lead by { orgId, phoneE164: fromNumber }.
// 4) If found, create INBOUND Message linked to that lead.
// 5) If not found, create Lead first, then create linked Message.
// Outbound integration should still write the OUTBOUND Message row immediately.

function normalizeE164(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  const digitsOnly = trimmed.replace(/\D/g, "");
  if (!digitsOnly) return null;
  return `+${digitsOnly}`;
}

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

  if (cleanedBody.length > 1600) {
    return NextResponse.json({ ok: false, error: "Message must be 1600 characters or less." }, { status: 400 });
  }

  const defaultFromNumber =
    normalizeE164(process.env.DEFAULT_OUTBOUND_FROM_E164 || null) || "+10000000000";

  const created = await prisma.message.create({
    data: {
      orgId: scoped.lead.orgId,
      leadId: scoped.lead.id,
      direction: "OUTBOUND",
      fromNumberE164: fromNumberE164 || defaultFromNumber,
      toNumberE164: scoped.lead.phoneE164,
      body: cleanedBody,
      provider: "TWILIO",
      status: "SENT",
    },
    select: {
      id: true,
      direction: true,
      fromNumberE164: true,
      toNumberE164: true,
      body: true,
      provider: true,
      providerMessageSid: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, message: created });
}
