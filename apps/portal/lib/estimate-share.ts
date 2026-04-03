import { randomBytes } from "node:crypto";
import type { EstimateStatus } from "@prisma/client";
import { hashToken } from "./tokens";

export const ESTIMATE_SHARE_RECIPIENT_NAME_MAX = 160;
export const ESTIMATE_SHARE_RECIPIENT_EMAIL_MAX = 240;
export const ESTIMATE_SHARE_RECIPIENT_PHONE_MAX = 40;
export const ESTIMATE_SHARE_DECISION_NAME_MAX = 160;
export const ESTIMATE_SHARE_DECISION_NOTE_MAX = 2000;

export type EstimateShareState = "ACTIVE" | "REVOKED" | "EXPIRED" | "APPROVED" | "DECLINED";

export type CustomerEstimateShareLineItem = {
  id: string;
  type: string;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: number;
  total: number;
};

export type CustomerEstimateShareDetail = {
  estimateId: string;
  estimateNumber: string;
  title: string;
  customerName: string;
  siteAddress: string;
  projectType: string;
  description: string;
  terms: string;
  validUntil: string | null;
  status: EstimateStatus;
  shareState: EstimateShareState;
  canRespond: boolean;
  viewedAt: string | null;
  customerViewedAt: string | null;
  approvedAt: string | null;
  declinedAt: string | null;
  customerDecisionAt: string | null;
  customerDecisionName: string;
  customerDecisionNote: string;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: CustomerEstimateShareLineItem[];
  branding: {
    name: string;
    legalName: string;
    phone: string;
    email: string;
    website: string;
    logoUrl: string | null;
  };
};

export function createEstimateShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
  };
}

export function canCreateEstimateShare(status: EstimateStatus): boolean {
  return status === "DRAFT" || status === "SENT" || status === "VIEWED" || status === "APPROVED";
}

export function canCustomerRespondToEstimate(status: EstimateStatus): boolean {
  return status === "DRAFT" || status === "SENT" || status === "VIEWED";
}

export function normalizeOptionalShareText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or less.`);
  }
  return trimmed;
}

export function deriveEstimateShareState(input: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  approvedAt: Date | null;
  declinedAt: Date | null;
}): EstimateShareState {
  if (input.revokedAt) return "REVOKED";
  if (input.approvedAt) return "APPROVED";
  if (input.declinedAt) return "DECLINED";
  if (input.expiresAt && input.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "ACTIVE";
}

export function deriveShareExpiry(input: {
  validUntil: Date | null;
  now?: Date;
}): Date | null {
  const now = input.now || new Date();
  if (input.validUntil && input.validUntil.getTime() > now.getTime()) {
    return input.validUntil;
  }

  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
}

export function buildEstimateShareEmailDraft(input: {
  estimate: {
    estimateNumber: string;
    title: string;
    customerName: string;
    siteAddress: string;
    projectType: string;
    total: number;
    validUntil: string | null;
  };
  shareUrl: string;
  recipientName?: string | null;
  senderName?: string | null;
}): {
  subject: string;
  body: string;
} {
  const recipient = input.recipientName?.trim() || input.estimate.customerName || "there";
  const senderName = input.senderName?.trim() || "TieGui";
  const lines = [
    `Hi ${recipient},`,
    "",
    `${senderName} shared estimate ${input.estimate.estimateNumber} with you.`,
    "",
    `Project: ${input.estimate.title}`,
    ...(input.estimate.siteAddress ? [`Site: ${input.estimate.siteAddress}`] : []),
    ...(input.estimate.projectType ? [`Type: ${input.estimate.projectType}`] : []),
    `Total: $${input.estimate.total.toFixed(2)}`,
    ...(input.estimate.validUntil ? [`Valid until: ${new Date(input.estimate.validUntil).toLocaleDateString("en-US")}`] : []),
    "",
    "Review and respond here:",
    input.shareUrl,
    "",
    "You can approve or decline the estimate from that link.",
  ];

  return {
    subject: `${input.estimate.estimateNumber} • ${input.estimate.title}`,
    body: lines.join("\n"),
  };
}
