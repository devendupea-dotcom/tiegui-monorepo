import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { encryptIntegrationToken } from "@/lib/integrations/crypto";
import { prisma } from "@/lib/prisma";
import {
  generateWebsiteLeadSourceSecret,
  hashWebsiteLeadSourceSecret,
} from "@/lib/public-website-leads";

export const WEBSITE_LEAD_SOURCE_NAME_MAX_LENGTH = 100;
export const WEBSITE_LEAD_SOURCE_DESCRIPTION_MAX_LENGTH = 500;

const LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const websiteLeadSourceSelect = {
  id: true,
  orgId: true,
  name: true,
  description: true,
  allowedOrigin: true,
  active: true,
  rateLimitKey: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      submissions: true,
    },
  },
} satisfies Prisma.WebsiteLeadSourceSelect;

const websiteLeadReceiptSelect = {
  id: true,
  sourceId: true,
  orgId: true,
  idempotencyKey: true,
  requestHash: true,
  createdLeadId: true,
  createdCustomerId: true,
  createdAt: true,
} satisfies Prisma.WebsiteLeadSubmissionReceiptSelect;

type WebsiteLeadSourceRecord = Prisma.WebsiteLeadSourceGetPayload<{
  select: typeof websiteLeadSourceSelect;
}>;

type WebsiteLeadReceiptRecord = Prisma.WebsiteLeadSubmissionReceiptGetPayload<{
  select: typeof websiteLeadReceiptSelect;
}>;

export type WebsiteLeadSourceDto = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  allowedOrigin: string | null;
  active: boolean;
  rateLimitKey: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submissionCount: number;
};

export type WebsiteLeadReceiptDto = {
  id: string;
  sourceId: string;
  orgId: string;
  idempotencyKey: string;
  requestHashPrefix: string;
  createdLeadId: string | null;
  createdCustomerId: string | null;
  createdAt: string;
};

export type CreateWebsiteLeadSourceInput = {
  orgId: string;
  name: string;
  description?: string | null;
  allowedOrigin?: string | null;
  secret?: string;
  active?: boolean;
};

export type UpdateWebsiteLeadSourceInput = {
  orgId: string;
  sourceId: string;
  name?: string;
  description?: string | null;
  allowedOrigin?: string | null;
};

export class WebsiteLeadSourceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "website_lead_source_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function trimOptional(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

function assertValidOrgId(orgId: string): string {
  const trimmed = orgId.trim();
  if (!trimmed) {
    throw new WebsiteLeadSourceError("Organization id is required.", 400, "missing_org_id");
  }
  return trimmed;
}

export function normalizeWebsiteLeadSourceName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new WebsiteLeadSourceError("Source name is required.", 400, "missing_name");
  }
  if (trimmed.length > WEBSITE_LEAD_SOURCE_NAME_MAX_LENGTH) {
    throw new WebsiteLeadSourceError("Source name is too long.", 400, "name_too_long");
  }
  return trimmed;
}

export function normalizeWebsiteLeadSourceDescription(value: string | null | undefined): string | null {
  const trimmed = trimOptional(value);
  if (!trimmed) return null;
  if (trimmed.length > WEBSITE_LEAD_SOURCE_DESCRIPTION_MAX_LENGTH) {
    throw new WebsiteLeadSourceError("Source description is too long.", 400, "description_too_long");
  }
  return trimmed;
}

export function normalizeWebsiteLeadAllowedOrigin(value: string | null | undefined): string | null {
  const trimmed = trimOptional(value);
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WebsiteLeadSourceError("Allowed origin must be a valid URL origin.", 400, "invalid_allowed_origin");
  }

  const isLocalHttp = parsed.protocol === "http:" && LOCAL_ORIGIN_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new WebsiteLeadSourceError("Allowed origin must use https.", 400, "invalid_allowed_origin_protocol");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new WebsiteLeadSourceError(
      "Allowed origin must not include a path, query string, or hash.",
      400,
      "allowed_origin_must_be_origin",
    );
  }

  return parsed.origin.toLowerCase();
}

export function generateWebsiteLeadSourceRateLimitKey(): string {
  return `wlsrl_${randomBytes(16).toString("base64url")}`;
}

export function serializeWebsiteLeadSource(source: WebsiteLeadSourceRecord): WebsiteLeadSourceDto {
  return {
    id: source.id,
    orgId: source.orgId,
    name: source.name,
    description: source.description,
    allowedOrigin: source.allowedOrigin,
    active: source.active,
    rateLimitKey: source.rateLimitKey,
    lastUsedAt: source.lastUsedAt ? source.lastUsedAt.toISOString() : null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    submissionCount: source._count.submissions,
  };
}

export function serializeWebsiteLeadReceipt(receipt: WebsiteLeadReceiptRecord): WebsiteLeadReceiptDto {
  return {
    id: receipt.id,
    sourceId: receipt.sourceId,
    orgId: receipt.orgId,
    idempotencyKey: receipt.idempotencyKey,
    requestHashPrefix: receipt.requestHash.slice(0, 12),
    createdLeadId: receipt.createdLeadId,
    createdCustomerId: receipt.createdCustomerId,
    createdAt: receipt.createdAt.toISOString(),
  };
}

