"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@prisma/client";
import {
  dispatchStatusValues,
  formatDispatchSmsDeliveryStateLabel,
  formatDispatchStatusLabel,
  getDispatchTodayDateKey,
  type DispatchSmsRemediation,
  type DispatchSmsDeliveryState,
  type DispatchCrewManagementItem,
  type DispatchStatusValue,
} from "@/lib/dispatch";
import { formatOperationalJobStatusLabel } from "@/lib/job-tracking-format";
import {
  describeOperationalJobManualClosure,
  describeOperationalJobManualContactOutcome,
  describeOperationalJobManualOutcomeCompletion,
  describeOperationalJobManualFollowThrough,
  describeOperationalJobRecoveryEscalation,
  describeOperationalJobRecoveryCompletion,
  getOperationalJobInboundResponseContext,
  getOperationalJobNoResponseStaleCue,
  getOperationalJobPassiveWaitingContext,
  getOperationalJobOutcomeNextAction,
  getOperationalJobRemediationIssueKey,
  shouldShowOperationalJobAfterCallOutcomePrompt,
  shouldReEmphasizeNoResponseAction,
  shouldShowOperationalJobRecoveryCta,
  shouldAutoRefreshOperationalJobRemediation,
  type OperationalJobRemediationAction,
} from "@/lib/operational-job-remediation";
import { jobStatusOptions } from "@/lib/job-records";

type DispatchJobResponse =
  | {
      ok?: boolean;
      job?: {
        id: string;
      };
      error?: string;
    }
  | null;

type OperationalJobStatusResponse =
  | {
      ok?: boolean;
      job?: {
        id: string;
        status: JobStatus;
      };
      error?: string;
    }
  | null;

type TrackingLinkResponse =
  | {
      ok?: boolean;
      tracking?: {
        url?: string;
      };
      error?: string;
    }
  | null;

type CustomerUpdateResponse =
  | {
      ok?: boolean;
      result?: {
        status?: string;
        changedFields?: string[];
      };
      error?: string;
    }
  | null;

type ManualFollowThroughResponse =
  | {
      ok?: boolean;
      error?: string;
    }
  | null;

type ManualContactOutcomeResponse =
  | {
      ok?: boolean;
      error?: string;
    }
  | null;

type DispatchCommunicationState = {
  lastCustomerUpdate: {
    occurredAt: string | Date;
    statusUpdatedAt: string | Date;
    summary: string;
    providerStatus: string | null;
    deliveryState: DispatchSmsDeliveryState | null;
    body: string | null;
    failureReason: string | null;
    operatorFailureReason: string | null;
    providerErrorCode: string | null;
    providerErrorMessage: string | null;
    remediation: DispatchSmsRemediation | null;
    recoverySend: boolean;
    manualFollowThrough: {
      state: "started" | "handled";
      actionId: string | null;
      occurredAt: string | Date;
    } | null;
    manualContactOutcome: {
      outcome: "confirmed_schedule" | "reschedule_needed" | "no_response";
      occurredAt: string | Date;
    } | null;
    customerResponseAfterSend: {
      occurredAt: string | Date;
      summary: string;
      type: "sms" | "call" | "voicemail";
    } | null;
    operatorFollowUpAfterResponse: {
      occurredAt: string | Date;
      summary: string;
    } | null;
    kind: string;
    status: string | null;
  } | null;
  customerUpdate: {
    pending: boolean;
    occurredAt: string | Date | null;
    changedFields: string[];
    alreadySentAt: string | Date | null;
    canSend: boolean;
    blockedReason: string | null;
    previewBody: string | null;
  };
};

type OperationalJobActionPanelProps = {
  jobId: string;
  initialDispatchStatus: DispatchStatusValue;
  initialJobStatus: JobStatus;
  initialCrewId: string | null;
  initialScheduledDate: string;
  initialScheduledStartTime: string | null;
  initialScheduledEndTime: string | null;
  dispatchCommunicationState: DispatchCommunicationState;
  remediationActions: OperationalJobRemediationAction[];
  inboundResponseHandoff: OperationalJobRemediationAction | null;
  crews: DispatchCrewManagementItem[];
};

