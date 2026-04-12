"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EstimatePhotosPanel from "./estimate-photos-panel";
import {
  canTransitionEstimateStatus,
  computeEstimateItemTotal,
  createBlankEstimateItem,
  createEstimateItemFromMaterial,
  estimateStatusOptions,
  formatEstimateCurrency,
  formatEstimateStatusLabel,
  getEstimateCustomerFacingIssues,
  summarizeEstimateItems,
  type EstimateDetail,
  type EstimateItemRow,
  type EstimateListItem,
  type EstimateReferenceLead,
} from "@/lib/estimates";
import { getDispatchTodayDateKey } from "@/lib/dispatch";
import type { MaterialListItem } from "@/lib/materials";

type EstimateManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialEstimateId: string | null;
  initialCreate: boolean;
  leadOptions: EstimateReferenceLead[];
  materials: MaterialListItem[];
};

type EstimateListResponse =
  | {
      ok?: boolean;
      estimates?: EstimateListItem[];
      error?: string;
    }
  | null;

type EstimateDetailResponse =
  | {
      ok?: boolean;
      estimate?: EstimateDetail;
      error?: string;
      message?: string;
      jobId?: string | null;
      invoiceId?: string | null;
      dispatchDate?: string | null;
      share?: {
        url?: string | null;
        expiresAt?: string | null;
      };
    }
  | null;

type EstimateTaxLookupResponse =
  | {
      ok?: boolean;
      taxRatePercent?: string;
      taxRateSource?: "WA_DOR";
      taxZipCode?: string;
      taxJurisdiction?: string;
      taxLocationCode?: string;
      taxCalculatedAt?: string;
      sourceLabel?: string;
      period?: string | null;
      error?: string;
    }
  | null;

type EstimateFormState = {
  leadId: string;
  title: string;
  customerName: string;
  siteAddress: string;
  projectType: string;
  description: string;
  notes: string;
  terms: string;
  taxRatePercent: string;
  taxRateSource: "MANUAL" | "WA_DOR";
  taxZipCode: string;
  taxJurisdiction: string;
  taxLocationCode: string;
  taxCalculatedAt: string;
  validUntil: string;
  status: (typeof estimateStatusOptions)[number];
  lineItems: EstimateItemRow[];
};

const emptyFormState: EstimateFormState = {
  leadId: "",
  title: "",
  customerName: "",
  siteAddress: "",
  projectType: "",
  description: "",
  notes: "",
  terms: "",
  taxRatePercent: "0",
  taxRateSource: "MANUAL",
  taxZipCode: "",
  taxJurisdiction: "",
  taxLocationCode: "",
  taxCalculatedAt: "",
  validUntil: "",
  status: "DRAFT",
  lineItems: [],
};

function extractZipCode(value: string): string {
  const match = value.match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? match[0].slice(0, 5) : "";
}

function hydrateLine(row: EstimateItemRow, index: number): EstimateItemRow {
  return {
    ...row,
    sortOrder: index,
    total: computeEstimateItemTotal({
      quantity: row.quantity,
      unitPrice: row.unitPrice,
    }),
  };
}

function estimateToForm(estimate: EstimateDetail): EstimateFormState {
  return {
    leadId: estimate.lead?.id || "",
    title: estimate.title,
    customerName: estimate.customerName,
    siteAddress: estimate.siteAddress,
    projectType: estimate.projectType,
    description: estimate.description,
    notes: estimate.notes,
    terms: estimate.terms,
    taxRatePercent: estimate.taxRatePercent,
    taxRateSource: estimate.taxRateSource,
    taxZipCode: estimate.taxZipCode,
    taxJurisdiction: estimate.taxJurisdiction,
    taxLocationCode: estimate.taxLocationCode,
    taxCalculatedAt: estimate.taxCalculatedAt || "",
    validUntil: estimate.validUntil ? estimate.validUntil.slice(0, 10) : "",
    status: estimate.status,
    lineItems: estimate.lineItems.map(hydrateLine),
  };
}

function buildEstimatePayload(form: EstimateFormState) {
  return {
    leadId: form.leadId || null,
    title: form.title,
    customerName: form.customerName,
    siteAddress: form.siteAddress,
    projectType: form.projectType,
    description: form.description,
    notes: form.notes,
    terms: form.terms,
    taxRatePercent: form.taxRatePercent,
    taxRateSource: form.taxRateSource,
    taxZipCode: form.taxZipCode || null,
    taxJurisdiction: form.taxJurisdiction || null,
    taxLocationCode: form.taxLocationCode || null,
    taxCalculatedAt: form.taxCalculatedAt || null,
    validUntil: form.validUntil ? new Date(`${form.validUntil}T12:00:00.000Z`).toISOString() : null,
    status: form.status,
    lineItems: form.lineItems.map((line, index) => ({
      id: line.id,
      materialId: line.materialId,
      type: line.type,
      sortOrder: index,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
    })),
  };
}

function buildPath(input: {
  estimateId: string | null;
  orgId: string;
  internalUser: boolean;
  mobileMode: boolean;
}) {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.mobileMode) {
    params.set("mobile", "1");
  }
  const query = params.toString();
  const base = input.estimateId ? `/app/estimates/${input.estimateId}` : "/app/estimates";
  return query ? `${base}?${query}` : base;
}

function buildDispatchPath(input: {
  date: string;
  jobId: string | null;
  orgId: string;
  internalUser: boolean;
  mobileMode: boolean;
}) {
  const params = new URLSearchParams();
  params.set("date", input.date);
  if (input.jobId) {
    params.set("jobId", input.jobId);
  }
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.mobileMode) {
    params.set("mobile", "1");
  }
  return `/app/dispatch?${params.toString()}`;
}

