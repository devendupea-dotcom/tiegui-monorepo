import { Prisma, type LeadSourceChannel } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIpFromHeaders } from "@/lib/auth-rate-limit";
import { createBuyerProjectForWebsiteLead } from "@/lib/buyer-projects";
import { decryptIntegrationToken } from "@/lib/integrations/crypto";
import { prisma } from "@/lib/prisma";
import {
  classifyWebsiteLeadReceiptReplay,
  hashWebsiteLeadRequestBody,
  hashWebsiteLeadSourceSecret,
  normalizeWebsiteLeadPayload,
  parseWebsiteLeadAuthHeaders,
  parseWebsiteLeadTimestamp,
  validateWebsiteLeadOrigin,
  verifyWebsiteLeadSignature,
  type NormalizedWebsiteLeadPayload,
  WEBSITE_LEAD_MAX_BODY_BYTES,
} from "@/lib/public-website-leads";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

class WebsiteLeadRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type VerifiedWebsiteLeadSource = {
  id: string;
  orgId: string;
  portalVertical: "CONTRACTOR" | "HOMEBUILDER";
  encryptedSecret: string;
  hashedSecret: string;
  allowedOrigin: string | null;
  rateLimitKey: string | null;
};

type NormalizedPayload = NormalizedWebsiteLeadPayload;

function jsonError(message: string, status: number, extraHeaders?: HeadersInit) {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: extraHeaders,
    },
  );
}

function inferSourceChannel(attribution: Record<string, string>): LeadSourceChannel {
  const utmSource = (attribution.utm_source || attribution.utmSource || "").trim().toLowerCase();
  const utmMedium = (attribution.utm_medium || attribution.utmMedium || "").trim().toLowerCase();
  const paidMedium = ["cpc", "ppc", "paid", "paid_social", "paid-social"].includes(utmMedium);

  if (["facebook", "instagram", "meta"].includes(utmSource) || attribution.fbclid) {
    return "META_ADS";
  }

  if (utmSource === "google" || (paidMedium && utmSource)) {
    return "GOOGLE_ADS";
  }

  if (utmMedium === "organic" || utmSource === "organic") {
    return "ORGANIC";
  }

  return "OTHER";
}

function buildLeadNote(input: NormalizedPayload) {
  const listing = input.listingContext;
  const lines = [
    "Website inquiry from signed website lead source.",
    input.reason ? `Reason: ${input.reason}` : null,
    input.budgetRange ? `Budget range: ${input.budgetRange}` : null,
    input.financingNeeded ? `Financing: ${input.financingNeeded}` : null,
    input.timeline ? `Timeline: ${input.timeline}` : null,
    listing?.title ? `Selected home: ${listing.title}` : null,
    listing?.homeType ? `Home type: ${listing.homeType}` : null,
    listing?.priceLabel ? `Price reference: ${listing.priceLabel}` : null,
    listing?.sqft ? `Square feet: ${listing.sqft.toLocaleString()}` : null,
    input.listingSlug ? `Listing slug: ${input.listingSlug}` : null,
    input.sourcePath ? `Source path: ${input.sourcePath}` : null,
    input.pageTitle ? `Page title: ${input.pageTitle}` : null,
    `SMS opt-in: ${input.smsOptIn ? "Yes" : "No"}`,
    input.message ? ["", input.message].join("\n") : null,
    Object.keys(input.attribution).length
      ? ["", "Attribution:", ...Object.entries(input.attribution).map(([key, value]) => `${key}: ${value}`)].join("\n")
      : null,
  ].filter(Boolean);

  return lines.join("\n").slice(0, 5000);
}

function getPublicBaseUrl(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }
  return new URL(req.url).origin;
}

async function enforceRateLimit(input: {
  identifier: string;
  prefix: string;
  limit: number;
  windowSeconds: number;
}): Promise<NextResponse | null> {
  const rate = await checkSlidingWindowLimit(input);
  if (rate.ok) return null;

  return jsonError("Too many website lead requests. Try again shortly.", 429, {
    "Retry-After": String(rate.retryAfterSeconds),
  });
}

async function readLimitedBody(req: Request): Promise<string> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > WEBSITE_LEAD_MAX_BODY_BYTES) {
      throw new WebsiteLeadRouteError("Website lead payload is too large.", 413);
    }
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > WEBSITE_LEAD_MAX_BODY_BYTES) {
    throw new WebsiteLeadRouteError("Website lead payload is too large.", 413);
  }

  return rawBody;
}

