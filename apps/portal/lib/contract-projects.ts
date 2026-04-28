import "server-only";

import type {
  ChangeOrderStatus,
  ContractProjectStatus,
  PaymentMilestoneStatus,
} from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { prisma } from "@/lib/prisma";

export const contractProjectStatusOptions: ContractProjectStatus[] = [
  "DRAFT",
  "SENT",
  "SIGNED",
  "DEPOSIT_PAID",
  "ACTIVE",
  "COMPLETE",
];

export const changeOrderStatusOptions: ChangeOrderStatus[] = [
  "NONE",
  "DRAFT",
  "SENT",
  "APPROVED",
  "DECLINED",
  "COMPLETED",
];

export const paymentMilestoneStatusOptions: PaymentMilestoneStatus[] = [
  "NOT_STARTED",
  "DEPOSIT_PENDING",
  "DEPOSIT_PAID",
  "PROGRESS_PAYMENT_DUE",
  "PAID_IN_FULL",
];

const contractProjectStatusLabels: Record<ContractProjectStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  SIGNED: "Signed",
  DEPOSIT_PAID: "Deposit Paid",
  ACTIVE: "Active",
  COMPLETE: "Complete",
};

const changeOrderStatusLabels: Record<ChangeOrderStatus, string> = {
  NONE: "No Change Orders",
  DRAFT: "Change Draft",
  SENT: "Change Sent",
  APPROVED: "Change Approved",
  DECLINED: "Change Declined",
  COMPLETED: "Change Complete",
};

const paymentMilestoneStatusLabels: Record<PaymentMilestoneStatus, string> = {
  NOT_STARTED: "Payment Not Started",
  DEPOSIT_PENDING: "Deposit Pending",
  DEPOSIT_PAID: "Deposit Paid",
  PROGRESS_PAYMENT_DUE: "Progress Payment Due",
  PAID_IN_FULL: "Paid In Full",
};

export function formatContractProjectStatusLabel(status: ContractProjectStatus): string {
  return contractProjectStatusLabels[status];
}

export function formatChangeOrderStatusLabel(status: ChangeOrderStatus): string {
  return changeOrderStatusLabels[status];
}

export function formatPaymentMilestoneStatusLabel(status: PaymentMilestoneStatus): string {
  return paymentMilestoneStatusLabels[status];
}

function requireContractProjectStatus(value: string): ContractProjectStatus {
  const normalized = value.trim().toUpperCase();
  if (contractProjectStatusOptions.includes(normalized as ContractProjectStatus)) {
    return normalized as ContractProjectStatus;
  }
  throw new AppApiError("Invalid contract status.", 400);
}

function requireChangeOrderStatus(value: string): ChangeOrderStatus {
  const normalized = value.trim().toUpperCase();
  if (changeOrderStatusOptions.includes(normalized as ChangeOrderStatus)) {
    return normalized as ChangeOrderStatus;
  }
  throw new AppApiError("Invalid change order status.", 400);
}

function requirePaymentMilestoneStatus(value: string): PaymentMilestoneStatus {
  const normalized = value.trim().toUpperCase();
  if (paymentMilestoneStatusOptions.includes(normalized as PaymentMilestoneStatus)) {
    return normalized as PaymentMilestoneStatus;
  }
  throw new AppApiError("Invalid payment status.", 400);
}

function normalizeOptionalText(value: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeOptionalHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppApiError("Contract document link must be a valid URL.", 400);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppApiError("Contract document link must use http or https.", 400);
  }

  return parsed.toString();
}

function normalizeOptionalDepositCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppApiError("Deposit amount must be a valid positive number.", 400);
  }

  return Math.round(parsed * 100);
}

function statusHasSigned(status: ContractProjectStatus): boolean {
  return status === "SIGNED" || status === "DEPOSIT_PAID" || status === "ACTIVE" || status === "COMPLETE";
}

function statusHasDeposit(status: ContractProjectStatus, paymentStatus: PaymentMilestoneStatus): boolean {
  return (
    status === "DEPOSIT_PAID" ||
    status === "ACTIVE" ||
    status === "COMPLETE" ||
    paymentStatus === "DEPOSIT_PAID" ||
    paymentStatus === "PAID_IN_FULL"
  );
}

function buildContractInternalNextStep(input: {
  contractStatus: ContractProjectStatus;
  paymentStatus: PaymentMilestoneStatus;
  changeOrderStatus: ChangeOrderStatus;
}): string {
  if (input.contractStatus === "DRAFT") {
    return "Finish the contract package, confirm selected home context, and send the contract for review.";
  }
  if (input.contractStatus === "SENT") {
    return "Watch for signature, answer buyer questions, and keep deposit terms clear.";
  }
  if (input.contractStatus === "SIGNED") {
    return "Contract is signed. Confirm deposit collection and prepare the active build handoff.";
  }
  if (input.contractStatus === "DEPOSIT_PAID") {
    return "Deposit is paid. Move the project into active build planning and keep delivery/setup dependencies current.";
  }
  if (input.contractStatus === "ACTIVE") {
    if (input.changeOrderStatus === "DRAFT" || input.changeOrderStatus === "SENT") {
      return "Active build is underway. Resolve open change order decisions and keep the buyer timeline current.";
    }
    return "Active build is underway. Keep change orders, progress payments, and buyer updates current.";
  }
  if (input.contractStatus === "COMPLETE") {
    return "Contract project is complete. Confirm final documents, payment closeout, and customer handoff notes.";
  }
  if (input.paymentStatus === "DEPOSIT_PENDING") {
    return "Confirm deposit collection and prepare the active build handoff.";
  }
  return "Keep contract status, payment milestones, and buyer updates current.";
}

