import "server-only";

import { randomBytes } from "node:crypto";
import { BuyerProjectStage, BuyerProjectType, Prisma } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import {
  formatChangeOrderStatusLabel,
  formatContractProjectStatusLabel,
  formatPaymentMilestoneStatusLabel,
} from "@/lib/contract-projects";
import type { NormalizedWebsiteLeadPayload } from "@/lib/public-website-leads";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export type BuyerProjectMilestoneState = "complete" | "current" | "upcoming";

export type BuyerProjectMilestone = {
  key: BuyerProjectStage;
  label: string;
  detail: string;
  buyerPrompt: string;
  state: BuyerProjectMilestoneState;
};

export type PublicBuyerProjectDetail = {
  projectId: string;
  projectName: string;
  buyerName: string;
  projectTypeLabel: string;
  currentStage: BuyerProjectStage;
  currentStageLabel: string;
  budgetRange: string | null;
  financingStatus: string | null;
  landStatus: string | null;
  timeline: string | null;
  buyerGoal: string | null;
  buyerNextStep: string | null;
  publicNotes: string | null;
  selectedHome: {
    title: string | null;
    type: string | null;
    priceLabel: string | null;
    beds: number | null;
    bathsLabel: string | null;
    sqft: number | null;
    status: string | null;
    locationLabel: string | null;
    modelSeries: string | null;
    url: string | null;
  };
  contractProject: {
    statusLabel: string;
    changeOrderStatusLabel: string;
    paymentStatusLabel: string;
    contractDocumentUrl: string | null;
    contractDocumentLabel: string | null;
    depositDueCents: number | null;
    contractSignedAt: string | null;
    depositPaidAt: string | null;
    activeStartedAt: string | null;
    completedAt: string | null;
  } | null;
  organization: {
    name: string;
    phone: string;
    email: string;
    website: string;
  };
  milestones: BuyerProjectMilestone[];
  createdAt: string;
  updatedAt: string;
};

const buyerProjectStageOrder: BuyerProjectStage[] = [
  "COMPARE_HOMES",
  "FINANCING_BUDGET",
  "LAND_FEASIBILITY",
  "ORDER_DELIVERY",
  "SETUP_FINISH",
  "MOVE_IN",
];

const buyerProjectStageContent: Record<
  BuyerProjectStage,
  { label: string; detail: string; buyerPrompt: string }
> = {
  COMPARE_HOMES: {
    label: "Compare Homes + Floor Plans",
    detail: "Endeavor is helping narrow the home path, layout, size, and fit before the project gets locked around the wrong plan.",
    buyerPrompt: "Review the shortlisted home, floor plan, must-haves, and any alternate models you want Endeavor to compare.",
  },
  FINANCING_BUDGET: {
    label: "Financing + Budget",
    detail: "Budget, financing, and the full project scope are being lined up before deposits, delivery, and site work decisions stack up.",
    buyerPrompt: "Confirm your financing path, target monthly budget, lender status, and any hard ceiling Endeavor should protect.",
  },
  LAND_FEASIBILITY: {
    label: "Land Fit + Feasibility",
    detail: "Property access, utilities, jurisdiction requirements, setbacks, and placement constraints are being reviewed.",
    buyerPrompt: "Share the site address, parcel details, utility status, access notes, and any city or county feedback you already have.",
  },
  ORDER_DELIVERY: {
    label: "Order + Delivery Planning",
    detail: "The selected home, factory options, delivery route, schedule assumptions, and setup dependencies are being coordinated.",
    buyerPrompt: "Review the selected model, options, delivery expectations, and remaining decisions before the order path is finalized.",
  },
  SETUP_FINISH: {
    label: "Setup + Finish Work",
    detail: "Delivery, placement, trim-out, utility coordination, punch items, and field work are moving toward handoff.",
    buyerPrompt: "Watch for site access requests, walkthrough notes, utility coordination, and any selections Endeavor needs confirmed.",
  },
  MOVE_IN: {
    label: "Move-In",
    detail: "The home is moving through final walkthrough, turnover details, and move-in readiness.",
    buyerPrompt: "Review final notes, walkthrough items, warranty direction, and the practical next steps for move-in.",
  },
};

