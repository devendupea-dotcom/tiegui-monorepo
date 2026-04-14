export type ContractorWorkflowStage =
  | "lead_active"
  | "reply_needed"
  | "follow_up_overdue"
  | "estimate_needed"
  | "estimate_draft"
  | "estimate_revision"
  | "waiting_on_approval"
  | "ready_to_schedule"
  | "job_scheduled"
  | "awaiting_payment"
  | "paid";

export type ContractorWorkflowActionKind =
  | "open_follow_up"
  | "call_customer"
  | "create_estimate"
  | "finish_estimate"
  | "revise_estimate"
  | "schedule_job"
  | "open_operational_job"
  | "open_schedule"
  | "open_invoices"
  | "open_lead";

export type ContractorWorkflowAttentionLevel = "urgent" | "active" | "done";

export type ContractorWorkflowAction = {
  kind: ContractorWorkflowActionKind;
  label: string;
};

export type ContractorWorkflowResolution = {
  stage: ContractorWorkflowStage;
  stageLabel: string;
  stageDetail: string;
  attentionLevel: ContractorWorkflowAttentionLevel;
  nextAction: ContractorWorkflowAction;
};

export type ContractorWorkflowInput = {
  now?: Date;
  hasMessagingWorkspace: boolean;
  latestMessageDirection: "INBOUND" | "OUTBOUND" | null;
  nextFollowUpAt: Date | null;
  latestEstimateStatus: string | null;
  hasScheduledJob: boolean;
  hasOperationalJob: boolean;
  hasLatestInvoice: boolean;
  hasOpenInvoice: boolean;
  latestInvoicePaid: boolean;
};

export type ContractorWorkflowActionTargetInput = {
  action: ContractorWorkflowAction;
  messagesHref: string;
  phoneHref: string | null;
  createEstimateHref: string;
  latestEstimateHref: string | null;
  scheduleCalendarHref: string;
  operationalJobHref: string | null;
  invoiceHref: string;
  overviewHref: string;
};

export type ContractorWorkflowActionTarget = {
  href: string;
  external?: boolean;
};

function isOverdue(value: Date | null | undefined, now: Date): boolean {
  if (!value) return false;
  return value.getTime() < now.getTime();
}

function buildContactAction(hasMessagingWorkspace: boolean): ContractorWorkflowAction {
  return hasMessagingWorkspace
    ? { kind: "open_follow_up", label: "Open Follow-up" }
    : { kind: "call_customer", label: "Call Customer" };
}

function buildStage(
  stage: ContractorWorkflowStage,
  stageLabel: string,
  stageDetail: string,
  attentionLevel: ContractorWorkflowAttentionLevel,
  nextAction: ContractorWorkflowAction,
): ContractorWorkflowResolution {
  return {
    stage,
    stageLabel,
    stageDetail,
    attentionLevel,
    nextAction,
  };
}

export function resolveContractorWorkflow(input: ContractorWorkflowInput): ContractorWorkflowResolution {
  const now = input.now || new Date();
  const contactAction = buildContactAction(input.hasMessagingWorkspace);

  if (input.latestMessageDirection === "INBOUND") {
    return buildStage(
      "reply_needed",
      "Reply needed",
      "The customer texted last. Reply before the lead cools off.",
      "urgent",
      contactAction,
    );
  }

  if (isOverdue(input.nextFollowUpAt, now)) {
    return buildStage(
      "follow_up_overdue",
      "Follow-up overdue",
      "A follow-up is past due. Reach back out and keep the job moving.",
      "urgent",
      contactAction,
    );
  }

  if (!input.latestEstimateStatus) {
    return buildStage(
      "estimate_needed",
      "Estimate needed",
      "You have the lead context. The next real step is pricing the work.",
      "urgent",
      { kind: "create_estimate", label: "Create Estimate" },
    );
  }

  if (input.latestEstimateStatus === "DRAFT") {
    return buildStage(
      "estimate_draft",
      "Estimate draft",
      "Finish the scope and send the estimate.",
      "active",
      { kind: "finish_estimate", label: "Finish Estimate" },
    );
  }

  if (input.latestEstimateStatus === "DECLINED" || input.latestEstimateStatus === "EXPIRED") {
    return buildStage(
      "estimate_revision",
      "Estimate needs revision",
      "Update the estimate and send a fresh version.",
      "urgent",
      { kind: "revise_estimate", label: "Revise Estimate" },
    );
  }

  if (input.latestEstimateStatus === "SENT" || input.latestEstimateStatus === "VIEWED") {
    return buildStage(
      "waiting_on_approval",
      "Waiting on approval",
      input.latestEstimateStatus === "VIEWED"
        ? "The customer has seen the estimate. Follow up and close the decision."
        : "The estimate is out. Keep follow-up tight until you get an answer.",
      "active",
      contactAction,
    );
  }

  if ((input.latestEstimateStatus === "APPROVED" || input.latestEstimateStatus === "CONVERTED") && !input.hasScheduledJob) {
    return buildStage(
      "ready_to_schedule",
      "Ready to schedule",
      "The estimate is approved. Put the job on the calendar.",
      "urgent",
      { kind: "schedule_job", label: "Schedule Job" },
    );
  }

  if (input.hasScheduledJob && !input.hasLatestInvoice) {
    return buildStage(
      "job_scheduled",
      "Job scheduled",
      "The work is booked. Keep operations moving and invoice when the work is done.",
      "active",
      input.hasOperationalJob
        ? { kind: "open_operational_job", label: "Open Operational Job" }
        : { kind: "open_schedule", label: "Open Schedule" },
    );
  }

  if (input.hasOpenInvoice) {
    return buildStage(
      "awaiting_payment",
      "Awaiting payment",
      "The invoice is out and money is still due.",
      "urgent",
      { kind: "open_invoices", label: "Open Invoices" },
    );
  }

  if (input.latestInvoicePaid) {
    return buildStage(
      "paid",
      "Paid",
      "This job is paid up. Keep notes, photos, and history tidy.",
      "done",
      input.hasOperationalJob
        ? { kind: "open_operational_job", label: "Open Operational Job" }
        : { kind: "open_lead", label: "Open Lead" },
    );
  }

  return buildStage(
    "lead_active",
    "Lead active",
    "Keep the customer moving from follow-up into estimate, schedule, and payment.",
    "active",
    contactAction,
  );
}

export function getContractorWorkflowTone(level: ContractorWorkflowAttentionLevel): "warn" | "accent" | "good" {
  if (level === "urgent") return "warn";
  if (level === "done") return "good";
  return "accent";
}

export function resolveContractorWorkflowActionTarget(
  input: ContractorWorkflowActionTargetInput,
): ContractorWorkflowActionTarget {
  switch (input.action.kind) {
    case "open_follow_up":
      return { href: input.messagesHref };
    case "call_customer":
      return input.phoneHref ? { href: input.phoneHref, external: true } : { href: input.messagesHref };
    case "create_estimate":
      return { href: input.createEstimateHref };
    case "finish_estimate":
    case "revise_estimate":
      return { href: input.latestEstimateHref || input.createEstimateHref };
    case "schedule_job":
    case "open_schedule":
      return { href: input.scheduleCalendarHref };
    case "open_operational_job":
      return { href: input.operationalJobHref || input.overviewHref };
    case "open_invoices":
      return { href: input.invoiceHref };
    case "open_lead":
    default:
      return { href: input.overviewHref };
  }
}