export async function createContractProjectFromBuyerProject(input: {
  orgId: string;
  buyerProjectId: string;
  actorId: string;
}): Promise<{ contractProjectId: string }> {
  const buyerProjectId = input.buyerProjectId.trim();
  if (!buyerProjectId) {
    throw new AppApiError("Buyer project is required.", 400);
  }

  const buyerProject = await prisma.buyerProject.findFirst({
    where: {
      id: buyerProjectId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      customerId: true,
      leadId: true,
      selectedHomeTitle: true,
      org: {
        select: {
          portalVertical: true,
        },
      },
    },
  });

  if (!buyerProject) {
    throw new AppApiError("Buyer project not found.", 404);
  }

  if (buyerProject.org.portalVertical !== "HOMEBUILDER") {
    throw new AppApiError("Contract projects are only available for homebuilder workspaces.", 403);
  }

  const result = await prisma.$transaction(async (tx) => {
    const contractProject = await tx.contractProject.upsert({
      where: { buyerProjectId: buyerProject.id },
      update: {
        customerId: buyerProject.customerId,
        leadId: buyerProject.leadId,
      },
      create: {
        orgId: input.orgId,
        buyerProjectId: buyerProject.id,
        customerId: buyerProject.customerId,
        leadId: buyerProject.leadId,
        createdByUserId: input.actorId,
        contractStatus: "DRAFT",
        changeOrderStatus: "NONE",
        paymentStatus: "DEPOSIT_PENDING",
        internalNextStep: "Prepare and send the contract, confirm deposit terms, and attach the contract document link.",
      },
      select: { id: true },
    });

    await tx.buyerProject.update({
      where: { id: buyerProject.id },
      data: {
        currentStage: "ORDER_DELIVERY",
        buyerNextStep: buyerProject.selectedHomeTitle
          ? `Review the contract path for ${buyerProject.selectedHomeTitle}, confirm deposit timing, and watch for remaining delivery or site-readiness decisions.`
          : "Review the contract path, confirm deposit timing, and watch for remaining delivery or site-readiness decisions.",
        internalNextStep: "Contract project opened. Keep the selected home, deposit, change orders, and buyer communications current.",
      },
    });

    return contractProject;
  });

  return { contractProjectId: result.id };
}

export async function updateContractProject(input: {
  orgId: string;
  contractProjectId: string;
  contractStatus: string;
  changeOrderStatus: string;
  paymentStatus: string;
  contractDocumentUrl: string;
  contractDocumentLabel: string;
  depositDueDollars: string;
}): Promise<{ contractProjectId: string }> {
  const contractProjectId = input.contractProjectId.trim();
  if (!contractProjectId) {
    throw new AppApiError("Contract project is required.", 400);
  }

  const contractStatus = requireContractProjectStatus(input.contractStatus);
  const changeOrderStatus = requireChangeOrderStatus(input.changeOrderStatus);
  const paymentStatus = requirePaymentMilestoneStatus(input.paymentStatus);
  const contractDocumentUrl = normalizeOptionalHttpUrl(input.contractDocumentUrl);
  const contractDocumentLabel = normalizeOptionalText(input.contractDocumentLabel, 120);
  const depositDueCents = normalizeOptionalDepositCents(input.depositDueDollars);

  const existing = await prisma.contractProject.findFirst({
    where: {
      id: contractProjectId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      contractSignedAt: true,
      depositPaidAt: true,
      activeStartedAt: true,
      completedAt: true,
      buyerProjectId: true,
      org: {
        select: {
          portalVertical: true,
        },
      },
    },
  });

  if (!existing) {
    throw new AppApiError("Contract project not found.", 404);
  }

  if (existing.org.portalVertical !== "HOMEBUILDER") {
    throw new AppApiError("Contract projects are only available for homebuilder workspaces.", 403);
  }

  const now = new Date();
  const buyerStage =
    contractStatus === "COMPLETE"
      ? "MOVE_IN"
      : contractStatus === "ACTIVE"
        ? "SETUP_FINISH"
        : "ORDER_DELIVERY";

  const updated = await prisma.$transaction(async (tx) => {
    const contractProject = await tx.contractProject.update({
      where: { id: existing.id },
      data: {
        contractStatus,
        changeOrderStatus,
        paymentStatus,
        contractDocumentUrl,
        contractDocumentLabel,
        depositDueCents,
        contractSignedAt: statusHasSigned(contractStatus) && !existing.contractSignedAt ? now : undefined,
        depositPaidAt: statusHasDeposit(contractStatus, paymentStatus) && !existing.depositPaidAt ? now : undefined,
        activeStartedAt:
          (contractStatus === "ACTIVE" || contractStatus === "COMPLETE") && !existing.activeStartedAt ? now : undefined,
        completedAt: contractStatus === "COMPLETE" && !existing.completedAt ? now : undefined,
        internalNextStep: buildContractInternalNextStep({
          contractStatus,
          paymentStatus,
          changeOrderStatus,
        }),
      },
      select: { id: true },
    });

    await tx.buyerProject.update({
      where: { id: existing.buyerProjectId },
      data: {
        currentStage: buyerStage,
      },
    });

    return contractProject;
  });

  return { contractProjectId: updated.id };
}