function buildSecretFields(secret: string) {
  return {
    hashedSecret: hashWebsiteLeadSourceSecret(secret),
    encryptedSecret: encryptIntegrationToken(secret),
  };
}

async function assertOrganizationExists(orgId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });

  if (!organization) {
    throw new WebsiteLeadSourceError("Organization not found.", 404, "org_not_found");
  }
}

async function findWebsiteLeadSourceForOrg(orgId: string, sourceId: string): Promise<WebsiteLeadSourceRecord> {
  const source = await prisma.websiteLeadSource.findFirst({
    where: {
      id: sourceId,
      orgId,
    },
    select: websiteLeadSourceSelect,
  });

  if (!source) {
    throw new WebsiteLeadSourceError("Website lead source not found.", 404, "source_not_found");
  }

  return source;
}

export async function listWebsiteLeadSources(orgIdInput: string): Promise<WebsiteLeadSourceDto[]> {
  const orgId = assertValidOrgId(orgIdInput);
  const sources = await prisma.websiteLeadSource.findMany({
    where: { orgId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: websiteLeadSourceSelect,
  });

  return sources.map(serializeWebsiteLeadSource);
}

export async function listWebsiteLeadSubmissionReceipts(input: {
  orgId: string;
  sourceId?: string | null;
  take?: number;
}): Promise<WebsiteLeadReceiptDto[]> {
  const orgId = assertValidOrgId(input.orgId);
  const sourceId = trimOptional(input.sourceId);
  if (sourceId) {
    await findWebsiteLeadSourceForOrg(orgId, sourceId);
  }

  const receipts = await prisma.websiteLeadSubmissionReceipt.findMany({
    where: {
      orgId,
      ...(sourceId ? { sourceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.take || 25, 1), 100),
    select: websiteLeadReceiptSelect,
  });

  return receipts.map(serializeWebsiteLeadReceipt);
}

export async function createWebsiteLeadSource(input: CreateWebsiteLeadSourceInput) {
  const orgId = assertValidOrgId(input.orgId);
  await assertOrganizationExists(orgId);

  const plaintextSecret = input.secret || generateWebsiteLeadSourceSecret();
  const secretFields = buildSecretFields(plaintextSecret);
  const source = await prisma.websiteLeadSource.create({
    data: {
      orgId,
      name: normalizeWebsiteLeadSourceName(input.name),
      description: normalizeWebsiteLeadSourceDescription(input.description),
      allowedOrigin: normalizeWebsiteLeadAllowedOrigin(input.allowedOrigin),
      rateLimitKey: generateWebsiteLeadSourceRateLimitKey(),
      ...secretFields,
      active: input.active ?? true,
    },
    select: websiteLeadSourceSelect,
  });

  return {
    source: serializeWebsiteLeadSource(source),
    plaintextSecret,
  };
}

export async function updateWebsiteLeadSource(input: UpdateWebsiteLeadSourceInput): Promise<WebsiteLeadSourceDto> {
  const orgId = assertValidOrgId(input.orgId);
  await findWebsiteLeadSourceForOrg(orgId, input.sourceId);

  const data: Prisma.WebsiteLeadSourceUpdateInput = {};
  if (input.name !== undefined) {
    data.name = normalizeWebsiteLeadSourceName(input.name);
  }
  if (input.description !== undefined) {
    data.description = normalizeWebsiteLeadSourceDescription(input.description);
  }
  if (input.allowedOrigin !== undefined) {
    data.allowedOrigin = normalizeWebsiteLeadAllowedOrigin(input.allowedOrigin);
  }

  const source = await prisma.websiteLeadSource.update({
    where: { id: input.sourceId },
    data,
    select: websiteLeadSourceSelect,
  });

  return serializeWebsiteLeadSource(source);
}

export async function setWebsiteLeadSourceActive(input: {
  orgId: string;
  sourceId: string;
  active: boolean;
}): Promise<WebsiteLeadSourceDto> {
  const orgId = assertValidOrgId(input.orgId);
  await findWebsiteLeadSourceForOrg(orgId, input.sourceId);

  const source = await prisma.websiteLeadSource.update({
    where: { id: input.sourceId },
    data: { active: input.active },
    select: websiteLeadSourceSelect,
  });

  return serializeWebsiteLeadSource(source);
}

export async function rotateWebsiteLeadSourceSecret(input: {
  orgId: string;
  sourceId: string;
}) {
  const orgId = assertValidOrgId(input.orgId);
  await findWebsiteLeadSourceForOrg(orgId, input.sourceId);

  const plaintextSecret = generateWebsiteLeadSourceSecret();
  const source = await prisma.websiteLeadSource.update({
    where: { id: input.sourceId },
    data: buildSecretFields(plaintextSecret),
    select: websiteLeadSourceSelect,
  });

  return {
    source: serializeWebsiteLeadSource(source),
    plaintextSecret,
  };
}
