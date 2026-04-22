import { randomBytes } from "node:crypto";
import type { EstimateStatus } from "@prisma/client";
import { formatDateForDisplay } from "@/lib/calendar/dates";
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
  return status === "SENT" || status === "VIEWED" || status === "APPROVED";
}

export function canCustomerRespondToEstimate(status: EstimateStatus): boolean {
  return status === "SENT" || status === "VIEWED";
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
  senderPhone?: string | null;
  senderEmail?: string | null;
  senderWebsite?: string | null;
}): {
  subject: string;
  body: string;
} {
  const recipient = input.recipientName?.trim() || input.estimate.customerName || "there";
  const senderName = input.senderName?.trim() || "TieGui";
  const projectLabel = input.estimate.title.trim() || "your project";
  const contactLines = [
    input.senderPhone?.trim() || "",
    input.senderEmail?.trim() || "",
    input.senderWebsite?.trim() || "",
  ].filter(Boolean);
  const lines = [
    `Hi ${recipient},`,
    "",
    `${senderName} prepared your estimate for ${projectLabel}.`,
    "",
    "Project overview",
    `- Estimate: ${input.estimate.estimateNumber}`,
    `- Project: ${projectLabel}`,
    ...(input.estimate.siteAddress ? [`- Property: ${input.estimate.siteAddress}`] : []),
    ...(input.estimate.projectType ? [`- Service: ${input.estimate.projectType}`] : []),
    "",
    "Total investment",
    `$${input.estimate.total.toFixed(2)}`,
    ...(input.estimate.validUntil ? [`Pricing valid through ${formatDateForDisplay(input.estimate.validUntil)}.`] : []),
    "",
    "What to do next",
    "Review and approve your estimate here:",
    input.shareUrl,
    "",
    `Once you approve it, ${senderName} will follow up to confirm scheduling and next steps.`,
    "",
    "If you'd like anything adjusted first, use the same link to request changes or ask a question.",
    ...(contactLines.length > 0
      ? [
          "",
          `Questions? Reach ${senderName}:`,
          ...contactLines,
        ]
      : []),
  ];

  return {
    subject: `Your estimate from ${senderName}${projectLabel ? ` • ${projectLabel}` : ""}`,
    body: lines.join("\n"),
  };
}