function formatWorkflowTimestamp(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

function formatShareStateLabel(value: string | null | undefined): string {
  if (!value) return "No Link";
  return value.replace(/_/g, " ");
}

function formatEstimateItemTypeLabel(type: EstimateItemRow["type"]): string {
  if (type === "LABOR") return "Labor";
  if (type === "CUSTOM_MATERIAL") return "Custom Scope";
  return "Catalog Material";
}

export default function EstimateManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialEstimateId,
  initialCreate,
  leadOptions,
  materials,
}: EstimateManagerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mobileMode = searchParams.get("mobile") === "1";
  const [estimates, setEstimates] = useState<EstimateListItem[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(initialEstimateId);
  const [selectedEstimate, setSelectedEstimate] = useState<EstimateDetail | null>(null);
  const [form, setForm] = useState<EstimateFormState>(emptyFormState);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(Boolean(initialEstimateId));
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [lookingUpTax, setLookingUpTax] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [revokingShare, setRevokingShare] = useState(false);
  const [copyingShare, setCopyingShare] = useState(false);
  const [latestShareUrl, setLatestShareUrl] = useState<string | null>(null);
  const [shareRecipientName, setShareRecipientName] = useState("");
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const autoCreated = useRef(false);

  const totals = useMemo(
    () => summarizeEstimateItems(form.lineItems.map((line, index) => ({ ...line, sortOrder: index })), form.taxRatePercent),
    [form.lineItems, form.taxRatePercent],
  );
  const linkedLead = useMemo(
    () => leadOptions.find((entry) => entry.id === form.leadId) || null,
    [form.leadId, leadOptions],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadEstimates() {
      setLoadingList(true);
      try {
        const params = new URLSearchParams();
        if (internalUser) {
          params.set("orgId", orgId);
        }
        if (deferredSearch.trim()) {
          params.set("q", deferredSearch.trim());
        }
        if (statusFilter) {
          params.set("status", statusFilter);
        }

        const response = await fetch(`/api/estimates?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as EstimateListResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.estimates)) {
          throw new Error(payload?.error || "Failed to load estimates.");
        }

        if (cancelled) return;
        setEstimates(payload.estimates);
      } catch (loadError) {
        if (cancelled) return;
        setEstimates([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load estimates.");
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    }

    void loadEstimates();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, internalUser, orgId, refreshToken, statusFilter]);

  useEffect(() => {
    if (!selectedEstimateId) {
      setSelectedEstimate(null);
      setForm(emptyFormState);
      setLoadingDetail(false);
      return;
    }

    let cancelled = false;

    async function loadEstimate() {
      setLoadingDetail(true);
      setError(null);

      try {
        const response = await fetch(`/api/estimates/${selectedEstimateId}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
        if (!response.ok || !payload?.ok || !payload.estimate) {
          throw new Error(payload?.error || "Failed to load estimate.");
        }

        if (cancelled) return;
        setSelectedEstimate(payload.estimate);
        setForm(estimateToForm(payload.estimate));
      } catch (loadError) {
        if (cancelled) return;
        setSelectedEstimate(null);
        setForm(emptyFormState);
        setError(loadError instanceof Error ? loadError.message : "Failed to load estimate.");
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadEstimate();
    return () => {
      cancelled = true;
    };
  }, [selectedEstimateId]);

  useEffect(() => {
    if (!initialCreate || autoCreated.current || !canManage) return;
    autoCreated.current = true;
    void handleCreateEstimate();
  }, [canManage, initialCreate]);

  useEffect(() => {
    setLatestShareUrl(null);
  }, [selectedEstimateId]);

  useEffect(() => {
    setShareRecipientName(selectedEstimate?.latestShareLink?.recipientName || "");
    setShareRecipientEmail(selectedEstimate?.latestShareLink?.recipientEmail || "");
  }, [selectedEstimate?.id, selectedEstimate?.latestShareLink?.recipientName, selectedEstimate?.latestShareLink?.recipientEmail]);

  function updatePath(nextEstimateId: string | null) {
    router.replace(
      buildPath({
        estimateId: nextEstimateId,
        orgId,
        internalUser,
        mobileMode,
      }),
    );
  }

  async function handleCreateEstimate() {
    if (!canManage) {
      setError("Read-only users cannot create estimates.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/estimates", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(internalUser ? { orgId } : {}),
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || "Failed to create estimate.");
      }

      setSelectedEstimateId(payload.estimate.id);
      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setNotice(`Estimate ${payload.estimate.estimateNumber} created.`);
      setRefreshToken((current) => current + 1);
      updatePath(payload.estimate.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create estimate.");
    } finally {
      setSaving(false);
    }
  }

  function updateForm<K extends keyof EstimateFormState>(field: K, value: EstimateFormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function setManualTaxRate(value: string) {
    setForm((current) => ({
      ...current,
      taxRatePercent: value,
      taxRateSource: "MANUAL",
      taxZipCode: "",
      taxJurisdiction: "",
      taxLocationCode: "",
      taxCalculatedAt: "",
    }));
  }

  function updateLead(linkedLeadId: string) {
    const lead = leadOptions.find((entry) => entry.id === linkedLeadId);
    updateForm("leadId", linkedLeadId);
    if (!lead) return;
    if (!form.customerName) {
      updateForm("customerName", lead.customerName || lead.label);
    }
  }

  async function handleLookupTaxRate(input?: { silent?: boolean }) {
    const siteAddress = form.siteAddress.trim();
    if (!siteAddress) {
      if (!input?.silent) {
        setError("Enter the job site address before looking up tax.");
      }
      return;
    }

    setLookingUpTax(true);
    if (!input?.silent) {
      setError(null);
      setNotice(null);
    }

    try {
      const response = await fetch("/api/estimates/tax-rate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(internalUser ? { orgId, siteAddress } : { siteAddress }),
      });
      const payload = (await response.json().catch(() => null)) as EstimateTaxLookupResponse;
      if (!response.ok || !payload?.ok || !payload.taxRatePercent) {
        throw new Error(payload?.error || "Failed to look up tax.");
      }

      setForm((current) => ({
        ...current,
        taxRatePercent: payload.taxRatePercent || current.taxRatePercent,
        taxRateSource: payload.taxRateSource || "WA_DOR",
        taxZipCode: payload.taxZipCode || "",
        taxJurisdiction: payload.taxJurisdiction || "",
        taxLocationCode: payload.taxLocationCode || "",
        taxCalculatedAt: payload.taxCalculatedAt || "",
      }));
      setError(null);
      setNotice(
        `Tax rate updated to ${payload.taxRatePercent}%${payload.taxJurisdiction ? ` for ${payload.taxJurisdiction}` : ""}${
          payload.taxZipCode ? ` (${payload.taxZipCode})` : ""
        }.`,
      );
    } catch (lookupError) {
      if (!input?.silent) {
        setError(lookupError instanceof Error ? lookupError.message : "Failed to look up tax.");
      }
    } finally {
      setLookingUpTax(false);
    }
  }

  function updateLine(lineId: string, patch: Partial<EstimateItemRow>) {
    updateForm(
      "lineItems",
      form.lineItems.map((line, index) =>
        line.id === lineId
          ? hydrateLine(
              {
                ...line,
                ...patch,
                sortOrder: index,
              },
              index,
            )
          : line,
      ),
    );
  }

  function addCatalogMaterial(materialId: string) {
    const material = materials.find((entry) => entry.id === materialId);
    if (!material) {
      setError("Select a catalog material first.");
      return;
    }

    updateForm(
      "lineItems",
      [
        ...form.lineItems,
        hydrateLine(
          {
            ...createEstimateItemFromMaterial(material),
            sortOrder: form.lineItems.length,
          },
          form.lineItems.length,
        ),
      ],
    );
    setError(null);
  }

  function addCustomMaterial() {
    updateForm(
      "lineItems",
      [
        ...form.lineItems,
        hydrateLine(
          {
            ...createBlankEstimateItem("CUSTOM_MATERIAL"),
            sortOrder: form.lineItems.length,
            name: "Custom Material",
          },
          form.lineItems.length,
        ),
      ],
    );
  }

  function addLaborLine() {
    updateForm(
      "lineItems",
      [
        ...form.lineItems,
        hydrateLine(
          {
            ...createBlankEstimateItem("LABOR"),
            sortOrder: form.lineItems.length,
            name: "Labor",
            unit: "hours",
          },
          form.lineItems.length,
        ),
      ],
    );
  }

  function removeLine(lineId: string) {
    updateForm(
      "lineItems",
      form.lineItems
        .filter((line) => line.id !== lineId)
        .map((line, index) => ({
          ...line,
          sortOrder: index,
        })),
    );
  }

  function moveLine(lineId: string, direction: -1 | 1) {
    const index = form.lineItems.findIndex((line) => line.id === lineId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.lineItems.length) return;

    const lines = [...form.lineItems];
    const [line] = lines.splice(index, 1);
    if (!line) return;
    lines.splice(nextIndex, 0, line);
    updateForm(
      "lineItems",
      lines.map((row, rowIndex) => ({
        ...row,
        sortOrder: rowIndex,
      })),
    );
  }

  async function handleSaveEstimate() {
    if (!selectedEstimateId) {
      await handleCreateEstimate();
      return;
    }

    if (!canManage) {
      setError("Read-only users cannot save estimates.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimates/${selectedEstimateId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildEstimatePayload(form)),
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || "Failed to save estimate.");
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setNotice(`Estimate ${payload.estimate.estimateNumber} saved.`);
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save estimate.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEstimate() {
    if (!selectedEstimateId) return;
    if (customerFacingIssueText) {
      setError(`Estimate is not ready to send. ${customerFacingIssueText}`);
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimates/${selectedEstimateId}/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipientName: shareRecipientName || null,
          recipientEmail: shareRecipientEmail || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || "Failed to send estimate.");
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      if (payload.share?.url) {
        setLatestShareUrl(payload.share.url);
      }
      setNotice(payload.message || "Estimate marked as sent for manual sharing.");
      setRefreshToken((current) => current + 1);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send estimate.");
    } finally {
      setSending(false);
    }
  }

  async function handleConvertEstimate(createInvoice: boolean) {
    if (!selectedEstimateId) return;
    if (createInvoice && selectedEstimate && selectedEstimate.total <= 0) {
      setError("Set a positive total before creating an invoice from this estimate.");
      return;
    }
    setConverting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimates/${selectedEstimateId}/convert`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          createJob: true,
          createInvoice,
          dispatchDate: getDispatchTodayDateKey(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || "Failed to convert estimate.");
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      if (payload.jobId && payload.dispatchDate) {
        router.push(
          buildDispatchPath({
            date: payload.dispatchDate,
            jobId: payload.jobId,
            orgId,
            internalUser,
            mobileMode,
          }),
        );
        return;
      }

      const notices = [`Estimate ${payload.estimate.estimateNumber} sent to dispatch.`];
      if (payload.jobId) notices.push(`Job created: ${payload.jobId}`);
      if (payload.invoiceId) notices.push(`Invoice draft created: ${payload.invoiceId}`);
      setNotice(notices.join(" "));
      setRefreshToken((current) => current + 1);
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : "Failed to convert estimate.");
    } finally {
      setConverting(false);
    }
  }

  async function handleArchiveEstimate() {
    if (!selectedEstimateId) return;
    setArchiving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimates/${selectedEstimateId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || "Failed to archive estimate.");
      }

      setNotice(`Estimate ${payload.estimate.estimateNumber} archived.`);
      setSelectedEstimateId(null);
      setSelectedEstimate(null);
      setForm(emptyFormState);
      setRefreshToken((current) => current + 1);
      updatePath(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Failed to archive estimate.");
    } finally {
      setArchiving(false);
    }
  }

  async function handleGenerateShareLink() {
    if (!selectedEstimateId) return;
    if (customerFacingIssueText) {
      setError(`Estimate is not ready to share. ${customerFacingIssueText}`);
      return;
    }
    setSharing(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimates/${selectedEstimateId}/share`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipientName: shareRecipientName || null,
          recipientEmail: shareRecipientEmail || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate || !payload.share?.url) {
        throw new Error(payload?.error || "Failed to generate share link.");
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setLatestShareUrl(payload.share.url);
      setNotice("Secure estimate link generated. Share it manually by email or SMS, then mark the estimate as sent once you deliver it.");
      setRefreshToken((current) => current + 1);
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "Failed to generate share link.");
    } finally {
      setSharing(false);
    }
  }

  async function handleRevokeShareLink() {
    if (!selectedEstimateId) return;
    setRevokingShare(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimates/${selectedEstimateId}/revoke-share`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || "Failed to revoke share link.");
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setLatestShareUrl(null);
      setNotice("Active customer share links were revoked.");
      setRefreshToken((current) => current + 1);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke share link.");
    } finally {
      setRevokingShare(false);
    }
  }

  async function handleCopyShareLink() {
    if (!latestShareUrl) return;
    setCopyingShare(true);
    try {
      await navigator.clipboard.writeText(latestShareUrl);
      setNotice("Share link copied to clipboard.");
    } catch {
      setError("Could not copy the share link automatically. Copy it manually from the field.");
    } finally {
      setCopyingShare(false);
    }
  }

  function selectEstimate(nextEstimateId: string) {
    setSelectedEstimateId(nextEstimateId);
    setNotice(null);
    setError(null);
    updatePath(nextEstimateId);
  }

  const savedCustomerFacingIssues = selectedEstimate
    ? getEstimateCustomerFacingIssues({
        title: selectedEstimate.title,
        customerName: selectedEstimate.customerName,
        leadLabel: selectedEstimate.lead?.label || "",
        lineItemCount: selectedEstimate.lineItems.length,
        total: selectedEstimate.total,
      })
    : [];
  const draftCustomerFacingIssues = selectedEstimate
    ? getEstimateCustomerFacingIssues({
        title: form.title,
        customerName: form.customerName,
        leadLabel: linkedLead?.label || selectedEstimate.lead?.label || "",
        lineItemCount: form.lineItems.length,
        total: totals.total,
      })
    : [];
  const customerFacingIssueText = savedCustomerFacingIssues.join(" ");
  const draftCustomerFacingIssueText = draftCustomerFacingIssues.join(" ");
  const readinessChanged = draftCustomerFacingIssueText !== customerFacingIssueText;
  const customerReadyLabel =
    draftCustomerFacingIssues.length === 0 ? "Customer-ready" : "Needs customer-facing details";
  const reviewStatusLabel = selectedEstimate
    ? selectedEstimate.status === "APPROVED"
      ? "Approved by customer"
      : selectedEstimate.status === "DECLINED"
        ? "Revision requested"
        : selectedEstimate.customerViewedAt
          ? "Viewed by customer"
          : selectedEstimate.sentAt || selectedEstimate.sharedAt
            ? "Sent for review"
            : selectedEstimate.latestShareLink
              ? "Share link ready"
              : "Not shared yet"
    : "Not started";
  const reviewStatusDetail = selectedEstimate
    ? selectedEstimate.status === "APPROVED"
      ? `Approved ${formatWorkflowTimestamp(selectedEstimate.approvedAt) || "recently"}.`
      : selectedEstimate.status === "DECLINED"
        ? `Customer asked for changes ${formatWorkflowTimestamp(selectedEstimate.declinedAt) || "recently"}.`
        : selectedEstimate.customerViewedAt
          ? `Viewed ${formatWorkflowTimestamp(selectedEstimate.customerViewedAt) || "recently"}.`
          : selectedEstimate.sentAt || selectedEstimate.sharedAt
            ? `Shared ${formatWorkflowTimestamp(selectedEstimate.sharedAt || selectedEstimate.sentAt) || "recently"}.`
            : selectedEstimate.latestShareLink
              ? "The secure customer link is ready to send."
              : "Shape the proposal and share it when it is ready."
    : "";
  const nextStepTitle = !selectedEstimate
    ? "Create a proposal"
    : draftCustomerFacingIssues.length > 0
      ? "Finish the customer-facing basics"
      : selectedEstimate.status === "APPROVED"
        ? "Move approved work into operations"
        : selectedEstimate.status === "DECLINED"
          ? "Revise and resend"
          : selectedEstimate.customerViewedAt
            ? "Follow up while the proposal is warm"
            : selectedEstimate.sentAt || selectedEstimate.sharedAt || selectedEstimate.latestShareLink
              ? "Get the customer to review it"
              : "Create the customer view";
  const nextStepDetail = !selectedEstimate
    ? "Start a new proposal, price the scope, and get it customer-ready."
    : draftCustomerFacingIssues.length > 0
      ? draftCustomerFacingIssues.join(" ")
      : selectedEstimate.status === "APPROVED"
        ? "Create the job, send it to dispatch, or spin up the invoice draft."
        : selectedEstimate.status === "DECLINED"
          ? "Review the customer note, adjust the proposal, and send a fresh link."
          : selectedEstimate.customerViewedAt
            ? "They have already seen it. Follow up or wait for approval, then move the work into ops."
            : selectedEstimate.sentAt || selectedEstimate.sharedAt || selectedEstimate.latestShareLink
              ? "Share the proposal and keep the next step clear so it closes quickly."
              : "Generate the secure customer link or send the proposal as soon as the scope is ready.";
  const canSend = Boolean(
    selectedEstimate &&
      ["DRAFT", "SENT", "VIEWED", "EXPIRED"].includes(selectedEstimate.status) &&
      savedCustomerFacingIssues.length === 0,
  );
  const canConvert = selectedEstimate?.status === "APPROVED";
  const canConvertToInvoice = Boolean(canConvert && selectedEstimate && selectedEstimate.total > 0);
  const canGenerateShare = Boolean(
    selectedEstimate &&
      ["DRAFT", "SENT", "VIEWED", "APPROVED"].includes(selectedEstimate.status) &&
      !selectedEstimate.archivedAt &&
      savedCustomerFacingIssues.length === 0,
  );
  const canRevokeShare = Boolean(selectedEstimate?.latestShareLink && selectedEstimate.latestShareLink.state === "ACTIVE");

  return (
    <div className="estimate-module-shell">
      <section className="card">
        <div className="invoice-header-row">
            <div className="stack-cell">
              <h2>Estimates</h2>
              <p className="muted">
                Prepare customer-ready proposals for {orgName}, track review, and move approved work into dispatch or invoicing.
              </p>
            </div>
          <div className="portal-empty-actions">
            <button className="btn primary" type="button" disabled={saving || !canManage} onClick={() => void handleCreateEstimate()}>
              New Estimate
            </button>
          </div>
        </div>

        {notice ? <p className="form-status" style={{ marginTop: 12 }}>{notice}</p> : null}
        {error ? <p className="form-status" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>

      <div className="estimate-module-grid">
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>Proposals</h3>
              <p className="muted">Search by customer, estimate number, or review status to reopen the right proposal fast.</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              Search
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Estimate number, customer, lead"
              />
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
                <option value="">All</option>
                {estimateStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatEstimateStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </form>

          {loadingList ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>Loading estimates...</strong>
            </div>
          ) : estimates.length === 0 ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>No estimates yet.</strong>
              <p className="muted">Create your first internal estimate to start pricing work.</p>
            </div>
          ) : (
            <div className="estimate-module-list">
              {estimates.map((estimate) => (
                <button
                  key={estimate.id}
                  className={`estimate-module-list-item ${selectedEstimateId === estimate.id ? "active" : ""}`}
                  type="button"
                  onClick={() => selectEstimate(estimate.id)}
                >
                  <div className="stack-cell">
                    <strong>{estimate.estimateNumber}</strong>
                    <span>{estimate.title}</span>
                    <span className="muted">{estimate.customerName || estimate.lead?.label || "No customer attached"}</span>
                  </div>
                  <div className="quick-meta">
                    <span className="badge">{formatEstimateStatusLabel(estimate.status)}</span>
                    <span className="badge">{formatEstimateCurrency(estimate.total)}</span>
                  </div>
                  <span className="muted">{estimate.siteAddress || estimate.projectType || "No site details yet"}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>{selectedEstimate ? `${selectedEstimate.estimateNumber} Proposal Workspace` : "Proposal Workspace"}</h3>
              <p className="muted">
                {selectedEstimate
                  ? "Shape the customer-facing proposal, confirm readiness, and move approved work into operations."
                  : "Select a proposal to shape its scope, pricing, and next step."}
              </p>
            </div>
            {selectedEstimate ? (
              <div className="portal-empty-actions">
                <Link className="btn secondary" href={buildPath({ estimateId: selectedEstimate.id, orgId, internalUser, mobileMode })}>
                  Open Full Page
                </Link>
              </div>
            ) : null}
          </div>

          {loadingDetail ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>Loading estimate...</strong>
            </div>
          ) : !selectedEstimate ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>No estimate selected.</strong>
              <p className="muted">Choose an estimate from the list or create a new one.</p>
            </div>
          ) : (
            <>
              <section className="estimate-module-section">
                <div className="estimate-proposal-grid">
                  <article className="estimate-proposal-card">
                    <span className="estimate-share-eyebrow">Project Summary</span>
                    <strong>{form.title || "Add a proposal title"}</strong>
                    <span>{form.customerName || linkedLead?.label || "Attach the customer or lead"}</span>
                    <span className="muted">{form.siteAddress || "Add the site address"}</span>
                    <div className="estimate-proposal-status-inline">
                      <span className="badge">{form.projectType || "Project Type"}</span>
                      {form.validUntil ? <span className="badge">Valid Until {new Date(`${form.validUntil}T12:00:00.000Z`).toLocaleDateString()}</span> : null}
                    </div>
                  </article>

                  <article className="estimate-proposal-card">
                    <span className="estimate-share-eyebrow">Customer Ready</span>
                    <strong>{customerReadyLabel}</strong>
                    <span>{reviewStatusLabel}</span>
                    <span className="muted">{reviewStatusDetail}</span>
                    {draftCustomerFacingIssues.length > 0 ? (
                      <ul className="estimate-proposal-issue-list">
                        {draftCustomerFacingIssues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">Customer-facing essentials are in place.</span>
                    )}
                    {readinessChanged ? (
                      <span className="muted">Save changes to refresh the live customer view used for sharing.</span>
                    ) : null}
                  </article>

                  <article className="estimate-proposal-card">
                    <span className="estimate-share-eyebrow">Next Step</span>
                    <strong>{nextStepTitle}</strong>
                    <span className="muted">{nextStepDetail}</span>
                    <div className="estimate-proposal-status-inline">
                      <span className="badge">{formatShareStateLabel(selectedEstimate.latestShareLink?.state)}</span>
                      <span className="badge">{formatEstimateStatusLabel(selectedEstimate.status)}</span>
                    </div>
                  </article>
                </div>
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Project Summary</h4>
                    <p className="muted">Set the customer-facing title, property details, and proposal terms before you share it.</p>
                  </div>
                </div>

                <form className="auth-form" style={{ marginTop: 14 }} onSubmit={(event) => event.preventDefault()}>
                  <div className="grid two-col">
                    <label>
                      Proposal Title
                    <input value={form.title} onChange={(event) => updateForm("title", event.currentTarget.value)} placeholder="Front yard refresh" />
                  </label>
                  <label>
                    Proposal Status
                    <select
                      value={form.status}
                      onChange={(event) => {
                        const nextStatus = event.currentTarget.value as EstimateFormState["status"];
                        if (!canTransitionEstimateStatus(selectedEstimate.status, nextStatus)) {
                          setError(`Cannot move this estimate from ${selectedEstimate.status} to ${nextStatus}.`);
                          return;
                        }
                        setError(null);
                        updateForm("status", nextStatus);
                      }}
                    >
                      {estimateStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatEstimateStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid two-col">
                  <label>
                    Lead
                    <select value={form.leadId} onChange={(event) => updateLead(event.currentTarget.value)}>
                      <option value="">No lead attached</option>
                      {leadOptions.map((lead) => (
                        <option key={lead.id} value={lead.id}>
                          {lead.label} · {lead.phoneE164}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Customer name
                    <input
                      value={form.customerName}
                      onChange={(event) => updateForm("customerName", event.currentTarget.value)}
                      placeholder="Maria Ramirez"
                    />
                  </label>
                </div>

                <div className="grid two-col">
                  <label>
                    Site address
                    <input
                      value={form.siteAddress}
                      onChange={(event) => updateForm("siteAddress", event.currentTarget.value)}
                      onBlur={() => {
                        const zipCode = extractZipCode(form.siteAddress);
                        const shouldAutoLookup =
                          Boolean(zipCode) &&
                          ((!form.taxCalculatedAt && /^0(?:\.0+)?$/.test((form.taxRatePercent || "0").trim() || "0")) ||
                            (form.taxRateSource === "WA_DOR" && form.taxZipCode !== zipCode));
                        if (shouldAutoLookup) {
                          void handleLookupTaxRate({ silent: true });
                        }
                      }}
                      placeholder="123 Cedar Ave"
                    />
                  </label>
                  <label>
                    Project type
                    <input
                      value={form.projectType}
                      onChange={(event) => updateForm("projectType", event.currentTarget.value)}
                      placeholder="Landscape install"
                    />
                  </label>
                </div>

                <div className="grid two-col">
                  <label>
                    Tax rate %
                    <div className="inline" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <input
                        value={form.taxRatePercent}
                        onChange={(event) => setManualTaxRate(event.currentTarget.value)}
                        style={{ flex: "1 1 180px" }}
                      />
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={lookingUpTax || !form.siteAddress.trim()}
                        onClick={() => void handleLookupTaxRate()}
                      >
                        {lookingUpTax ? "Looking up..." : "Auto from ZIP"}
                      </button>
                    </div>
                    <span className="muted">
                      {form.taxRateSource === "WA_DOR" && form.taxZipCode
                        ? `Auto tax from Washington DOR · ${form.taxZipCode}${form.taxJurisdiction ? ` · ${form.taxJurisdiction}` : ""}`
                        : "Auto tax is built in for Washington job ZIP codes. Type a manual rate any time to override it."}
                    </span>
                  </label>
                  <label>
                    Valid until
                    <input type="date" value={form.validUntil} onChange={(event) => updateForm("validUntil", event.currentTarget.value)} />
                  </label>
                </div>

                <label>
                  Project Summary
                  <textarea
                    value={form.description}
                    onChange={(event) => updateForm("description", event.currentTarget.value)}
                    rows={3}
                    placeholder="Short customer-facing overview of the project."
                  />
                </label>

                <label>
                  Internal Notes
                  <textarea
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.currentTarget.value)}
                    rows={4}
                    placeholder="Internal scope notes, follow-up reminders, or contractor-only context."
                  />
                </label>

                <label>
                  Customer Terms
                  <textarea
                    value={form.terms}
                    onChange={(event) => updateForm("terms", event.currentTarget.value)}
                    rows={4}
                    placeholder="Warranty, payment terms, scheduling notes, or customer-facing details."
                  />
                </label>
                </form>
              </section>

              <EstimatePhotosPanel
                estimateId={selectedEstimate.id}
                savedLeadId={selectedEstimate.lead?.id || null}
                pendingLeadId={form.leadId || null}
                canManage={canManage}
              />

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Customer Scope</h4>
                    <p className="muted">Shape the labor, materials, and custom scope the customer will review.</p>
                  </div>
                  <div className="portal-empty-actions">
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (event.currentTarget.value) {
                          addCatalogMaterial(event.currentTarget.value);
                          event.currentTarget.value = "";
                        }
                      }}
                    >
                      <option value="">Add catalog material</option>
                      {materials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.category} · {material.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn secondary" type="button" onClick={addCustomMaterial}>
                      Add Custom
                    </button>
                    <button className="btn secondary" type="button" onClick={addLaborLine}>
                      Add Labor
                    </button>
                  </div>
                </div>

                {form.lineItems.length === 0 ? (
                  <div className="portal-empty-state estimate-module-empty">
                    <strong>No customer scope yet.</strong>
                    <p className="muted">Add labor, catalog materials, or custom scope before sharing this proposal.</p>
                  </div>
                ) : (
                  <div className="estimate-scope-editor">
                    {form.lineItems.map((line, index) => (
                      <article className="estimate-scope-editor-card" key={line.id}>
                        <div className="estimate-scope-editor-card-header">
                          <div className="stack-cell">
                            <span className="estimate-share-eyebrow">Scope Item {index + 1}</span>
                            <label>
                              Customer-facing item name
                              <input
                                value={line.name}
                                onChange={(event) => updateLine(line.id, { name: event.currentTarget.value })}
                                placeholder="Landscape installation labor"
                              />
                            </label>
                          </div>
                          <div className="estimate-scope-editor-total">
                            <span className="muted">{formatEstimateItemTypeLabel(line.type)}</span>
                            <strong>{formatEstimateCurrency(line.total)}</strong>
                          </div>
                        </div>

                        <label>
                          Scope detail
                          <textarea
                            value={line.description}
                            onChange={(event) => updateLine(line.id, { description: event.currentTarget.value })}
                            rows={2}
                            placeholder="What this item covers for the customer."
                          />
                        </label>

                        <div className="estimate-scope-editor-fields">
                          <label>
                            Type
                            <select value={line.type} onChange={(event) => updateLine(line.id, { type: event.currentTarget.value as EstimateItemRow["type"] })}>
                              <option value="MATERIAL">Catalog Material</option>
                              <option value="CUSTOM_MATERIAL">Custom Scope</option>
                              <option value="LABOR">Labor</option>
                            </select>
                          </label>
                          <label>
                            Quantity
                            <input value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.currentTarget.value })} />
                          </label>
                          <label>
                            Unit
                            <input value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.currentTarget.value })} />
                          </label>
                          <label>
                            Unit price
                            <input value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: event.currentTarget.value })} />
                          </label>
                        </div>

                        <div className="estimate-module-line-actions">
                          <button className="btn secondary" type="button" onClick={() => moveLine(line.id, -1)} disabled={index === 0}>
                            Move Up
                          </button>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => moveLine(line.id, 1)}
                            disabled={index === form.lineItems.length - 1}
                          >
                            Move Down
                          </button>
                          <button className="btn secondary" type="button" onClick={() => removeLine(line.id)}>
                            Remove
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Pricing / Investment</h4>
                    <p className="muted">Keep the investment clear before you share the proposal or convert it into real work.</p>
                  </div>
                </div>

                <div className="estimate-summary-grid">
                  <article className="card estimate-summary-card">
                    <span className="muted">Subtotal</span>
                    <strong>{formatEstimateCurrency(totals.subtotal)}</strong>
                  </article>
                  <article className="card estimate-summary-card">
                    <span className="muted">Tax</span>
                    <strong>{formatEstimateCurrency(totals.tax)}</strong>
                  </article>
                  <article className="card estimate-summary-card estimate-summary-card--final">
                    <span className="muted">Total</span>
                    <strong>{formatEstimateCurrency(totals.total)}</strong>
                  </article>
                </div>
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Share & Approval</h4>
                    <p className="muted">
                      Deliver the customer view, track review activity, and keep the proposal moving toward approval.
                    </p>
                  </div>
                </div>

                <div className="estimate-share-internal-card" style={{ marginTop: 12 }}>
                  <div className="estimate-proposal-status-inline" style={{ marginBottom: 12 }}>
                    <span className="badge">{customerReadyLabel}</span>
                    <span className="badge">{reviewStatusLabel}</span>
                    <span className="muted">{reviewStatusDetail}</span>
                  </div>

                  <div className="grid two-col" style={{ marginTop: 0 }}>
                    <label>
                      Recipient name
                      <input
                        value={shareRecipientName}
                        onChange={(event) => setShareRecipientName(event.currentTarget.value)}
                        placeholder="Customer name"
                      />
                    </label>
                    <label>
                      Recipient email
                      <input
                        type="email"
                        value={shareRecipientEmail}
                        onChange={(event) => setShareRecipientEmail(event.currentTarget.value)}
                        placeholder="customer@example.com"
                      />
                    </label>
                  </div>

                  <div className="estimate-share-inline-meta">
                    <span className="badge">
                      {selectedEstimate.latestShareLink ? formatShareStateLabel(selectedEstimate.latestShareLink.state) : "No Link"}
                    </span>
                    <span className="muted">
                      {selectedEstimate.sharedAt
                        ? `Last shared ${new Date(selectedEstimate.sharedAt).toLocaleString()}`
                        : "No customer link generated yet."}
                    </span>
                    {selectedEstimate.shareExpiresAt ? (
                      <span className="muted">Expires {new Date(selectedEstimate.shareExpiresAt).toLocaleString()}</span>
                    ) : null}
                    {selectedEstimate.customerViewedAt ? (
                      <span className="muted">Customer viewed {new Date(selectedEstimate.customerViewedAt).toLocaleString()}</span>
                    ) : null}
                    {selectedEstimate.customerDecisionAt ? (
                      <span className="muted">
                        Customer decision {new Date(selectedEstimate.customerDecisionAt).toLocaleString()}
                        {selectedEstimate.customerDecisionName ? ` by ${selectedEstimate.customerDecisionName}` : ""}
                      </span>
                    ) : null}
                  </div>

                  {selectedEstimate.latestShareLink?.recipientName ||
                  selectedEstimate.latestShareLink?.recipientEmail ||
                  selectedEstimate.latestShareLink?.recipientPhoneE164 ? (
                    <p className="muted" style={{ marginTop: 8 }}>
                      Latest recipient:
                      {[selectedEstimate.latestShareLink.recipientName, selectedEstimate.latestShareLink.recipientEmail, selectedEstimate.latestShareLink.recipientPhoneE164]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}

                  {latestShareUrl ? (
                    <div className="estimate-share-link-box" style={{ marginTop: 12 }}>
                      <label>
                        Secure proposal link
                        <input value={latestShareUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                      </label>
                      <div className="portal-empty-actions">
                        <button className="btn secondary" type="button" disabled={copyingShare} onClick={() => void handleCopyShareLink()}>
                          {copyingShare ? "Copying..." : "Copy Link"}
                        </button>
                      </div>
                    </div>
                  ) : selectedEstimate.latestShareLink ? (
                    <p className="muted" style={{ marginTop: 12 }}>
                      A secure link exists but the raw URL cannot be reloaded from storage. Generate a fresh link if you need to copy it again.
                    </p>
                  ) : null}

                  <div className="portal-empty-actions" style={{ marginTop: 12 }}>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={!canManage || !canGenerateShare || sharing}
                      onClick={() => void handleGenerateShareLink()}
                    >
                      {sharing ? "Generating..." : selectedEstimate.latestShareLink ? "Refresh Share Link" : "Create Share Link"}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={!canManage || !canRevokeShare || revokingShare}
                      onClick={() => void handleRevokeShareLink()}
                    >
                      {revokingShare ? "Revoking..." : "Revoke Share Link"}
                    </button>
                    {latestShareUrl ? (
                      <a className="btn secondary" href={latestShareUrl} target="_blank" rel="noreferrer">
                        Open Customer View
                      </a>
                    ) : null}
                  </div>
                  {customerFacingIssueText ? (
                    <p className="form-status" style={{ marginTop: 12 }}>
                      Before sharing the live proposal: {customerFacingIssueText}
                    </p>
                  ) : null}
                  {readinessChanged ? (
                    <p className="muted" style={{ marginTop: 12 }}>
                      You have unsaved customer-facing edits. Save first if you want the shared proposal to match what you see here.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Next Step</h4>
                    <p className="muted">{nextStepDetail}</p>
                  </div>
                </div>

                <div className="portal-empty-actions" style={{ marginTop: 12 }}>
                  <button className="btn primary" type="button" disabled={!canManage || saving} onClick={() => void handleSaveEstimate()}>
                    {saving ? "Saving..." : "Save Proposal"}
                  </button>
                  <button className="btn secondary" type="button" disabled={!canManage || !canSend || sending} onClick={() => void handleSendEstimate()}>
                    {sending ? "Sending..." : "Send Proposal"}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canManage || !canConvert || converting}
                    onClick={() => void handleConvertEstimate(false)}
                  >
                    {converting ? "Sending..." : "Send to Dispatch"}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canManage || !canConvertToInvoice || converting}
                    onClick={() => void handleConvertEstimate(true)}
                  >
                    {converting ? "Sending..." : "Send to Dispatch + Invoice Draft"}
                  </button>
                  <button className="btn secondary" type="button" disabled={!canManage || archiving} onClick={() => void handleArchiveEstimate()}>
                    {archiving ? "Archiving..." : "Archive Proposal"}
                  </button>
                </div>
                {selectedEstimate && selectedEstimate.total <= 0 ? (
                  <p className="form-status" style={{ marginTop: 12 }}>
                    Set a positive total before creating an invoice draft from this proposal.
                  </p>
                ) : null}
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>Proposal Activity</h4>
                  </div>
                </div>
                {selectedEstimate.activities.length === 0 ? (
                  <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
                    <strong>No activity yet.</strong>
                  </div>
                ) : (
                  <ul className="timeline" style={{ marginTop: 12 }}>
                    {selectedEstimate.activities.map((activity) => (
                      <li key={activity.id} className="timeline-item">
                        <span className="timeline-dot" />
                        <div className="timeline-content">
                          <strong>{activity.description}</strong>
                          <span className="muted">{activity.actorName}</span>
                          <span className="muted">{new Date(activity.createdAt).toLocaleString()}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