function formatDateTimeLabel(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatChangedFieldsLabel(fields: string[]): string | null {
  if (fields.length === 0) return null;

  const labels = fields.map((field) => {
    switch (field) {
      case "scheduledDate":
        return "date";
      case "scheduledStartTime":
        return "start time";
      case "scheduledEndTime":
        return "end time";
      default:
        return field;
    }
  });

  if (labels.length === 1) {
    return labels[0] || null;
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export default function OperationalJobActionPanel({
  jobId,
  initialDispatchStatus,
  initialJobStatus,
  initialCrewId,
  initialScheduledDate,
  initialScheduledStartTime,
  initialScheduledEndTime,
  dispatchCommunicationState,
  remediationActions,
  inboundResponseHandoff,
  crews,
}: OperationalJobActionPanelProps) {
  const router = useRouter();
  const [refreshPending, startRefreshTransition] = useTransition();
  const [dispatchStatus, setDispatchStatus] = useState<DispatchStatusValue>(initialDispatchStatus);
  const [jobStatus, setJobStatus] = useState<JobStatus>(initialJobStatus);
  const [assignedCrewId, setAssignedCrewId] = useState(initialCrewId || "");
  const [scheduledDate, setScheduledDate] = useState(initialScheduledDate);
  const [scheduledStartTime, setScheduledStartTime] = useState(initialScheduledStartTime || "");
  const [scheduledEndTime, setScheduledEndTime] = useState(initialScheduledEndTime || "");
  const [trackingLink, setTrackingLink] = useState("");
  const [savingDispatch, setSavingDispatch] = useState(false);
  const [savingJobStatus, setSavingJobStatus] = useState(false);
  const [sendingCustomerUpdate, setSendingCustomerUpdate] = useState(false);
  const [generatingTrackingLink, setGeneratingTrackingLink] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryCompletionAt, setRecoveryCompletionAt] = useState<string | null>(null);
  const [manualOutcomeCompletion, setManualOutcomeCompletion] = useState<{
    outcome: "confirmed_schedule" | "reschedule_needed" | "no_response";
    occurredAt: string;
  } | null>(null);
  const [manualFollowThroughPendingId, setManualFollowThroughPendingId] = useState<string | null>(null);
  const [manualContactOutcomePending, setManualContactOutcomePending] = useState<string | null>(null);
  const [staleCueNow, setStaleCueNow] = useState<string | null>(null);
  const lastAutoRefreshAtRef = useRef(0);
  const wasHiddenRef = useRef(false);
  const pendingCallHandoffRefreshRef = useRef(false);
  const dispatchSectionRef = useRef<HTMLElement | null>(null);
  const scheduledDateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDispatchStatus(initialDispatchStatus);
  }, [initialDispatchStatus]);

  useEffect(() => {
    setJobStatus(initialJobStatus);
  }, [initialJobStatus]);

  useEffect(() => {
    setAssignedCrewId(initialCrewId || "");
  }, [initialCrewId]);

  useEffect(() => {
    setScheduledDate(initialScheduledDate);
  }, [initialScheduledDate]);

  useEffect(() => {
    setScheduledStartTime(initialScheduledStartTime || "");
  }, [initialScheduledStartTime]);

  useEffect(() => {
    setScheduledEndTime(initialScheduledEndTime || "");
  }, [initialScheduledEndTime]);

  const dispatchDirty =
    dispatchStatus !== initialDispatchStatus ||
    (assignedCrewId || null) !== (initialCrewId || null) ||
    scheduledDate !== initialScheduledDate ||
    scheduledStartTime !== (initialScheduledStartTime || "") ||
    scheduledEndTime !== (initialScheduledEndTime || "");
  const scheduleDirty =
    scheduledDate !== initialScheduledDate ||
    scheduledStartTime !== (initialScheduledStartTime || "") ||
    scheduledEndTime !== (initialScheduledEndTime || "");
  const jobStatusDirty = jobStatus !== initialJobStatus;
  const customerUpdateState = dispatchCommunicationState.customerUpdate;
  const lastCustomerUpdate = dispatchCommunicationState.lastCustomerUpdate;
  const remediationIssueKey = getOperationalJobRemediationIssueKey(dispatchCommunicationState);
  const shouldAutoRefreshIssueState = shouldAutoRefreshOperationalJobRemediation(dispatchCommunicationState);
  const pendingChangedFieldsLabel = formatChangedFieldsLabel(customerUpdateState.changedFields);
  const lastCustomerUpdateAt = formatDateTimeLabel(lastCustomerUpdate?.occurredAt);
  const lastCustomerUpdateStatusAt = formatDateTimeLabel(lastCustomerUpdate?.statusUpdatedAt);
  const manualFollowThroughAt = formatDateTimeLabel(lastCustomerUpdate?.manualFollowThrough?.occurredAt);
  const manualContactOutcomeAt = formatDateTimeLabel(lastCustomerUpdate?.manualContactOutcome?.occurredAt);
  const recoveryCompletionAtLabel = formatDateTimeLabel(recoveryCompletionAt);
  const manualOutcomeCompletionAtLabel = formatDateTimeLabel(manualOutcomeCompletion?.occurredAt);
  const pendingOccurredAt = formatDateTimeLabel(customerUpdateState.occurredAt);
  const alreadySentAt = formatDateTimeLabel(customerUpdateState.alreadySentAt);
  const readyToSendAfterRefresh =
    customerUpdateState.pending && customerUpdateState.canSend && !customerUpdateState.blockedReason;
  const retryableLastAttempt =
    Boolean(customerUpdateState.pending && customerUpdateState.canSend) &&
    (lastCustomerUpdate?.deliveryState === "failed" || lastCustomerUpdate?.deliveryState === "suppressed");
  const hasUnsavedLocalChanges = dispatchDirty || jobStatusDirty;
  const previousIssueKeyRef = useRef<string | null>(remediationIssueKey);
  const recoveryCompletionSettled = Boolean(recoveryCompletionAt && !customerUpdateState.pending && alreadySentAt);
  const manualOutcomeCompletionSettled = Boolean(manualOutcomeCompletion && !customerUpdateState.pending && alreadySentAt);
  const recoveryCompletionCopy = recoveryCompletionAt
    ? describeOperationalJobRecoveryCompletion({
        deliveryState: lastCustomerUpdate?.deliveryState || null,
        reflectedInServerState: recoveryCompletionSettled,
      })
    : null;
  const manualOutcomeCompletionCopy = manualOutcomeCompletion
    ? describeOperationalJobManualOutcomeCompletion({
        outcome: manualOutcomeCompletion.outcome,
        deliveryState: lastCustomerUpdate?.deliveryState || null,
        reflectedInServerState: manualOutcomeCompletionSettled,
      })
    : null;
  const recoveryEscalation = describeOperationalJobRecoveryEscalation({
    recoverySend: lastCustomerUpdate?.recoverySend === true,
    deliveryState: lastCustomerUpdate?.deliveryState || null,
    providerStatus: lastCustomerUpdate?.providerStatus || null,
    operatorFailureReason: lastCustomerUpdate?.operatorFailureReason || null,
  });
  const manualFollowThroughSummary = lastCustomerUpdate?.manualFollowThrough
    ? describeOperationalJobManualFollowThrough({
        state: lastCustomerUpdate.manualFollowThrough.state,
        actionId: lastCustomerUpdate.manualFollowThrough.actionId,
      })
    : null;
  const manualContactOutcomeSummary = lastCustomerUpdate?.manualContactOutcome
    ? describeOperationalJobManualContactOutcome({
        outcome: lastCustomerUpdate.manualContactOutcome.outcome,
      })
    : null;
  const manualClosureSummary =
    lastCustomerUpdate?.manualFollowThrough?.state === "handled"
      ? describeOperationalJobManualClosure({
          actionId: lastCustomerUpdate.manualFollowThrough.actionId,
          outcome: lastCustomerUpdate.manualContactOutcome?.outcome || null,
          outcomeOccurredAt: lastCustomerUpdate.manualContactOutcome?.occurredAt || null,
          customerUpdateOccurredAt: customerUpdateState.occurredAt,
          customerUpdatePending: customerUpdateState.pending,
          customerUpdateCanSend: customerUpdateState.canSend,
          customerUpdateBlockedReason: customerUpdateState.blockedReason,
          customerUpdateAlreadySent: Boolean(customerUpdateState.alreadySentAt),
          customerUpdateAlreadySentAt: customerUpdateState.alreadySentAt,
          customerResponseOccurredAt: lastCustomerUpdate.customerResponseAfterSend?.occurredAt || null,
          customerResponseSummary: lastCustomerUpdate.customerResponseAfterSend?.summary || null,
          operatorFollowUpOccurredAt: lastCustomerUpdate.operatorFollowUpAfterResponse?.occurredAt || null,
          operatorFollowUpSummary: lastCustomerUpdate.operatorFollowUpAfterResponse?.summary || null,
        })
      : null;
  const rawOutcomeNextAction =
    lastCustomerUpdate?.manualFollowThrough?.state === "handled"
      ? getOperationalJobOutcomeNextAction({
          outcome: lastCustomerUpdate.manualContactOutcome?.outcome || null,
          outcomeOccurredAt: lastCustomerUpdate.manualContactOutcome?.occurredAt || null,
          customerUpdateOccurredAt: customerUpdateState.occurredAt,
          customerUpdatePending: customerUpdateState.pending,
          customerUpdateCanSend: customerUpdateState.canSend,
          customerUpdateBlockedReason: customerUpdateState.blockedReason,
          customerUpdateAlreadySent: Boolean(customerUpdateState.alreadySentAt),
          remediationActions,
        })
      : null;
  const outcomeNextAction =
    rawOutcomeNextAction?.kind === "edit_schedule" && scheduleDirty
      ? null
      : rawOutcomeNextAction;
  const noResponseStaleCue =
    !manualOutcomeCompletionCopy &&
    lastCustomerUpdate?.manualFollowThrough?.state === "handled"
      ? getOperationalJobNoResponseStaleCue({
          outcome: lastCustomerUpdate.manualContactOutcome?.outcome || null,
          outcomeOccurredAt: lastCustomerUpdate.manualContactOutcome?.occurredAt || null,
          customerUpdateOccurredAt: customerUpdateState.occurredAt,
          customerUpdatePending: customerUpdateState.pending,
          customerUpdateCanSend: customerUpdateState.canSend,
          customerUpdateBlockedReason: customerUpdateState.blockedReason,
          customerUpdateAlreadySent: Boolean(customerUpdateState.alreadySentAt),
          customerUpdateAlreadySentAt: customerUpdateState.alreadySentAt,
          customerResponseOccurredAt: lastCustomerUpdate.customerResponseAfterSend?.occurredAt || null,
          operatorFollowUpOccurredAt: lastCustomerUpdate.operatorFollowUpAfterResponse?.occurredAt || null,
          now: staleCueNow,
        })
      : null;
  const passiveWaitingContext =
    !manualOutcomeCompletionCopy &&
    noResponseStaleCue?.badge === "Still waiting on customer" &&
    lastCustomerUpdate?.manualFollowThrough?.state === "handled"
      ? getOperationalJobPassiveWaitingContext({
          outcome: lastCustomerUpdate.manualContactOutcome?.outcome || null,
          outcomeOccurredAt: lastCustomerUpdate.manualContactOutcome?.occurredAt || null,
          customerUpdatePending: customerUpdateState.pending,
          customerUpdateAlreadySentAt: customerUpdateState.alreadySentAt,
          lastCustomerUpdateOccurredAt: lastCustomerUpdate.occurredAt,
          deliveryState: lastCustomerUpdate.deliveryState || null,
          deliveryStatusOccurredAt: lastCustomerUpdate.statusUpdatedAt,
          customerResponseOccurredAt: lastCustomerUpdate.customerResponseAfterSend?.occurredAt || null,
        })
      : null;
  const inboundResponseContext =
    !manualOutcomeCompletionCopy &&
    manualClosureSummary?.badge === "New customer activity" &&
    lastCustomerUpdate?.manualFollowThrough?.state === "handled"
      ? getOperationalJobInboundResponseContext({
          customerUpdateAlreadySentAt: customerUpdateState.alreadySentAt,
          customerResponseOccurredAt: lastCustomerUpdate.customerResponseAfterSend?.occurredAt || null,
          customerResponseType: lastCustomerUpdate.customerResponseAfterSend?.type || null,
          operatorFollowUpOccurredAt: lastCustomerUpdate.operatorFollowUpAfterResponse?.occurredAt || null,
        })
      : null;
  const showAfterCallOutcomePrompt = shouldShowOperationalJobAfterCallOutcomePrompt({
    manualFollowThroughState: lastCustomerUpdate?.manualFollowThrough?.state || null,
    manualFollowThroughActionId: lastCustomerUpdate?.manualFollowThrough?.actionId || null,
    manualContactOutcome: lastCustomerUpdate?.manualContactOutcome?.outcome || null,
  });
  const shouldAutoRefreshOnReturn = shouldAutoRefreshIssueState || Boolean(inboundResponseContext);
  const shouldReEmphasizeNoResponseNextAction = shouldReEmphasizeNoResponseAction({
    outcome: lastCustomerUpdate?.manualContactOutcome?.outcome || null,
    staleCue: noResponseStaleCue,
    nextActionKind: outcomeNextAction?.kind || null,
  });
  const outcomeNextActionHeading =
    shouldReEmphasizeNoResponseNextAction
      ? "Recommended next step"
      : lastCustomerUpdate?.manualContactOutcome?.outcome === "no_response"
        ? "Available next step"
        : "Recommended next step";
  const outcomeNextActionButtonClass =
    outcomeNextAction?.kind === "handoff" && !shouldReEmphasizeNoResponseNextAction
      ? "btn secondary"
      : "btn primary";
  const passiveWaitingLastTouchAt = formatDateTimeLabel(passiveWaitingContext?.lastTouchOccurredAt);
  const passiveWaitingSinceAt = formatDateTimeLabel(passiveWaitingContext?.waitingSinceAt);
  const passiveWaitingOutcomeAt = formatDateTimeLabel(passiveWaitingContext?.manualOutcomeOccurredAt);
  const passiveWaitingDeliveryStatusAt = formatDateTimeLabel(passiveWaitingContext?.deliveryStatusOccurredAt);
  const passiveWaitingPrimaryDetail =
    passiveWaitingLastTouchAt && passiveWaitingSinceAt
      ? passiveWaitingLastTouchAt === passiveWaitingSinceAt
        ? `Customer update sent ${passiveWaitingLastTouchAt}. Waiting on customer since then.`
        : `Customer update sent ${passiveWaitingLastTouchAt}. Waiting on customer since ${passiveWaitingSinceAt}.`
      : passiveWaitingSinceAt
        ? `Waiting on customer since ${passiveWaitingSinceAt}.`
        : passiveWaitingLastTouchAt
          ? `Last customer update sent ${passiveWaitingLastTouchAt}.`
          : null;
  const passiveWaitingOutcomeDetail = passiveWaitingOutcomeAt
    ? `Last manual contact outcome: No response, recorded ${passiveWaitingOutcomeAt}.`
    : "Last manual contact outcome: No response.";
  const passiveWaitingDeliveryDetail =
    passiveWaitingContext?.deliveryState === "delivered"
      ? passiveWaitingDeliveryStatusAt
        ? `Delivery was confirmed ${passiveWaitingDeliveryStatusAt}.`
        : "Delivery was confirmed."
      : null;
  const inboundResponseAtLabel = formatDateTimeLabel(inboundResponseContext?.occurredAt);

  function triggerStatusRefresh() {
    lastAutoRefreshAtRef.current = Date.now();
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  function maybeRefreshAfterReturn() {
    if (!shouldAutoRefreshOnReturn && !pendingCallHandoffRefreshRef.current) return;
    if (hasUnsavedLocalChanges || savingDispatch || savingJobStatus || sendingCustomerUpdate) return;
    if (Date.now() - lastAutoRefreshAtRef.current < 2500) return;
    pendingCallHandoffRefreshRef.current = false;
    triggerStatusRefresh();
  }

  useEffect(() => {
    const previousIssueKey = previousIssueKeyRef.current;
    const recoveredReady = shouldShowOperationalJobRecoveryCta({
      previousIssueKey,
      current: dispatchCommunicationState,
    });

    if (recoveredReady) {
      setRecoveryReady(true);
      setError(null);
      setNotice("Issue resolved. Customer update is ready to send.");
    } else if (previousIssueKey && !remediationIssueKey) {
      setRecoveryReady(false);
      setError(null);
      setNotice("Issue resolved. Status refreshed.");
    } else if (remediationIssueKey || !readyToSendAfterRefresh) {
      setRecoveryReady(false);
    }
    previousIssueKeyRef.current = remediationIssueKey;
  }, [dispatchCommunicationState, readyToSendAfterRefresh, remediationIssueKey]);

  useEffect(() => {
    if (!recoveryCompletionAt) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRecoveryCompletionAt(null);
    }, 10000);

    return () => window.clearTimeout(timeout);
  }, [recoveryCompletionAt]);

  useEffect(() => {
    if (!manualOutcomeCompletion) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setManualOutcomeCompletion(null);
    }, 10000);

    return () => window.clearTimeout(timeout);
  }, [manualOutcomeCompletion]);

  useEffect(() => {
    setStaleCueNow(new Date().toISOString());
  }, [dispatchCommunicationState, manualOutcomeCompletion]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        wasHiddenRef.current = true;
        return;
      }

      if (!wasHiddenRef.current) {
        return;
      }

      wasHiddenRef.current = false;
      maybeRefreshAfterReturn();
    }

    function onFocus() {
      if (document.visibilityState !== "visible") {
        return;
      }
      maybeRefreshAfterReturn();
    }

    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) {
        return;
      }
      maybeRefreshAfterReturn();
    }

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasUnsavedLocalChanges, savingDispatch, savingJobStatus, sendingCustomerUpdate, shouldAutoRefreshOnReturn]);

  async function handleSaveDispatch() {
    if (!dispatchDirty || savingDispatch) return;

    setSavingDispatch(true);
    setError(null);
    setNotice(null);

    try {
      if (!scheduledDate.trim()) {
        throw new Error("Scheduled date is required.");
      }

      const response = await fetch(`/api/dispatch/jobs/${jobId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          todayDate: getDispatchTodayDateKey(),
          status: dispatchStatus,
          assignedCrewId: assignedCrewId || null,
          scheduledDate,
          scheduledStartTime: scheduledStartTime || null,
          scheduledEndTime: scheduledEndTime || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as DispatchJobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to update dispatch status.");
      }

      setNotice("Dispatch details updated.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update dispatch details.");
    } finally {
      setSavingDispatch(false);
    }
  }

  async function handleSaveJobStatus() {
    if (!jobStatusDirty || savingJobStatus) return;

    setSavingJobStatus(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/operational-status`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: jobStatus,
        }),
      });

      const payload = (await response.json().catch(() => null)) as OperationalJobStatusResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || "Failed to update internal job status.");
      }

      setNotice("Internal job status updated.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update internal job status.");
    } finally {
      setSavingJobStatus(false);
    }
  }

  async function handleGenerateTrackingLink(copyAfterCreate: boolean) {
    if (generatingTrackingLink) return;

    setGeneratingTrackingLink(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/dispatch/jobs/${jobId}/tracking-link`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as TrackingLinkResponse;
      const url = payload?.tracking?.url || "";
      if (!response.ok || !payload?.ok || !url) {
        throw new Error(payload?.error || "Failed to generate tracking link.");
      }

      setTrackingLink(url);

      if (copyAfterCreate && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setNotice("Tracking link copied.");
      } else if (copyAfterCreate) {
        setNotice("Tracking link generated below.");
      } else {
        setNotice("Tracking link generated.");
      }

      router.refresh();
    } catch (trackingError) {
      setError(trackingError instanceof Error ? trackingError.message : "Failed to generate tracking link.");
    } finally {
      setGeneratingTrackingLink(false);
    }
  }

  async function handleCopyTrackingLink() {
    setError(null);
    setNotice(null);

    if (!trackingLink) {
      await handleGenerateTrackingLink(true);
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setNotice("Tracking link is ready below.");
      return;
    }

    try {
      await navigator.clipboard.writeText(trackingLink);
      setNotice("Tracking link copied.");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Failed to copy tracking link.");
    }
  }

  async function handleSendCustomerUpdate() {
    if (!customerUpdateState.pending || !customerUpdateState.canSend || sendingCustomerUpdate) return;

    setSendingCustomerUpdate(true);
    setError(null);
    setNotice(null);
    const completingManualOutcome =
      outcomeNextAction?.kind === "send_customer_update"
        ? (lastCustomerUpdate?.manualContactOutcome?.outcome || null)
        : null;

    try {
      if (customerUpdateState.previewBody) {
        const confirmed = window.confirm(`Send this customer update?\n\n${customerUpdateState.previewBody}`);
        if (!confirmed) {
          setSendingCustomerUpdate(false);
          return;
        }
      }

      const response = await fetch(`/api/dispatch/jobs/${jobId}/customer-update`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recovery: recoveryReady,
        }),
      });

      const payload = (await response.json().catch(() => null)) as CustomerUpdateResponse;
      if (!response.ok || !payload?.ok || !payload.result?.status) {
        throw new Error(payload?.error || "Failed to send customer update.");
      }

      const resumedSend = recoveryReady && payload.result.status === "sent";
      const completedManualOutcomeSend = payload.result.status === "sent" && Boolean(completingManualOutcome);
      setRecoveryReady(false);
      setRecoveryCompletionAt(resumedSend ? new Date().toISOString() : null);
      setManualOutcomeCompletion(
        completedManualOutcomeSend && completingManualOutcome
          ? {
              outcome: completingManualOutcome,
              occurredAt: new Date().toISOString(),
            }
          : null,
      );
      setNotice(
        payload.result.status === "already_sent"
          ? "Customer update was already sent."
          : resumedSend
            ? "Customer update resumed."
            : "Customer update sent.",
      );
      router.refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send customer update.");
    } finally {
      setSendingCustomerUpdate(false);
    }
  }

  async function recordManualFollowThrough(input: {
    state: "started" | "handled";
    actionId: string;
  }) {
    const response = await fetch(`/api/jobs/${jobId}/manual-follow-through`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const payload = (await response.json().catch(() => null)) as ManualFollowThroughResponse;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to record manual follow-through.");
    }
  }

  async function handleEscalationAction(action: OperationalJobRemediationAction) {
    setError(null);
    setNotice(null);
    setManualFollowThroughPendingId(action.id);

    try {
      await recordManualFollowThrough({
        state: "started",
        actionId: action.id,
      });
    } catch {
      // Do not block the real handoff if the audit marker fails.
    } finally {
      setManualFollowThroughPendingId(null);
    }

    if (action.id === "call-customer") {
      pendingCallHandoffRefreshRef.current = true;
    }

    if (action.native) {
      window.location.href = action.href;
      return;
    }

    router.push(action.href);
  }

  async function handleMarkHandledManually() {
    if (manualFollowThroughPendingId) {
      return;
    }

    setManualFollowThroughPendingId("mark-handled");
    setError(null);
    setNotice(null);

    try {
      await recordManualFollowThrough({
        state: "handled",
        actionId: "mark-handled",
      });
      setNotice("Marked handled manually.");
      router.refresh();
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : "Failed to mark manual follow-through.");
    } finally {
      setManualFollowThroughPendingId(null);
    }
  }

  async function submitManualContactOutcome(
    outcome: "confirmed_schedule" | "reschedule_needed" | "no_response",
  ) {
    const response = await fetch(`/api/jobs/${jobId}/manual-contact-outcome`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome }),
    });

    const payload = (await response.json().catch(() => null)) as ManualContactOutcomeResponse;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to record manual contact outcome.");
    }
  }

  async function handleRecordManualContactOutcome(
    outcome: "confirmed_schedule" | "reschedule_needed" | "no_response",
  ) {
    if (manualContactOutcomePending || !lastCustomerUpdate?.manualFollowThrough || lastCustomerUpdate.manualFollowThrough.state !== "handled") {
      return;
    }

    setManualContactOutcomePending(outcome);
    setError(null);
    setNotice(null);

    try {
      await submitManualContactOutcome(outcome);
      setNotice("Manual contact outcome recorded.");
      router.refresh();
    } catch (outcomeError) {
      setError(outcomeError instanceof Error ? outcomeError.message : "Failed to record manual contact outcome.");
    } finally {
      setManualContactOutcomePending(null);
    }
  }

  async function handleRecordAfterCallOutcome(
    outcome: "confirmed_schedule" | "reschedule_needed" | "no_response",
  ) {
    if (manualContactOutcomePending || manualFollowThroughPendingId || !showAfterCallOutcomePrompt) {
      return;
    }

    setManualContactOutcomePending(outcome);
    setError(null);
    setNotice(null);

    try {
      await recordManualFollowThrough({
        state: "handled",
        actionId: "call-customer",
      });
      await submitManualContactOutcome(outcome);
      setNotice("After-call outcome recorded.");
      router.refresh();
    } catch (outcomeError) {
      setError(outcomeError instanceof Error ? outcomeError.message : "Failed to record after-call outcome.");
    } finally {
      setManualContactOutcomePending(null);
    }
  }

  async function handleMarkAfterCallHandled() {
    if (manualFollowThroughPendingId || !showAfterCallOutcomePrompt) {
      return;
    }

    setManualFollowThroughPendingId("call-customer");
    setError(null);
    setNotice(null);

    try {
      await recordManualFollowThrough({
        state: "handled",
        actionId: "call-customer",
      });
      setNotice("Call follow-up marked handled.");
      router.refresh();
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : "Failed to mark call follow-up.");
    } finally {
      setManualFollowThroughPendingId(null);
    }
  }

  function handleEditScheduleNow() {
    setError(null);
    setNotice(null);
    dispatchSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    window.setTimeout(() => {
      scheduledDateInputRef.current?.focus();
    }, 120);
  }

  return (
    <div className="operational-job-actions">
      <div className="operational-job-action-grid">
        <section ref={dispatchSectionRef} className="operational-job-action-card">
          <div className="stack-cell">
            <h4>Dispatch</h4>
            <label className="stack-cell">
              <span className="muted">Scheduled date</span>
              <input
                ref={scheduledDateInputRef}
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
              />
            </label>

            <div className="operational-job-time-grid">
              <label className="stack-cell">
                <span className="muted">Start time</span>
                <input
                  type="time"
                  value={scheduledStartTime}
                  onChange={(event) => setScheduledStartTime(event.target.value)}
                />
              </label>

              <label className="stack-cell">
                <span className="muted">End time</span>
                <input
                  type="time"
                  value={scheduledEndTime}
                  onChange={(event) => setScheduledEndTime(event.target.value)}
                />
              </label>
            </div>

            <label className="stack-cell">
              <span className="muted">Dispatch status</span>
              <select value={dispatchStatus} onChange={(event) => setDispatchStatus(event.target.value as DispatchStatusValue)}>
                {dispatchStatusValues.map((value) => (
                  <option key={value} value={value}>
                    {formatDispatchStatusLabel(value)}
                  </option>
                ))}
              </select>
            </label>

            <label className="stack-cell">
              <span className="muted">Crew</span>
              <select value={assignedCrewId} onChange={(event) => setAssignedCrewId(event.target.value)}>
                <option value="">Unassigned</option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                    {!crew.active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSaveDispatch()}
              disabled={!dispatchDirty || savingDispatch}
            >
              {savingDispatch ? "Saving..." : "Save Dispatch"}
            </button>
          </div>
        </section>

        <section className="operational-job-action-card">
          <div className="stack-cell">
            <h4>Internal Status</h4>
            <label className="stack-cell">
              <span className="muted">Operational job status</span>
              <select value={jobStatus} onChange={(event) => setJobStatus(event.target.value as JobStatus)}>
                {jobStatusOptions.map((value) => (
                  <option key={value} value={value}>
                    {formatOperationalJobStatusLabel(value)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="btn secondary"
              onClick={() => void handleSaveJobStatus()}
              disabled={!jobStatusDirty || savingJobStatus}
            >
              {savingJobStatus ? "Saving..." : "Save Job Status"}
            </button>
          </div>
        </section>
      </div>

      <section className="operational-job-action-card">
        <div className="stack-cell">
          <h4>Customer Tracking</h4>
          <p className="muted">Generate a fresh tracking link for the customer and copy it when you are ready to send it.</p>
          <div className="quick-links">
            <button
              type="button"
              className="btn secondary"
              onClick={() => void handleGenerateTrackingLink(false)}
              disabled={generatingTrackingLink}
            >
              {generatingTrackingLink ? "Generating..." : "Generate Link"}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleCopyTrackingLink()}
              disabled={generatingTrackingLink}
            >
              Copy Link
            </button>
          </div>

          {trackingLink ? <input readOnly value={trackingLink} aria-label="Tracking link" /> : null}
        </div>
      </section>

      <section className="operational-job-action-card">
        <div className="stack-cell">
          <h4>Customer Update</h4>
          {lastCustomerUpdate ? (
            <div className="stack-cell">
              <div className="quick-meta">
                <span className="badge">Last update</span>
                {lastCustomerUpdateAt ? <span className="muted">{lastCustomerUpdateAt}</span> : null}
                {lastCustomerUpdate.deliveryState ? (
                  <span className="badge">{formatDispatchSmsDeliveryStateLabel(lastCustomerUpdate.deliveryState)}</span>
                ) : lastCustomerUpdate.providerStatus ? (
                  <span className="badge">{lastCustomerUpdate.providerStatus}</span>
                ) : null}
              </div>
              <strong>{lastCustomerUpdate.summary}</strong>
              {lastCustomerUpdateStatusAt ? (
                <p className="muted">Delivery status updated {lastCustomerUpdateStatusAt}.</p>
              ) : null}
              {lastCustomerUpdate.body ? <p>{lastCustomerUpdate.body}</p> : null}
              {lastCustomerUpdate.operatorFailureReason ? (
                <p className="muted">{lastCustomerUpdate.operatorFailureReason}</p>
              ) : lastCustomerUpdate.failureReason ? (
                <p className="muted">{lastCustomerUpdate.failureReason}</p>
              ) : null}
              {lastCustomerUpdate.remediation && !recoveryEscalation ? (
                <div className="stack-cell">
                  <span className="muted">Next step</span>
                  <strong>{lastCustomerUpdate.remediation.title}</strong>
                  <p className="muted">{lastCustomerUpdate.remediation.detail}</p>
                  {remediationActions.length > 0 ? (
                    <div className="quick-links">
                      {remediationActions.map((action) =>
                        action.native ? (
                          <a key={action.id} className="btn secondary" href={action.href}>
                            {action.label}
                          </a>
                        ) : (
                          <Link key={action.id} className="btn secondary" href={action.href}>
                            {action.label}
                          </Link>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {lastCustomerUpdate.providerErrorCode || lastCustomerUpdate.providerErrorMessage ? (
                <details>
                  <summary className="muted">Technical details</summary>
                  <div className="stack-cell">
                    {lastCustomerUpdate.providerErrorCode ? (
                      <p className="muted">Twilio error code: {lastCustomerUpdate.providerErrorCode}</p>
                    ) : null}
                    {lastCustomerUpdate.providerErrorMessage ? (
                      <p className="muted">{lastCustomerUpdate.providerErrorMessage}</p>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="muted">No dispatch customer update has been sent from this job yet.</p>
          )}

          <div className="stack-cell">
            <div className="quick-meta">
              <span className={`badge ${customerUpdateState.canSend ? "status-scheduled" : ""}`}>
                {customerUpdateState.canSend ? "Ready to send" : customerUpdateState.pending ? "Blocked" : "Up to date"}
              </span>
              {pendingOccurredAt ? <span className="muted">Change logged {pendingOccurredAt}</span> : null}
            </div>

            <div className="quick-links">
              <button
                type="button"
                className="btn secondary"
                onClick={() => triggerStatusRefresh()}
                disabled={refreshPending || savingDispatch || savingJobStatus || sendingCustomerUpdate || hasUnsavedLocalChanges}
              >
                {refreshPending ? "Refreshing..." : "Refresh Status"}
              </button>
            </div>

            {pendingChangedFieldsLabel ? (
              <p className="muted">Pending schedule change: {pendingChangedFieldsLabel} updated.</p>
            ) : null}

            {recoveryReady ? (
              <div className="stack-cell">
                <div className="quick-meta">
                  <span className="badge status-scheduled">Issue resolved</span>
                  <span className="muted">Ready to resume the customer update.</span>
                </div>
              </div>
            ) : null}

            {manualOutcomeCompletionCopy ? (
              <div className="stack-cell">
                <div className="quick-meta">
                  <span className="badge status-scheduled">Follow-up completed</span>
                  <span className="badge">{manualOutcomeCompletionCopy.title}</span>
                  {manualOutcomeCompletionAtLabel ? <span className="muted">{manualOutcomeCompletionAtLabel}</span> : null}
                </div>
                <p className="muted">{manualOutcomeCompletionCopy.detail}</p>
              </div>
            ) : null}

            {recoveryCompletionCopy && !recoveryEscalation && !manualOutcomeCompletionCopy ? (
              <div className="stack-cell">
                <div className="quick-meta">
                  <span className="badge status-scheduled">Issue resolved</span>
                  <span className="badge">Customer update resumed</span>
                  {recoveryCompletionAtLabel ? <span className="muted">{recoveryCompletionAtLabel}</span> : null}
                </div>
                <p className="muted">{recoveryCompletionCopy.detail}</p>
              </div>
            ) : null}

            {recoveryEscalation && !manualOutcomeCompletionCopy ? (
              <div className="stack-cell">
                <div className="quick-meta">
                  <span className="badge">Issue resolved</span>
                  <span className="badge">Customer update resumed</span>
                  <span className="badge">
                    {manualClosureSummary
                      ? manualClosureSummary.badge
                      : lastCustomerUpdate?.manualFollowThrough?.state === "handled"
                      ? "Handled manually"
                      : lastCustomerUpdate?.manualFollowThrough?.state === "started"
                        ? "Manual follow-up in progress"
                        : "Needs follow-up"}
                  </span>
                  {(manualFollowThroughAt || lastCustomerUpdateStatusAt) ? (
                    <span className="muted">{manualFollowThroughAt || lastCustomerUpdateStatusAt}</span>
                  ) : null}
                  {manualContactOutcomeSummary ? <span className="badge">{manualContactOutcomeSummary.badge}</span> : null}
                </div>
                <strong>{manualClosureSummary?.title || manualFollowThroughSummary?.title || recoveryEscalation.title}</strong>
                <p className="muted">{manualClosureSummary?.detail || manualFollowThroughSummary?.detail || recoveryEscalation.detail}</p>
                {manualContactOutcomeSummary ? (
                  <div className="stack-cell">
                    <strong>{manualContactOutcomeSummary.title}</strong>
                    <p className="muted">
                      {manualContactOutcomeSummary.detail}
                      {manualContactOutcomeAt ? ` Recorded ${manualContactOutcomeAt}.` : ""}
                    </p>
                  </div>
                ) : null}
                {inboundResponseContext ? (
                  <div className="stack-cell">
                    <span className="muted">{inboundResponseContext.label}</span>
                    <div className="quick-meta">
                      <span className="badge">{inboundResponseContext.title}</span>
                      {inboundResponseAtLabel ? <span className="muted">{inboundResponseAtLabel}</span> : null}
                    </div>
                    <p className="muted">{inboundResponseContext.detail}</p>
                    {inboundResponseHandoff ? (
                      <div className="quick-links">
                        {inboundResponseHandoff.native ? (
                          <a className="btn secondary" href={inboundResponseHandoff.href}>
                            {inboundResponseHandoff.label}
                          </a>
                        ) : (
                          <Link className="btn secondary" href={inboundResponseHandoff.href}>
                            {inboundResponseHandoff.label}
                          </Link>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {noResponseStaleCue ? (
                  <div className="stack-cell">
                    <div className="quick-meta">
                      <span className="badge">{noResponseStaleCue.badge}</span>
                    </div>
                    <p className="muted">{noResponseStaleCue.detail}</p>
                  </div>
                ) : null}
                {passiveWaitingContext ? (
                  <div className="stack-cell">
                    <span className="muted">{passiveWaitingContext.label}</span>
                    {passiveWaitingPrimaryDetail ? <p className="muted">{passiveWaitingPrimaryDetail}</p> : null}
                    {!manualContactOutcomeSummary ? <p className="muted">{passiveWaitingOutcomeDetail}</p> : null}
                    {passiveWaitingDeliveryDetail ? <p className="muted">{passiveWaitingDeliveryDetail}</p> : null}
                  </div>
                ) : null}
                {showAfterCallOutcomePrompt ? (
                  <div className="stack-cell">
                    <span className="muted">After call</span>
                    <strong>Record what happened on the call</strong>
                    <p className="muted">Only record an outcome if you already tried the call. This does not assume the call connected.</p>
                    <div className="quick-links">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleRecordAfterCallOutcome("confirmed_schedule")}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualContactOutcomePending === "confirmed_schedule" ? "Saving..." : "Confirmed Schedule"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleRecordAfterCallOutcome("reschedule_needed")}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualContactOutcomePending === "reschedule_needed" ? "Saving..." : "Reschedule Needed"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleRecordAfterCallOutcome("no_response")}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualContactOutcomePending === "no_response" ? "Saving..." : "No Response"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleMarkAfterCallHandled()}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualFollowThroughPendingId === "call-customer" ? "Saving..." : "Handled Manually"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {outcomeNextAction ? (
                  <div className="stack-cell">
                    <span className="muted">{outcomeNextActionHeading}</span>
                    <strong>{outcomeNextAction.label}</strong>
                    <p className="muted">{outcomeNextAction.detail}</p>
                    <div className="quick-links">
                      {outcomeNextAction.kind === "send_customer_update" ? (
                        <button
                          type="button"
                          className={outcomeNextActionButtonClass}
                          onClick={() => void handleSendCustomerUpdate()}
                          disabled={!customerUpdateState.pending || !customerUpdateState.canSend || sendingCustomerUpdate}
                        >
                          {sendingCustomerUpdate ? "Sending..." : outcomeNextAction.label}
                        </button>
                      ) : null}
                      {outcomeNextAction.kind === "edit_schedule" ? (
                        <button
                          type="button"
                          className={outcomeNextActionButtonClass}
                          onClick={() => handleEditScheduleNow()}
                        >
                          {outcomeNextAction.label}
                        </button>
                      ) : null}
                      {outcomeNextAction.kind === "handoff" ? (
                        <button
                          type="button"
                          className={outcomeNextActionButtonClass}
                          onClick={() => void handleEscalationAction(outcomeNextAction)}
                          disabled={manualFollowThroughPendingId !== null}
                        >
                          {manualFollowThroughPendingId === outcomeNextAction.id ? "Opening..." : outcomeNextAction.label}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {lastCustomerUpdate?.manualFollowThrough?.state === "handled" ? (
                  <div className="stack-cell">
                    <span className="muted">{manualContactOutcomeSummary ? "Update contact outcome" : "Record contact outcome"}</span>
                    <div className="quick-links">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleRecordManualContactOutcome("confirmed_schedule")}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualContactOutcomePending === "confirmed_schedule" ? "Saving..." : "Confirmed Schedule"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleRecordManualContactOutcome("reschedule_needed")}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualContactOutcomePending === "reschedule_needed" ? "Saving..." : "Reschedule Needed"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleRecordManualContactOutcome("no_response")}
                        disabled={manualContactOutcomePending !== null || manualFollowThroughPendingId !== null}
                      >
                        {manualContactOutcomePending === "no_response" ? "Saving..." : "No Response"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {((lastCustomerUpdate?.manualFollowThrough?.state !== "handled") || manualClosureSummary?.state === "needs_action") &&
                remediationActions.length > 0 ? (
                  <div className="quick-links">
                    {remediationActions.map((action) =>
                      <button
                        key={`recovery-${action.id}`}
                        type="button"
                        className="btn secondary"
                        onClick={() => void handleEscalationAction(action)}
                        disabled={manualFollowThroughPendingId !== null}
                      >
                        {manualFollowThroughPendingId === action.id ? "Opening..." : action.label}
                      </button>,
                    )}
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void handleMarkHandledManually()}
                      disabled={manualFollowThroughPendingId !== null}
                    >
                      {manualFollowThroughPendingId === "mark-handled" ? "Saving..." : "Mark Handled Manually"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!customerUpdateState.pending && alreadySentAt ? (
              <p className="muted">Latest schedule change was already sent on {alreadySentAt}.</p>
            ) : null}

            {customerUpdateState.blockedReason ? <p className="muted">{customerUpdateState.blockedReason}</p> : null}

            {customerUpdateState.previewBody ? (
              <div className="stack-cell">
                <span className="muted">Preview</span>
                <p>{customerUpdateState.previewBody}</p>
              </div>
            ) : null}

            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSendCustomerUpdate()}
              disabled={!customerUpdateState.pending || !customerUpdateState.canSend || sendingCustomerUpdate}
            >
              {sendingCustomerUpdate
                ? "Sending..."
                : recoveryReady
                  ? "Resume Customer Update"
                  : retryableLastAttempt
                    ? "Retry Customer Update"
                    : "Send Customer Update"}
            </button>
          </div>
        </div>
      </section>

      {notice ? <p className="form-status">{notice}</p> : null}
      {error ? <p className="form-status error">{error}</p> : null}
    </div>
  );
}