export function formatBuyerProjectStageLabel(stage: BuyerProjectStage): string {
  return buyerProjectStageContent[stage].label;
}

export function formatBuyerProjectTypeLabel(type: BuyerProjectType): string {
  if (type === "MANUFACTURED_HOME") return "Manufactured Home";
  if (type === "ADU_DADU") return "ADU / DADU";
  if (type === "PARK_MODEL") return "Park Model";
  if (type === "PRESALE") return "PreSale Opportunity";
  return "Home Project";
}

export function buildBuyerProjectMilestones(currentStage: BuyerProjectStage): BuyerProjectMilestone[] {
  const currentIndex = Math.max(0, buyerProjectStageOrder.indexOf(currentStage));
  return buyerProjectStageOrder.map((key, index) => ({
    key,
    ...buyerProjectStageContent[key],
    state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming",
  }));
}

export function createBuyerProjectShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
  };
}

function normalizeSearchText(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function inferBuyerProjectType(payload: NormalizedWebsiteLeadPayload): BuyerProjectType {
  const listing = payload.listingContext;
  const searchText = normalizeSearchText(
    listing?.collection,
    listing?.homeType,
    listing?.homeTypeSlug,
    payload.reason,
    payload.sourcePath,
    payload.message,
  );

  if (listing?.collection === "presale" || searchText.includes("presale")) return "PRESALE";
  if (searchText.includes("dadu") || searchText.includes("adu")) return "ADU_DADU";
  if (searchText.includes("park model") || searchText.includes("tiny")) return "PARK_MODEL";
  if (searchText.includes("manufactured") || searchText.includes("factory")) return "MANUFACTURED_HOME";
  return "UNKNOWN";
}

function inferInitialStage(payload: NormalizedWebsiteLeadPayload): BuyerProjectStage {
  const searchText = normalizeSearchText(payload.reason, payload.sourcePath, payload.message);
  if (searchText.includes("land") || searchText.includes("feasibility") || searchText.includes("site")) {
    return "LAND_FEASIBILITY";
  }
  if (searchText.includes("financing") || searchText.includes("budget") || payload.financingNeeded) {
    return "FINANCING_BUDGET";
  }
  return "COMPARE_HOMES";
}

function buildProjectName(input: {
  buyerName: string;
  projectType: BuyerProjectType;
  selectedHomeTitle: string | null;
}): string {
  if (input.selectedHomeTitle) {
    return `${input.buyerName} - ${input.selectedHomeTitle}`;
  }
  return `${input.buyerName} - ${formatBuyerProjectTypeLabel(input.projectType)}`;
}

function buildBuyerNextStep(payload: NormalizedWebsiteLeadPayload, stage: BuyerProjectStage): string {
  if (stage === "FINANCING_BUDGET") {
    return "Confirm financing status, target budget, and whether Endeavor should coordinate with a lender familiar with factory-built timelines.";
  }
  if (stage === "LAND_FEASIBILITY") {
    return "Share the site address, utility status, access notes, and any city or county feedback so Endeavor can review project fit.";
  }
  if (payload.listingContext?.title) {
    return `Review ${payload.listingContext.title} against your land, budget, timing, and must-have selections.`;
  }
  return "Shortlist the right home path, then confirm budget, land fit, and next decisions with Endeavor.";
}

function buildInternalNextStep(payload: NormalizedWebsiteLeadPayload): string {
  const homeTitle = payload.listingContext?.title || payload.listingSlug;
  if (homeTitle) {
    return `Follow up with the buyer about ${homeTitle}, then confirm budget, land/site status, financing, and timeline.`;
  }
  return "Follow up with the buyer, qualify project type, budget, land/site status, financing, and timeline.";
}

function buildPublicNotes(payload: NormalizedWebsiteLeadPayload): string {
  const notes = [
    payload.listingContext?.title ? `Starting point: ${payload.listingContext.title}.` : null,
    payload.budgetRange ? `Budget range shared: ${payload.budgetRange}.` : null,
    payload.timeline ? `Timeline shared: ${payload.timeline}.` : null,
  ].filter(Boolean);
  return notes.join(" ");
}

export async function createBuyerProjectForWebsiteLead(input: {
  tx: Prisma.TransactionClient;
  orgId: string;
  customerId: string;
  leadId: string;
  payload: NormalizedWebsiteLeadPayload;
  publicBaseUrl: string;
}): Promise<{ buyerProjectId: string; projectTrackingUrl: string }> {
  const projectType = inferBuyerProjectType(input.payload);
  const currentStage = inferInitialStage(input.payload);
  const listing = input.payload.listingContext;
  const selectedHomeTitle = listing?.title || null;
  const projectName = buildProjectName({
    buyerName: input.payload.name,
    projectType,
    selectedHomeTitle,
  });
  const { token, tokenHash } = createBuyerProjectShareToken();

  const project = await input.tx.buyerProject.upsert({
    where: { leadId: input.leadId },
    update: {
      customerId: input.customerId,
      projectType,
      currentStage,
      projectName,
      buyerName: input.payload.name,
      phoneE164: input.payload.phoneE164,
      email: input.payload.email || null,
      selectedHomeSlug: listing?.slug || input.payload.listingSlug || null,
      selectedHomeTitle,
      selectedHomeType: listing?.homeType || null,
      selectedHomeTypeSlug: listing?.homeTypeSlug || null,
      selectedHomeCollection: listing?.collection || null,
      selectedHomePriceLabel: listing?.priceLabel || null,
      selectedHomeBeds: listing?.beds ?? null,
      selectedHomeBathsLabel: listing?.baths || null,
      selectedHomeSqft: listing?.sqft ?? null,
      selectedHomeStatus: listing?.status || null,
      selectedHomeLocationLabel: listing?.locationLabel || null,
      selectedHomeModelSeries: listing?.modelSeries || null,
      selectedHomeUrl: listing?.href || null,
      sourcePath: input.payload.sourcePath || null,
      sourcePageTitle: input.payload.pageTitle || null,
      budgetRange: input.payload.budgetRange || null,
      financingStatus: input.payload.financingNeeded || null,
      landStatus: "Not reviewed yet",
      timeline: input.payload.timeline || null,
      buyerGoal: input.payload.message || null,
      smsOptIn: input.payload.smsOptIn,
      buyerNextStep: buildBuyerNextStep(input.payload, currentStage),
      internalNextStep: buildInternalNextStep(input.payload),
      publicNotes: buildPublicNotes(input.payload) || null,
    },
    create: {
      orgId: input.orgId,
      customerId: input.customerId,
      leadId: input.leadId,
      projectType,
      currentStage,
      projectName,
      buyerName: input.payload.name,
      phoneE164: input.payload.phoneE164,
      email: input.payload.email || null,
      selectedHomeSlug: listing?.slug || input.payload.listingSlug || null,
      selectedHomeTitle,
      selectedHomeType: listing?.homeType || null,
      selectedHomeTypeSlug: listing?.homeTypeSlug || null,
      selectedHomeCollection: listing?.collection || null,
      selectedHomePriceLabel: listing?.priceLabel || null,
      selectedHomeBeds: listing?.beds ?? null,
      selectedHomeBathsLabel: listing?.baths || null,
      selectedHomeSqft: listing?.sqft ?? null,
      selectedHomeStatus: listing?.status || null,
      selectedHomeLocationLabel: listing?.locationLabel || null,
      selectedHomeModelSeries: listing?.modelSeries || null,
      selectedHomeUrl: listing?.href || null,
      sourcePath: input.payload.sourcePath || null,
      sourcePageTitle: input.payload.pageTitle || null,
      budgetRange: input.payload.budgetRange || null,
      financingStatus: input.payload.financingNeeded || null,
      landStatus: "Not reviewed yet",
      timeline: input.payload.timeline || null,
      buyerGoal: input.payload.message || null,
      smsOptIn: input.payload.smsOptIn,
      buyerNextStep: buildBuyerNextStep(input.payload, currentStage),
      internalNextStep: buildInternalNextStep(input.payload),
      publicNotes: buildPublicNotes(input.payload) || null,
    },
    select: { id: true },
  });

  await input.tx.buyerProjectShareLink.updateMany({
    where: {
      orgId: input.orgId,
      buyerProjectId: project.id,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  await input.tx.buyerProjectShareLink.create({
    data: {
      orgId: input.orgId,
      buyerProjectId: project.id,
      tokenHash,
    },
  });

  return {
    buyerProjectId: project.id,
    projectTrackingUrl: `${input.publicBaseUrl.replace(/\/$/, "")}/buyer-project/${token}`,
  };
}

export async function getBuyerProjectByToken(token: string): Promise<PublicBuyerProjectDetail> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new AppApiError("This project link is invalid.", 404);
  }

  const record = await prisma.buyerProjectShareLink.findUnique({
    where: { tokenHash: hashToken(normalizedToken) },
    include: {
      buyerProject: {
        include: {
          org: {
            select: {
              name: true,
              phone: true,
              email: true,
              website: true,
            },
          },
          contractProject: true,
        },
      },
    },
  });

  if (!record) {
    throw new AppApiError("This project link is invalid.", 404);
  }
  if (record.revokedAt) {
    throw new AppApiError("This project link has been replaced with a newer link.", 410);
  }

  const project = record.buyerProject;
  return {
    projectId: project.id,
    projectName: project.projectName,
    buyerName: project.buyerName,
    projectTypeLabel: formatBuyerProjectTypeLabel(project.projectType),
    currentStage: project.currentStage,
    currentStageLabel: formatBuyerProjectStageLabel(project.currentStage),
    budgetRange: project.budgetRange,
    financingStatus: project.financingStatus,
    landStatus: project.landStatus,
    timeline: project.timeline,
    buyerGoal: project.buyerGoal,
    buyerNextStep: project.buyerNextStep,
    publicNotes: project.publicNotes,
    selectedHome: {
      title: project.selectedHomeTitle,
      type: project.selectedHomeType,
      priceLabel: project.selectedHomePriceLabel,
      beds: project.selectedHomeBeds,
      bathsLabel: project.selectedHomeBathsLabel,
      sqft: project.selectedHomeSqft,
      status: project.selectedHomeStatus,
      locationLabel: project.selectedHomeLocationLabel,
      modelSeries: project.selectedHomeModelSeries,
      url: project.selectedHomeUrl,
    },
    contractProject: project.contractProject
      ? {
          statusLabel: formatContractProjectStatusLabel(project.contractProject.contractStatus),
          changeOrderStatusLabel: formatChangeOrderStatusLabel(project.contractProject.changeOrderStatus),
          paymentStatusLabel: formatPaymentMilestoneStatusLabel(project.contractProject.paymentStatus),
          contractDocumentUrl: project.contractProject.contractDocumentUrl,
          contractDocumentLabel: project.contractProject.contractDocumentLabel,
          depositDueCents: project.contractProject.depositDueCents,
          contractSignedAt: project.contractProject.contractSignedAt?.toISOString() || null,
          depositPaidAt: project.contractProject.depositPaidAt?.toISOString() || null,
          activeStartedAt: project.contractProject.activeStartedAt?.toISOString() || null,
          completedAt: project.contractProject.completedAt?.toISOString() || null,
        }
      : null,
    organization: {
      name: project.org.name,
      phone: project.org.phone || "",
      email: project.org.email || "",
      website: project.org.website || "",
    },
    milestones: buildBuyerProjectMilestones(project.currentStage),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
