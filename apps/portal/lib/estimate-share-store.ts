import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type EstimateActivityType, type EstimateStatus, Prisma } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import {
  canTransitionEstimateStatus,
  serializeEstimateDetail,
  type EstimateDetail,
} from "@/lib/estimates";
import {
  canCreateEstimateShare,
  canCustomerRespondToEstimate,
  createEstimateShareToken,
  deriveEstimateShareState,
  deriveShareExpiry,
  ESTIMATE_SHARE_DECISION_NAME_MAX,
  ESTIMATE_SHARE_DECISION_NOTE_MAX,
  ESTIMATE_SHARE_RECIPIENT_EMAIL_MAX,
  ESTIMATE_SHARE_RECIPIENT_NAME_MAX,
  ESTIMATE_SHARE_RECIPIENT_PHONE_MAX,
  normalizeOptionalShareText,
  type CustomerEstimateShareDetail,
} from "@/lib/estimate-share";
import { estimateDetailInclude } from "@/lib/estimates-store";
import { getPhotoStorageRecord } from "@/lib/photo-storage";
import { prisma } from "@/lib/prisma";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { hashToken } from "@/lib/tokens";

const publicShareInclude = {
  estimate: {
    include: {
      org: {
        select: {
          id: true,
          name: true,
          legalName: true,
          phone: true,
          email: true,
          website: true,
          logoPhotoId: true,
        },
      },
      lineItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  },
} satisfies Prisma.EstimateShareLinkInclude;

type PublicShareRecord = Prisma.EstimateShareLinkGetPayload<{
  include: typeof publicShareInclude;
}>;

async function appendEstimateActivity(
  tx: Prisma.TransactionClient,
  input: {
    estimateId: string;
    type: EstimateActivityType;
    actorUserId: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.estimateActivity.create({
    data: {
      estimateId: input.estimateId,
      type: input.type,
      actorUserId: input.actorUserId,
      metadata: input.metadata,
    },
  });
}

function normalizeOptionalDate(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be an ISO date string.`, 400);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppApiError(`${label} must be a valid date.`, 400);
  }
  return parsed;
}

function normalizeShareText(value: unknown, label: string, maxLength: number): string | null {
  try {
    return normalizeOptionalShareText(value, label, maxLength);
  } catch (error) {
    throw new AppApiError(error instanceof Error ? error.message : `${label} is invalid.`, 400);
  }
}

function ensureEstimateShareable(input: {
  status: EstimateStatus;
  archivedAt: Date | null;
}) {
  if (input.archivedAt) {
    throw new AppApiError("Archived estimates cannot be shared.", 400);
  }

  if (!canCreateEstimateShare(input.status)) {
    throw new AppApiError("This estimate status cannot be shared with a customer yet.", 400);
  }
}

function isEstimateExpired(input: {
  status: EstimateStatus;
  validUntil: Date | null;
  now?: Date;
}): boolean {
  if (input.status === "APPROVED" || input.status === "DECLINED" || input.status === "CONVERTED") {
    return false;
  }

  const now = input.now || new Date();
  return Boolean(input.validUntil && input.validUntil.getTime() < now.getTime());
}

async function resolvePublicLogoUrl(input: {
  orgId: string;
  logoPhotoId: string | null;
}): Promise<string | null> {
  if (!input.logoPhotoId) return null;

  const photo = await getPhotoStorageRecord({
    photoId: input.logoPhotoId,
    orgId: input.orgId,
  });

  if (!photo) return null;
  if (photo.imageDataUrl) return photo.imageDataUrl;
  if (!isR2Configured()) return null;

  const { r2, bucket } = requireR2();
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: bucket,
      Key: photo.key,
    }),
    { expiresIn: 60 },
  );
}

function assertShareStillValid(record: PublicShareRecord, actionLabel: string) {
  const now = new Date();
  if (record.estimate.archivedAt) {
    throw new AppApiError("This estimate is no longer available.", 410);
  }
  if (record.revokedAt) {
    throw new AppApiError(`This estimate link has been revoked and cannot ${actionLabel}.`, 410);
  }
  if (record.expiresAt && record.expiresAt.getTime() < now.getTime()) {
    throw new AppApiError("This estimate link has expired.", 410);
  }
}

async function getPublicShareRecordOrThrow(token: string): Promise<PublicShareRecord> {
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedToken) {
    throw new AppApiError("This estimate link is invalid.", 404);
  }

  const tokenHash = hashToken(normalizedToken);
  const share = await prisma.estimateShareLink.findUnique({
    where: { tokenHash },
    include: publicShareInclude,
  });

  if (!share) {
    throw new AppApiError("This estimate link is invalid.", 404);
  }

  return share;
}

async function serializePublicShare(record: PublicShareRecord): Promise<CustomerEstimateShareDetail> {
  const shareState = deriveEstimateShareState({
    revokedAt: record.revokedAt,
    expiresAt: record.expiresAt,
    approvedAt: record.approvedAt,
    declinedAt: record.declinedAt,
  });
  const estimateExpired = isEstimateExpired({
    status: record.estimate.status,
    validUntil: record.estimate.validUntil,
  });

  return {
    estimateId: record.estimate.id,
    estimateNumber: record.estimate.estimateNumber,
    title: record.estimate.title,
    customerName: record.estimate.customerName || "",
    siteAddress: record.estimate.siteAddress || "",
    projectType: record.estimate.projectType || "",
    description: record.estimate.description || "",
    terms: record.estimate.terms || "",
    validUntil: record.estimate.validUntil ? record.estimate.validUntil.toISOString() : null,
    status: estimateExpired ? "EXPIRED" : record.estimate.status,
    shareState: estimateExpired && shareState === "ACTIVE" ? "EXPIRED" : shareState,
    canRespond:
      shareState === "ACTIVE" &&
      !estimateExpired &&
      canCustomerRespondToEstimate(record.estimate.status),
    viewedAt: record.estimate.viewedAt ? record.estimate.viewedAt.toISOString() : null,
    customerViewedAt: record.estimate.customerViewedAt ? record.estimate.customerViewedAt.toISOString() : null,
    approvedAt: record.estimate.approvedAt ? record.estimate.approvedAt.toISOString() : null,
    declinedAt: record.estimate.declinedAt ? record.estimate.declinedAt.toISOString() : null,
    customerDecisionAt: record.estimate.customerDecisionAt ? record.estimate.customerDecisionAt.toISOString() : null,
    customerDecisionName: record.estimate.customerDecisionName || "",
    customerDecisionNote: record.estimate.customerDecisionNote || "",
    subtotal: Number(record.estimate.subtotal),
    tax: Number(record.estimate.tax),
    total: Number(record.estimate.total),
    lineItems: record.estimate.lineItems.map((line) => ({
      id: line.id,
      type: line.type,
      name: line.name,
      description: line.description || "",
      quantity: Number(line.quantity).toFixed(2).replace(/\.00$/, ""),
      unit: line.unit || "",
      unitPrice: Number(line.unitPrice),
      total: Number(line.total),
    })),
    branding: {
      name: record.estimate.org.name,
      legalName: record.estimate.org.legalName || "",
      phone: record.estimate.org.phone || "",
      email: record.estimate.org.email || "",
      website: record.estimate.org.website || "",
      logoUrl: await resolvePublicLogoUrl({
        orgId: record.estimate.org.id,
        logoPhotoId: record.estimate.org.logoPhotoId,
      }),
    },
  };
}

function ensureDecisionAllowed(record: PublicShareRecord, action: "approve" | "decline") {
  assertShareStillValid(record, `${action} the estimate`);

  if (isEstimateExpired({ status: record.estimate.status, validUntil: record.estimate.validUntil })) {
    throw new AppApiError("This estimate has expired and can no longer be approved or declined.", 409);
  }

  if (action === "approve") {
    if (record.estimate.status === "APPROVED" || record.estimate.status === "CONVERTED") {
      return;
    }
    if (record.estimate.status === "DECLINED") {
      throw new AppApiError("This estimate was already declined and cannot be approved from this link.", 409);
    }
  } else {
    if (record.estimate.status === "DECLINED") {
      return;
    }
    if (record.estimate.status === "APPROVED" || record.estimate.status === "CONVERTED") {
      throw new AppApiError("This estimate was already approved and cannot be declined from this link.", 409);
    }
  }

  if (!canCustomerRespondToEstimate(record.estimate.status)) {
    throw new AppApiError(`This estimate cannot be ${action}d from its current status.`, 409);
  }
}

export async function createEstimateShareLink(input: {
  orgId: string;
  estimateId: string;
  actorId: string | null;
  baseUrl: string;
  payload?: {
    recipientName?: unknown;
    recipientEmail?: unknown;
    recipientPhoneE164?: unknown;
    expiresAt?: unknown;
  } | null;
}): Promise<{
  estimate: EstimateDetail;
  shareUrl: string;
  expiresAt: string | null;
}> {
  const estimate = await prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      orgId: true,
      status: true,
      validUntil: true,
      archivedAt: true,
    },
  });

  if (!estimate) {
    throw new AppApiError("Estimate not found.", 404);
  }

  ensureEstimateShareable(estimate);

  const payload = input.payload || {};
  const recipientName = normalizeShareText(payload.recipientName, "Recipient name", ESTIMATE_SHARE_RECIPIENT_NAME_MAX);
  const recipientEmail = normalizeShareText(payload.recipientEmail, "Recipient email", ESTIMATE_SHARE_RECIPIENT_EMAIL_MAX);
  const recipientPhoneE164 = normalizeShareText(payload.recipientPhoneE164, "Recipient phone", ESTIMATE_SHARE_RECIPIENT_PHONE_MAX);
  const explicitExpiry = normalizeOptionalDate(payload.expiresAt, "Share expiration");
  const now = new Date();
  const expiresAt =
    explicitExpiry && explicitExpiry.getTime() > now.getTime()
      ? explicitExpiry
      : deriveShareExpiry({ validUntil: estimate.validUntil, now });
  const { token, tokenHash } = createEstimateShareToken();

  const savedEstimate = await prisma.$transaction(async (tx) => {
    await tx.estimateShareLink.updateMany({
      where: {
        orgId: input.orgId,
        estimateId: input.estimateId,
        revokedAt: null,
        approvedAt: null,
        declinedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    const share = await tx.estimateShareLink.create({
      data: {
        orgId: input.orgId,
        estimateId: input.estimateId,
        createdByUserId: input.actorId,
        tokenHash,
        recipientName,
        recipientEmail,
        recipientPhoneE164,
        expiresAt,
      },
      select: {
        id: true,
      },
    });

    await tx.estimate.update({
      where: { id: input.estimateId },
      data: {
        sharedAt: now,
        shareExpiresAt: expiresAt,
      },
    });

    await appendEstimateActivity(tx, {
      estimateId: input.estimateId,
      type: "SHARE_LINK_CREATED",
      actorUserId: input.actorId,
      metadata: {
        shareLinkId: share.id,
        recipientName,
        recipientEmail,
        recipientPhoneE164,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    });

    const reloaded = await tx.estimate.findUnique({
      where: { id: input.estimateId },
      include: estimateDetailInclude,
    });

    if (!reloaded) {
      throw new Error("Failed to reload estimate after generating share link.");
    }

    return reloaded;
  });

  const normalizedBaseUrl = input.baseUrl.replace(/\/$/, "");
  return {
    estimate: serializeEstimateDetail(savedEstimate),
    shareUrl: `${normalizedBaseUrl}/estimate/${token}`,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}

export async function revokeEstimateShareLinks(input: {
  orgId: string;
  estimateId: string;
  actorId: string | null;
}): Promise<EstimateDetail> {
  const estimate = await prisma.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
    },
    select: {
      id: true,
    },
  });

  if (!estimate) {
    throw new AppApiError("Estimate not found.", 404);
  }

  const savedEstimate = await prisma.$transaction(async (tx) => {
    const revoked = await tx.estimateShareLink.updateMany({
      where: {
        orgId: input.orgId,
        estimateId: input.estimateId,
        revokedAt: null,
        approvedAt: null,
        declinedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.estimate.update({
      where: { id: input.estimateId },
      data: {
        shareExpiresAt: null,
      },
    });

    await appendEstimateActivity(tx, {
      estimateId: input.estimateId,
      type: "SHARE_LINK_REVOKED",
      actorUserId: input.actorId,
      metadata: {
        revokedCount: revoked.count,
      },
    });

    const reloaded = await tx.estimate.findUnique({
      where: { id: input.estimateId },
      include: estimateDetailInclude,
    });

    if (!reloaded) {
      throw new Error("Failed to reload estimate after revoking share links.");
    }

    return reloaded;
  });

  return serializeEstimateDetail(savedEstimate);
}

export async function getEstimateShareByToken(token: string): Promise<CustomerEstimateShareDetail> {
  const record = await getPublicShareRecordOrThrow(token);
  assertShareStillValid(record, "be opened");
  return serializePublicShare(record);
}

export async function recordEstimateShareView(token: string): Promise<CustomerEstimateShareDetail> {
  const record = await getPublicShareRecordOrThrow(token);
  assertShareStillValid(record, "be viewed");
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.estimateShareLink.update({
      where: { id: record.id },
      data: {
        firstViewedAt: record.firstViewedAt || now,
        lastViewedAt: now,
      },
    });

    const nextStatus = record.estimate.status === "SENT" && canTransitionEstimateStatus("SENT", "VIEWED") ? "VIEWED" : record.estimate.status;
    await tx.estimate.update({
      where: { id: record.estimate.id },
      data: {
        status: nextStatus,
        viewedAt: record.estimate.viewedAt || now,
        customerViewedAt: record.estimate.customerViewedAt || now,
      },
    });

    await appendEstimateActivity(tx, {
      estimateId: record.estimate.id,
      type: "VIEWED",
      actorUserId: null,
      metadata: {
        shareLinkId: record.id,
      },
    });
  });

  return getEstimateShareByToken(token);
}

export async function approveEstimateShare(input: {
  token: string;
  decisionName?: unknown;
  decisionNote?: unknown;
}): Promise<CustomerEstimateShareDetail> {
  const record = await getPublicShareRecordOrThrow(input.token);
  ensureDecisionAllowed(record, "approve");

  if (record.estimate.status === "APPROVED" || record.estimate.status === "CONVERTED") {
    return serializePublicShare(record);
  }

  const decisionName = normalizeShareText(input.decisionName, "Customer name", ESTIMATE_SHARE_DECISION_NAME_MAX);
  const decisionNote = normalizeShareText(input.decisionNote, "Customer note", ESTIMATE_SHARE_DECISION_NOTE_MAX);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const currentShare = await tx.estimateShareLink.findUnique({
      where: { id: record.id },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        firstViewedAt: true,
        approvedAt: true,
        declinedAt: true,
      },
    });
    if (!currentShare) {
      throw new AppApiError("This estimate link is invalid.", 404);
    }
    if (currentShare.revokedAt) {
      throw new AppApiError("This estimate link has been revoked and cannot approve the estimate.", 410);
    }
    if (currentShare.expiresAt && currentShare.expiresAt.getTime() < now.getTime()) {
      throw new AppApiError("This estimate link has expired.", 410);
    }
    if (currentShare.declinedAt) {
      throw new AppApiError("This estimate was already declined and cannot be approved from this link.", 409);
    }
    if (currentShare.approvedAt) {
      return;
    }

    const currentEstimate = await tx.estimate.findUnique({
      where: { id: record.estimate.id },
      select: {
        id: true,
        status: true,
        validUntil: true,
        viewedAt: true,
        customerViewedAt: true,
        approvedAt: true,
        archivedAt: true,
      },
    });
    if (!currentEstimate) {
      throw new AppApiError("Estimate not found.", 404);
    }
    if (currentEstimate.archivedAt) {
      throw new AppApiError("This estimate is no longer available.", 410);
    }
    if (isEstimateExpired({ status: currentEstimate.status, validUntil: currentEstimate.validUntil, now })) {
      throw new AppApiError("This estimate has expired and can no longer be approved or declined.", 409);
    }
    if (currentEstimate.status === "DECLINED") {
      throw new AppApiError("This estimate was already declined and cannot be approved from this link.", 409);
    }
    if (currentEstimate.status === "APPROVED" || currentEstimate.status === "CONVERTED") {
      return;
    }
    if (!canCustomerRespondToEstimate(currentEstimate.status)) {
      throw new AppApiError("This estimate cannot be approved from its current status.", 409);
    }

    const updatedEstimate = await tx.estimate.updateMany({
      where: {
        id: record.estimate.id,
        status: {
          in: ["DRAFT", "SENT", "VIEWED"],
        },
        approvedAt: null,
        declinedAt: null,
      },
      data: {
        status: "APPROVED",
        viewedAt: currentEstimate.viewedAt || now,
        customerViewedAt: currentEstimate.customerViewedAt || now,
        approvedAt: currentEstimate.approvedAt || now,
        customerDecisionAt: now,
        customerDecisionName: decisionName,
        customerDecisionNote: decisionNote,
      },
    });
    if (updatedEstimate.count !== 1) {
      throw new AppApiError("This estimate was updated by another response. Refresh and try again.", 409);
    }

    const updatedShare = await tx.estimateShareLink.updateMany({
      where: {
        id: record.id,
        revokedAt: null,
        approvedAt: null,
        declinedAt: null,
      },
      data: {
        firstViewedAt: currentShare.firstViewedAt || now,
        lastViewedAt: now,
        approvedAt: now,
        decisionName,
        decisionNote,
      },
    });
    if (updatedShare.count !== 1) {
      throw new AppApiError("This estimate was updated by another response. Refresh and try again.", 409);
    }

    await appendEstimateActivity(tx, {
      estimateId: record.estimate.id,
      type: "APPROVED",
      actorUserId: null,
      metadata: {
        shareLinkId: record.id,
        decisionName,
        customerName: decisionName,
        decisionNote,
      },
    });
  });

  return getEstimateShareByToken(input.token);
}

export async function declineEstimateShare(input: {
  token: string;
  decisionName?: unknown;
  decisionNote?: unknown;
}): Promise<CustomerEstimateShareDetail> {
  const record = await getPublicShareRecordOrThrow(input.token);
  ensureDecisionAllowed(record, "decline");

  if (record.estimate.status === "DECLINED") {
    return serializePublicShare(record);
  }

  const decisionName = normalizeShareText(input.decisionName, "Customer name", ESTIMATE_SHARE_DECISION_NAME_MAX);
  const decisionNote = normalizeShareText(input.decisionNote, "Customer note", ESTIMATE_SHARE_DECISION_NOTE_MAX);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const currentShare = await tx.estimateShareLink.findUnique({
      where: { id: record.id },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        firstViewedAt: true,
        approvedAt: true,
        declinedAt: true,
      },
    });
    if (!currentShare) {
      throw new AppApiError("This estimate link is invalid.", 404);
    }
    if (currentShare.revokedAt) {
      throw new AppApiError("This estimate link has been revoked and cannot decline the estimate.", 410);
    }
    if (currentShare.expiresAt && currentShare.expiresAt.getTime() < now.getTime()) {
      throw new AppApiError("This estimate link has expired.", 410);
    }
    if (currentShare.approvedAt) {
      throw new AppApiError("This estimate was already approved and cannot be declined from this link.", 409);
    }
    if (currentShare.declinedAt) {
      return;
    }

    const currentEstimate = await tx.estimate.findUnique({
      where: { id: record.estimate.id },
      select: {
        id: true,
        status: true,
        validUntil: true,
        viewedAt: true,
        customerViewedAt: true,
        declinedAt: true,
        archivedAt: true,
      },
    });
    if (!currentEstimate) {
      throw new AppApiError("Estimate not found.", 404);
    }
    if (currentEstimate.archivedAt) {
      throw new AppApiError("This estimate is no longer available.", 410);
    }
    if (isEstimateExpired({ status: currentEstimate.status, validUntil: currentEstimate.validUntil, now })) {
      throw new AppApiError("This estimate has expired and can no longer be approved or declined.", 409);
    }
    if (currentEstimate.status === "APPROVED" || currentEstimate.status === "CONVERTED") {
      throw new AppApiError("This estimate was already approved and cannot be declined from this link.", 409);
    }
    if (currentEstimate.status === "DECLINED") {
      return;
    }
    if (!canCustomerRespondToEstimate(currentEstimate.status)) {
      throw new AppApiError("This estimate cannot be declined from its current status.", 409);
    }

    const updatedEstimate = await tx.estimate.updateMany({
      where: {
        id: record.estimate.id,
        status: {
          in: ["DRAFT", "SENT", "VIEWED"],
        },
        approvedAt: null,
        declinedAt: null,
      },
      data: {
        status: "DECLINED",
        viewedAt: currentEstimate.viewedAt || now,
        customerViewedAt: currentEstimate.customerViewedAt || now,
        declinedAt: currentEstimate.declinedAt || now,
        customerDecisionAt: now,
        customerDecisionName: decisionName,
        customerDecisionNote: decisionNote,
      },
    });
    if (updatedEstimate.count !== 1) {
      throw new AppApiError("This estimate was updated by another response. Refresh and try again.", 409);
    }

    const updatedShare = await tx.estimateShareLink.updateMany({
      where: {
        id: record.id,
        revokedAt: null,
        approvedAt: null,
        declinedAt: null,
      },
      data: {
        firstViewedAt: currentShare.firstViewedAt || now,
        lastViewedAt: now,
        declinedAt: now,
        decisionName,
        decisionNote,
      },
    });
    if (updatedShare.count !== 1) {
      throw new AppApiError("This estimate was updated by another response. Refresh and try again.", 409);
    }

    await appendEstimateActivity(tx, {
      estimateId: record.estimate.id,
      type: "DECLINED",
      actorUserId: null,
      metadata: {
        shareLinkId: record.id,
        decisionName,
        customerName: decisionName,
        decisionNote,
      },
    });
  });

  return getEstimateShareByToken(input.token);
}