async function loadVerifiedSource(sourceId: string): Promise<VerifiedWebsiteLeadSource> {
  const source = await prisma.websiteLeadSource.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      orgId: true,
      encryptedSecret: true,
      hashedSecret: true,
      allowedOrigin: true,
      active: true,
      rateLimitKey: true,
      org: {
        select: {
          id: true,
          portalVertical: true,
        },
      },
    },
  });

  if (!source) {
    throw new WebsiteLeadRouteError("Unknown website lead source.", 401);
  }
  if (!source.active) {
    throw new WebsiteLeadRouteError("Website lead source is inactive.", 403);
  }
  if (!source.org) {
    throw new WebsiteLeadRouteError("Website lead source organization is missing.", 404);
  }

  return {
    id: source.id,
    orgId: source.orgId,
    portalVertical: source.org.portalVertical,
    encryptedSecret: source.encryptedSecret,
    hashedSecret: source.hashedSecret,
    allowedOrigin: source.allowedOrigin,
    rateLimitKey: source.rateLimitKey,
  };
}

async function createLeadForSubmission(input: {
  source: VerifiedWebsiteLeadSource;
  idempotencyKey: string;
  requestHash: string;
  payload: NormalizedPayload;
  publicBaseUrl: string;
}): Promise<{
  status: 200 | 201;
  leadId: string;
  customerId: string;
  buyerProjectId?: string;
  projectTrackingUrl?: string;
}> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existingReceipt = await tx.websiteLeadSubmissionReceipt.findUnique({
        where: {
          sourceId_idempotencyKey: {
            sourceId: input.source.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: {
          requestHash: true,
          createdLeadId: true,
          createdCustomerId: true,
          createdBuyerProjectId: true,
        },
      });
      const replayState = classifyWebsiteLeadReceiptReplay(existingReceipt, input.requestHash);
      if (replayState === "conflict") {
        throw new WebsiteLeadRouteError("Idempotency key already used with a different request.", 409);
      }
      if (replayState === "pending") {
        throw new WebsiteLeadRouteError("Idempotent submission is already being processed.", 409);
      }
      if (replayState === "duplicate" && existingReceipt?.createdLeadId && existingReceipt.createdCustomerId) {
        return {
          status: 200,
          leadId: existingReceipt.createdLeadId,
          customerId: existingReceipt.createdCustomerId,
          buyerProjectId: existingReceipt.createdBuyerProjectId || undefined,
        };
      }

      const receipt = await tx.websiteLeadSubmissionReceipt.create({
        data: {
          sourceId: input.source.id,
          orgId: input.source.orgId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        },
        select: { id: true },
      });

      const existingCustomer = await tx.customer.findFirst({
        where: {
          orgId: input.source.orgId,
          phoneE164: input.payload.phoneE164,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, email: true },
      });

      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: {
              name: existingCustomer.name || input.payload.name,
              email: existingCustomer.email || input.payload.email || null,
            },
            select: { id: true },
          })
        : await tx.customer.create({
            data: {
              orgId: input.source.orgId,
              name: input.payload.name,
              phoneE164: input.payload.phoneE164,
              email: input.payload.email || null,
            },
            select: { id: true },
          });

      const sourceChannel = inferSourceChannel(input.payload.attribution);
      const utmSource = input.payload.attribution.utm_source || input.payload.attribution.utmSource || null;
      const utmMedium = input.payload.attribution.utm_medium || input.payload.attribution.utmMedium || null;
      const utmCampaign = input.payload.attribution.utm_campaign || input.payload.attribution.utmCampaign || null;
      const sourceDetail = [
        input.payload.reason || "Website inquiry",
        input.payload.listingSlug ? `listing:${input.payload.listingSlug}` : null,
        input.payload.sourcePath || null,
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 500);
      const note = buildLeadNote(input.payload);

      const lead = await tx.lead.create({
        data: {
          orgId: input.source.orgId,
          customerId: customer.id,
          contactName: input.payload.name,
          phoneE164: input.payload.phoneE164,
          sourceType: "ORGANIC",
          sourceChannel,
          sourceDetail: sourceDetail || null,
          utmSource,
          utmMedium,
          utmCampaign,
          businessType: input.payload.reason || null,
          leadSource: "FORM",
          lastInboundAt: new Date(),
          notes: note,
        },
        select: { id: true },
      });

      await tx.leadNote.create({
        data: {
          orgId: input.source.orgId,
          leadId: lead.id,
          body: note,
        },
      });

      const buyerProject =
        input.source.portalVertical === "HOMEBUILDER"
          ? await createBuyerProjectForWebsiteLead({
              tx,
              orgId: input.source.orgId,
              customerId: customer.id,
              leadId: lead.id,
              payload: input.payload,
              publicBaseUrl: input.publicBaseUrl,
            })
          : null;

      await tx.websiteLeadSubmissionReceipt.update({
        where: { id: receipt.id },
        data: {
          createdLeadId: lead.id,
          createdCustomerId: customer.id,
          createdBuyerProjectId: buyerProject?.buyerProjectId || null,
        },
      });

      await tx.websiteLeadSource.update({
        where: { id: input.source.id },
        data: { lastUsedAt: new Date() },
      });

      return {
        status: 201,
        leadId: lead.id,
        customerId: customer.id,
        buyerProjectId: buyerProject?.buyerProjectId,
        projectTrackingUrl: buyerProject?.projectTrackingUrl,
      };
    });
  } catch (error) {
    if (error instanceof WebsiteLeadRouteError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const receipt = await prisma.websiteLeadSubmissionReceipt.findUnique({
        where: {
          sourceId_idempotencyKey: {
            sourceId: input.source.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: {
          requestHash: true,
          createdLeadId: true,
          createdCustomerId: true,
          createdBuyerProjectId: true,
        },
      });
      const replayState = classifyWebsiteLeadReceiptReplay(receipt, input.requestHash);
      if (replayState === "duplicate" && receipt?.createdLeadId && receipt.createdCustomerId) {
        return {
          status: 200,
          leadId: receipt.createdLeadId,
          customerId: receipt.createdCustomerId,
          buyerProjectId: receipt.createdBuyerProjectId || undefined,
        };
      }
      throw new WebsiteLeadRouteError(
        replayState === "conflict"
          ? "Idempotency key already used with a different request."
          : "Idempotent submission is already being processed.",
        409,
      );
    }
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const ipRateLimit = await enforceRateLimit({
      identifier: getClientIpFromHeaders(req),
      prefix: "rl:public:website-leads:ip",
      limit: 60,
      windowSeconds: 60,
    });
    if (ipRateLimit) return ipRateLimit;

    const authHeaders = parseWebsiteLeadAuthHeaders(req.headers);
    if (!authHeaders.ok) {
      return jsonError(authHeaders.error, authHeaders.status);
    }

    const timestamp = parseWebsiteLeadTimestamp(authHeaders.value.timestamp);
    if (!timestamp.ok) {
      return jsonError(timestamp.error, timestamp.status);
    }

    const rawBody = await readLimitedBody(req);
    const requestHash = hashWebsiteLeadRequestBody(rawBody);
    const source = await loadVerifiedSource(authHeaders.value.sourceId);

    const sourceRateLimit = await enforceRateLimit({
      identifier: source.rateLimitKey || source.id,
      prefix: "rl:public:website-leads:source",
      limit: 20,
      windowSeconds: 60,
    });
    if (sourceRateLimit) return sourceRateLimit;

    const origin = validateWebsiteLeadOrigin({
      allowedOrigin: source.allowedOrigin,
      originHeader: req.headers.get("origin"),
      refererHeader: req.headers.get("referer"),
    });
    if (!origin.ok) {
      return jsonError(origin.error, origin.status);
    }

    const plaintextSecret = decryptIntegrationToken(source.encryptedSecret);
    if (hashWebsiteLeadSourceSecret(plaintextSecret) !== source.hashedSecret) {
      return jsonError("Website lead source secret is misconfigured.", 500);
    }

    const signatureOk = verifyWebsiteLeadSignature({
      secret: plaintextSecret,
      timestamp: authHeaders.value.timestamp,
      sourceId: source.id,
      rawBody,
      signature: authHeaders.value.signature,
    });
    if (!signatureOk) {
      return jsonError("Invalid website lead signature.", 401);
    }

    const parsedBody = JSON.parse(rawBody) as unknown;
    const payload = normalizeWebsiteLeadPayload(parsedBody);
    if (!payload.ok) {
      return jsonError(payload.error, payload.status);
    }

    const result = await createLeadForSubmission({
      source,
      idempotencyKey: authHeaders.value.idempotencyKey,
      requestHash,
      payload: payload.value,
      publicBaseUrl: getPublicBaseUrl(req),
    });

    return NextResponse.json(
      {
        ok: true,
        leadId: result.leadId,
        customerId: result.customerId,
        buyerProjectId: result.buyerProjectId,
        projectTrackingUrl: result.projectTrackingUrl,
        sourceId: source.id,
        duplicate: result.status === 200,
      },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof WebsiteLeadRouteError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload.", 400);
    }

    return jsonError("Website lead intake failed.", 500);
  }
}
