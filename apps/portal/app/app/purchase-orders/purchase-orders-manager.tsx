"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { formatJobReferenceLabel, type JobListItem } from "@/lib/job-records";
import type { MaterialListItem } from "@/lib/materials";
import {
  computePurchaseOrderLineTotal,
  createEmptyPurchaseOrderLineItem,
  purchaseOrderStatusOptions,
  type PurchaseOrderDetail,
  type PurchaseOrderLineItemRow,
  type PurchaseOrderListItem,
} from "@/lib/purchase-orders";

type PurchaseOrdersManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialJobId: string | null;
};

type PurchaseOrdersResponse = {
  ok?: boolean;
  purchaseOrders?: PurchaseOrderListItem[];
  error?: string;
} | null;

type PurchaseOrderResponse = {
  ok?: boolean;
  purchaseOrder?: PurchaseOrderDetail;
  error?: string;
} | null;

type MaterialsResponse = {
  ok?: boolean;
  materials?: MaterialListItem[];
  error?: string;
} | null;

type JobsResponse = {
  ok?: boolean;
  jobs?: JobListItem[];
  error?: string;
} | null;

type SendDraftResponse = {
  ok?: boolean;
  delivery?: "outlook" | "manual-draft";
  recipientEmail?: string | null;
  subject?: string;
  body?: string;
  mailtoUrl?: string | null;
  message?: string;
  purchaseOrder?: PurchaseOrderDetail;
  error?: string;
} | null;

type PurchaseOrderFormState = {
  jobId: string;
  vendorName: string;
  vendorEmail: string;
  vendorPhone: string;
  vendorAddress: string;
  title: string;
  notes: string;
  taxRatePercent: string;
  status: (typeof purchaseOrderStatusOptions)[number];
  lineItems: PurchaseOrderLineItemRow[];
};

type PurchaseOrderStatus = (typeof purchaseOrderStatusOptions)[number];

const defaultFormState: PurchaseOrderFormState = {
  jobId: "",
  vendorName: "",
  vendorEmail: "",
  vendorPhone: "",
  vendorAddress: "",
  title: "",
  notes: "",
  taxRatePercent: "0",
  status: "DRAFT",
  lineItems: [createEmptyPurchaseOrderLineItem()],
};

function formatMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getPurchaseOrdersCopy(locale: string) {
  const isSpanish = locale.startsWith("es");
  if (isSpanish) {
    return {
      errors: {
        loadJobs: "No se pudieron cargar los trabajos.",
        loadMaterials: "No se pudieron cargar los materiales.",
        loadReferences:
          "No se pudieron cargar las referencias de órdenes de compra.",
        loadOrders: "No se pudieron cargar las órdenes de compra.",
        loadOrder: "No se pudo cargar la orden de compra.",
        selectMaterial: "Elige primero un material.",
        readOnlySave:
          "Los usuarios en solo lectura no pueden guardar órdenes de compra.",
        save: "No se pudo guardar la orden de compra.",
        cancel: "No se pudo cancelar la orden de compra.",
        saveBeforeEmail:
          "Guarda la orden de compra antes de preparar el correo.",
        sendDraft: "No se pudo preparar el correo de la orden de compra.",
      },
      notices: {
        updated: "Orden de compra actualizada.",
        created: "Orden de compra creada.",
        cancelled: "Orden de compra cancelada.",
        sentOutlook: "Orden de compra enviada por Outlook.",
        emailDraftOpened:
          "Se abrió el borrador del correo en tu app. Actualiza la OC a Enviada cuando la entregues.",
        emailDraftNoVendor:
          "Se preparó el borrador del correo, pero no hay un email del proveedor adjunto.",
      },
      title: "Órdenes de compra",
      subtitle: (orgName: string) =>
        `Crea órdenes para proveedores de ${orgName}, vincúlalas a trabajos y envíalas desde Outlook cuando esté conectado.`,
      operationalJobHint:
        "Usa la página de trabajo operativo para despacho, agenda, seguimiento y comunicación con el cliente.",
      openOperationalJob: "Abrir trabajo operativo",
      newPurchaseOrder: "Nueva orden de compra",
      closeWorkspace: "Cerrar espacio",
      summary: {
        total: "Total de OCs",
        draftSent: "Borrador / Enviada",
        openCommitments: "Compromisos abiertos",
      },
      lookup: {
        title: "Búsqueda de órdenes de compra",
        subtitle:
          "Encuentra órdenes de proveedores ligadas a trabajos cuando necesites detalle de compras.",
        search: "Buscar",
        searchPlaceholder: "Número de OC, proveedor o título",
        status: "Estado",
        allStatuses: "Todos",
        job: "Trabajo",
        allJobs: "Todos los trabajos",
        table: {
          po: "OC",
          vendor: "Proveedor",
          job: "Trabajo",
          status: "Estado",
          total: "Total",
          loading: "Cargando órdenes de compra...",
          empty: "Aún no hay órdenes de compra.",
          noJob: "-",
        },
      },
      editor: {
        editTitle: "Editar orden de compra",
        addTitle: "Nueva orden de compra",
        subtitle:
          "Guarda primero la OC y luego envíala desde Outlook o prepara un borrador de correo si Outlook no está conectado para esta organización.",
        loading: "Cargando...",
        job: "Trabajo",
        standalonePo: "OC independiente",
        status: "Estado",
        vendorName: "Nombre del proveedor",
        poTitle: "Título de la OC",
        vendorEmail: "Email del proveedor",
        vendorPhone: "Teléfono del proveedor",
        vendorAddress: "Dirección del proveedor",
        notes: "Notas",
        taxRate: "Tasa de impuesto %",
        currentTotals: "Totales actuales",
        subtotal: "Subtotal",
        tax: "Impuesto",
        total: "Total",
      },
      lineItems: {
        title: "Partidas",
        subtitle:
          "Construye la OC desde materiales del catálogo o agrega artículos personalizados del proveedor.",
        addCatalogMaterial: "Agregar material del catálogo",
        addCatalogItem: "Agregar artículo del catálogo",
        addCustomLine: "Agregar línea personalizada",
        table: {
          item: "Artículo",
          qty: "Cant.",
          unit: "Unidad",
          unitCost: "Costo unitario",
          total: "Total",
          remove: "Quitar",
          namePlaceholder: "Grava drenante / block / flete",
          descriptionPlaceholder:
            "Especificación opcional o nota del proveedor",
        },
      },
      actions: {
        saving: "Guardando...",
        save: "Guardar OC",
        create: "Crear OC",
        sendEmail: "Enviar / Borrador de correo",
        cancelPo: "Cancelar OC",
      },
      statuses: {
        DRAFT: "Borrador",
        SENT: "Enviada",
        RECEIVED: "Recibida",
        CANCELLED: "Cancelada",
      } as Record<PurchaseOrderStatus, string>,
    };
  }

  return {
    errors: {
      loadJobs: "Failed to load jobs.",
      loadMaterials: "Failed to load materials.",
      loadReferences: "Failed to load purchase order references.",
      loadOrders: "Failed to load purchase orders.",
      loadOrder: "Failed to load purchase order.",
      selectMaterial: "Select a material first.",
      readOnlySave: "Read-only users cannot save purchase orders.",
      save: "Failed to save purchase order.",
      cancel: "Failed to cancel purchase order.",
      saveBeforeEmail: "Save the purchase order before preparing the email.",
      sendDraft: "Failed to prepare purchase order email.",
    },
    notices: {
      updated: "Purchase order updated.",
      created: "Purchase order created.",
      cancelled: "Purchase order cancelled.",
      sentOutlook: "Purchase order sent through Outlook.",
      emailDraftOpened:
        "Email draft opened in your mail app. Update the PO status to Sent once you deliver it.",
      emailDraftNoVendor:
        "Email draft prepared, but no vendor email is attached.",
    },
    title: "Purchase Orders",
    subtitle: (orgName: string) =>
      `Create supplier orders for ${orgName}, tie them to jobs, and send from Outlook when connected.`,
    operationalJobHint:
      "Use the Operational Job page for dispatch, schedule, tracking, and customer communication.",
    openOperationalJob: "Open Operational Job",
    newPurchaseOrder: "New Purchase Order",
    closeWorkspace: "Close Workspace",
    summary: {
      total: "Total POs",
      draftSent: "Draft / Sent",
      openCommitments: "Open Commitments",
    },
    lookup: {
      title: "Purchase Order Lookup",
      subtitle:
        "Find job-linked supplier orders when you need procurement detail.",
      search: "Search",
      searchPlaceholder: "PO number, vendor, title",
      status: "Status",
      allStatuses: "All",
      job: "Job",
      allJobs: "All jobs",
      table: {
        po: "PO",
        vendor: "Vendor",
        job: "Job",
        status: "Status",
        total: "Total",
        loading: "Loading purchase orders...",
        empty: "No purchase orders yet.",
        noJob: "-",
      },
    },
    editor: {
      editTitle: "Edit Purchase Order",
      addTitle: "New Purchase Order",
      subtitle:
        "Save the PO first, then send from Outlook or prepare a mail draft if Outlook is not connected for this org.",
      loading: "Loading...",
      job: "Job",
      standalonePo: "Standalone PO",
      status: "Status",
      vendorName: "Vendor name",
      poTitle: "PO title",
      vendorEmail: "Vendor email",
      vendorPhone: "Vendor phone",
      vendorAddress: "Vendor address",
      notes: "Notes",
      taxRate: "Tax rate %",
      currentTotals: "Current totals",
      subtotal: "Subtotal",
      tax: "Tax",
      total: "Total",
    },
    lineItems: {
      title: "Line Items",
      subtitle:
        "Build the PO from catalog materials or add custom supplier items.",
      addCatalogMaterial: "Add catalog material",
      addCatalogItem: "Add Catalog Item",
      addCustomLine: "Add Custom Line",
      table: {
        item: "Item",
        qty: "Qty",
        unit: "Unit",
        unitCost: "Unit Cost",
        total: "Total",
        remove: "Remove",
        namePlaceholder: "Drain rock / block / freight",
        descriptionPlaceholder: "Optional spec or vendor note",
      },
    },
    actions: {
      saving: "Saving...",
      save: "Save PO",
      create: "Create PO",
      sendEmail: "Send / Draft Email",
      cancelPo: "Cancel PO",
    },
    statuses: {
      DRAFT: "Draft",
      SENT: "Sent",
      RECEIVED: "Received",
      CANCELLED: "Cancelled",
    } as Record<PurchaseOrderStatus, string>,
  };
}

function applyLineTotal(
  row: PurchaseOrderLineItemRow,
): PurchaseOrderLineItemRow {
  return {
    ...row,
    total: computePurchaseOrderLineTotal({
      quantity: row.quantity,
      unitCost: row.unitCost,
    }),
  };
}

function applyDetailToForm(order: PurchaseOrderDetail): PurchaseOrderFormState {
  return {
    jobId: order.job?.id || "",
    vendorName: order.vendorName,
    vendorEmail: order.vendorEmail || "",
    vendorPhone: order.vendorPhone || "",
    vendorAddress: order.vendorAddress || "",
    title: order.title,
    notes: order.notes || "",
    taxRatePercent: order.taxRatePercent,
    status: order.status,
    lineItems: order.lineItems.map(applyLineTotal),
  };
}

function buildScopedQuery(input: {
  internalUser: boolean;
  orgId: string;
  search: string;
  status: string;
  jobId: string;
}): string {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.search.trim()) {
    params.set("q", input.search.trim());
  }
  if (input.status) {
    params.set("status", input.status);
  }
  if (input.jobId) {
    params.set("jobId", input.jobId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function PurchaseOrdersManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialJobId,
}: PurchaseOrdersManagerProps) {
  const locale = useLocale();
  const displayLocale = locale.startsWith("es") ? "es-US" : "en-US";
  const copy = useMemo(() => getPurchaseOrdersCopy(locale), [locale]);
  const router = useRouter();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderListItem[]>(
    [],
  );
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<
    string | null
  >(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(initialJobId));
  const [selectedCatalogMaterialId, setSelectedCatalogMaterialId] =
    useState("");
  const [form, setForm] = useState<PurchaseOrderFormState>({
    ...defaultFormState,
    jobId: initialJobId || "",
  });

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [jobFilter, setJobFilter] = useState(initialJobId || "");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const currentOperationalJobId = selectedPurchaseOrderId
    ? form.jobId || ""
    : jobFilter || form.jobId || "";
  const selectedOperationalJobHref = currentOperationalJobId
    ? internalUser
      ? `/app/jobs/records/${currentOperationalJobId}?orgId=${orgId}`
      : `/app/jobs/records/${currentOperationalJobId}`
    : null;

  const closeWorkspace = useCallback(() => {
    setWorkspaceOpen(false);
  }, []);

  useEffect(() => {
    if (!workspaceOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeWorkspace();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWorkspace, workspaceOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      setLoadingReferences(true);

      try {
        const params = new URLSearchParams();
        if (internalUser) {
          params.set("orgId", orgId);
        }

        const materialParams = new URLSearchParams(params);
        materialParams.set("active", "true");

        const [jobsResponse, materialsResponse] = await Promise.all([
          fetch(`/api/jobs?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/materials?${materialParams.toString()}`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const jobsPayload = (await jobsResponse
          .json()
          .catch(() => null)) as JobsResponse;
        const materialsPayload = (await materialsResponse
          .json()
          .catch(() => null)) as MaterialsResponse;

        if (
          !jobsResponse.ok ||
          !jobsPayload?.ok ||
          !Array.isArray(jobsPayload.jobs)
        ) {
          throw new Error(jobsPayload?.error || copy.errors.loadJobs);
        }
        if (
          !materialsResponse.ok ||
          !materialsPayload?.ok ||
          !Array.isArray(materialsPayload.materials)
        ) {
          throw new Error(materialsPayload?.error || copy.errors.loadMaterials);
        }

        if (cancelled) return;
        setJobs(jobsPayload.jobs);
        setMaterials(materialsPayload.materials);
      } catch (loadError) {
        if (cancelled) return;
        setJobs([]);
        setMaterials([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.errors.loadReferences,
        );
      } finally {
        if (!cancelled) {
          setLoadingReferences(false);
        }
      }
    }

    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [
    copy.errors.loadJobs,
    copy.errors.loadMaterials,
    copy.errors.loadReferences,
    internalUser,
    orgId,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadPurchaseOrders() {
      setLoadingList(true);

      try {
        const response = await fetch(
          `/api/purchase-orders${buildScopedQuery({
            internalUser,
            orgId,
            search: deferredSearch,
            status: statusFilter,
            jobId: jobFilter,
          })}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response
          .json()
          .catch(() => null)) as PurchaseOrdersResponse;
        if (
          !response.ok ||
          !payload?.ok ||
          !Array.isArray(payload.purchaseOrders)
        ) {
          throw new Error(payload?.error || copy.errors.loadOrders);
        }

        if (cancelled) return;
        setPurchaseOrders(payload.purchaseOrders);
      } catch (loadError) {
        if (cancelled) return;
        setPurchaseOrders([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.errors.loadOrders,
        );
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    }

    void loadPurchaseOrders();
    return () => {
      cancelled = true;
    };
  }, [
    copy.errors.loadOrders,
    deferredSearch,
    internalUser,
    jobFilter,
    orgId,
    refreshToken,
    statusFilter,
  ]);

  useEffect(() => {
    if (!selectedPurchaseOrderId) return;

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);

      try {
        const response = await fetch(
          `/api/purchase-orders/${selectedPurchaseOrderId}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response
          .json()
          .catch(() => null)) as PurchaseOrderResponse;
        if (!response.ok || !payload?.ok || !payload.purchaseOrder) {
          throw new Error(payload?.error || copy.errors.loadOrder);
        }

        if (cancelled) return;
        setForm(applyDetailToForm(payload.purchaseOrder));
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.errors.loadOrder,
        );
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [copy.errors.loadOrder, selectedPurchaseOrderId]);

  const totals = useMemo(() => {
    const subtotal = form.lineItems.reduce((sum, item) => sum + item.total, 0);
    const taxRate = Number.parseFloat(form.taxRatePercent || "0");
    const safeTaxRate = Number.isFinite(taxRate) ? Math.max(0, taxRate) : 0;
    const taxAmount = subtotal * (safeTaxRate / 100);
    return {
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
    };
  }, [form.lineItems, form.taxRatePercent]);

  const summary = useMemo(() => {
    const draftCount = purchaseOrders.filter(
      (order) => order.status === "DRAFT",
    ).length;
    const sentCount = purchaseOrders.filter(
      (order) => order.status === "SENT",
    ).length;
    const totalOpen = purchaseOrders
      .filter((order) => order.status !== "CANCELLED")
      .reduce((sum, order) => sum + order.total, 0);

    return {
      totalCount: purchaseOrders.length,
      draftCount,
      sentCount,
      totalOpen,
    };
  }, [purchaseOrders]);

  function resetEditor(nextJobId = jobFilter || initialJobId || "") {
    setSelectedPurchaseOrderId(null);
    setSelectedCatalogMaterialId("");
    setForm({
      ...defaultFormState,
      jobId: nextJobId,
    });
  }

  function beginCreate() {
    resetEditor();
    setWorkspaceOpen(true);
    setNotice(null);
    setError(null);
  }

  function updateForm<K extends keyof PurchaseOrderFormState>(
    field: K,
    value: PurchaseOrderFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addCustomLine() {
    updateForm("lineItems", [
      ...form.lineItems,
      createEmptyPurchaseOrderLineItem(),
    ]);
  }

  function addCatalogMaterial() {
    const material = materials.find(
      (entry) => entry.id === selectedCatalogMaterialId,
    );
    if (!material) {
      setError(copy.errors.selectMaterial);
      return;
    }

    updateForm("lineItems", [
      ...form.lineItems,
      applyLineTotal({
        ...createEmptyPurchaseOrderLineItem(),
        materialId: material.id,
        name: material.name,
        quantity: "1",
        unit: material.unit,
        unitCost: material.baseCost.toFixed(2),
      }),
    ]);
    setSelectedCatalogMaterialId("");
    setError(null);
  }

  function updateLineItem(
    index: number,
    patch: Partial<PurchaseOrderLineItemRow>,
  ) {
    updateForm(
      "lineItems",
      form.lineItems.map((lineItem, lineIndex) =>
        lineIndex === index
          ? applyLineTotal({
              ...lineItem,
              ...patch,
            })
          : lineItem,
      ),
    );
  }

  function removeLineItem(index: number) {
    updateForm(
      "lineItems",
      form.lineItems.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  async function savePurchaseOrder() {
    if (!canManage) {
      setError(copy.errors.readOnlySave);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const body = {
        ...(internalUser && !selectedPurchaseOrderId ? { orgId } : {}),
        jobId: form.jobId || null,
        vendorName: form.vendorName,
        vendorEmail: form.vendorEmail,
        vendorPhone: form.vendorPhone,
        vendorAddress: form.vendorAddress,
        title: form.title,
        notes: form.notes,
        taxRatePercent: form.taxRatePercent,
        status: form.status,
        lineItems: form.lineItems.map((item) => ({
          materialId: item.materialId,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.unitCost,
        })),
      };

      const response = await fetch(
        selectedPurchaseOrderId
          ? `/api/purchase-orders/${selectedPurchaseOrderId}`
          : "/api/purchase-orders",
        {
          method: selectedPurchaseOrderId ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as PurchaseOrderResponse;
      if (!response.ok || !payload?.ok || !payload.purchaseOrder) {
        throw new Error(payload?.error || copy.errors.save);
      }

      setSelectedPurchaseOrderId(payload.purchaseOrder.id);
      setWorkspaceOpen(true);
      setForm(applyDetailToForm(payload.purchaseOrder));
      setNotice(
        selectedPurchaseOrderId ? copy.notices.updated : copy.notices.created,
      );
      setRefreshToken((current) => current + 1);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : copy.errors.save,
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelSelectedPurchaseOrder() {
    if (!selectedPurchaseOrderId || !canManage) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/purchase-orders/${selectedPurchaseOrderId}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.errors.cancel);
      }

      setNotice(copy.notices.cancelled);
      resetEditor();
      closeWorkspace();
      setRefreshToken((current) => current + 1);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : copy.errors.cancel,
      );
    } finally {
      setSaving(false);
    }
  }

  async function prepareEmailDraft() {
    if (!selectedPurchaseOrderId) {
      setError(copy.errors.saveBeforeEmail);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/purchase-orders/${selectedPurchaseOrderId}/send`,
        {
          method: "POST",
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as SendDraftResponse;
      if (!response.ok || !payload?.ok || !payload.purchaseOrder) {
        throw new Error(payload?.error || copy.errors.sendDraft);
      }

      setForm(applyDetailToForm(payload.purchaseOrder));

      if (payload.delivery === "outlook") {
        setNotice(payload.message || copy.notices.sentOutlook);
      } else if (payload.mailtoUrl) {
        window.location.href = payload.mailtoUrl;
        setNotice(payload.message || copy.notices.emailDraftOpened);
      } else {
        setNotice(payload.message || copy.notices.emailDraftNoVendor);
      }
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : copy.errors.sendDraft,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="job-records-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>{copy.title}</h2>
            <p className="muted">{copy.subtitle(orgName)}</p>
            <p className="muted">{copy.operationalJobHint}</p>
          </div>
          <div className="portal-empty-actions">
            {selectedOperationalJobHref ? (
              <button
                className="btn primary"
                type="button"
                onClick={() => router.push(selectedOperationalJobHref)}
              >
                {copy.openOperationalJob}
              </button>
            ) : null}
            <button
              className={
                selectedOperationalJobHref ? "btn secondary" : "btn primary"
              }
              type="button"
              onClick={beginCreate}
            >
              {copy.newPurchaseOrder}
            </button>
          </div>
        </div>

        <div className="grid three-col" style={{ marginTop: 16 }}>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">{copy.summary.total}</p>
            <h3 style={{ marginTop: 6 }}>{summary.totalCount}</h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">{copy.summary.draftSent}</p>
            <h3 style={{ marginTop: 6 }}>
              {summary.draftCount} / {summary.sentCount}
            </h3>
          </article>
          <article className="card" style={{ margin: 0 }}>
            <p className="mini-label">{copy.summary.openCommitments}</p>
            <h3 style={{ marginTop: 6 }}>
              {formatMoney(summary.totalOpen, displayLocale)}
            </h3>
          </article>
        </div>

        {notice ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {error}
          </p>
        ) : null}
      </section>

      <div className="job-records-grid job-records-grid--list-only">
        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>{copy.lookup.title}</h3>
              <p className="muted">{copy.lookup.subtitle}</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              {copy.lookup.search}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={copy.lookup.searchPlaceholder}
              />
            </label>
            <label>
              {copy.lookup.status}
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.currentTarget.value)}
              >
                <option value="">{copy.lookup.allStatuses}</option>
                {purchaseOrderStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {copy.statuses[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.lookup.job}
              <select
                value={jobFilter}
                onChange={(event) => setJobFilter(event.currentTarget.value)}
              >
                <option value="">{copy.lookup.allJobs}</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {formatJobReferenceLabel(job)}
                  </option>
                ))}
              </select>
            </label>
          </form>

          <div className="table-shell" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>{copy.lookup.table.po}</th>
                  <th>{copy.lookup.table.vendor}</th>
                  <th>{copy.lookup.table.job}</th>
                  <th>{copy.lookup.table.status}</th>
                  <th>{copy.lookup.table.total}</th>
                </tr>
              </thead>
              <tbody>
                {loadingList ? (
                  <tr>
                    <td colSpan={5}>{copy.lookup.table.loading}</td>
                  </tr>
                ) : purchaseOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{copy.lookup.table.empty}</td>
                  </tr>
                ) : (
                  purchaseOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => {
                        setSelectedPurchaseOrderId(order.id);
                        setWorkspaceOpen(true);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <strong>{order.poNumber}</strong>
                        <div className="muted">{order.title}</div>
                      </td>
                      <td>{order.vendorName}</td>
                      <td>
                        {order.job
                          ? formatJobReferenceLabel(order.job)
                          : copy.lookup.table.noJob}
                      </td>
                      <td>{copy.statuses[order.status]}</td>
                      <td>{formatMoney(order.total, displayLocale)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {workspaceOpen ? (
        <div
          className="revenue-workspace-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeWorkspace();
            }
          }}
        >
          <section
            className="revenue-workspace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-order-workspace-title"
          >
            <div className="invoice-header-row revenue-workspace-modal-header">
              <div className="stack-cell">
                <h3 id="purchase-order-workspace-title">
                  {selectedPurchaseOrderId
                    ? copy.editor.editTitle
                    : copy.editor.addTitle}
                </h3>
                <p className="muted">{copy.editor.subtitle}</p>
              </div>
              <div className="portal-empty-actions">
                <button
                  className="btn secondary"
                  type="button"
                  onClick={closeWorkspace}
                >
                  {copy.closeWorkspace}
                </button>
              </div>
            </div>

            {loadingDetail || loadingReferences ? (
              <p className="form-status">{copy.editor.loading}</p>
            ) : null}

            <div className="auth-form" style={{ marginTop: 12 }}>
              <div className="grid two-col">
                <label>
                  {copy.editor.job}
                  <select
                    value={form.jobId}
                    onChange={(event) =>
                      updateForm("jobId", event.currentTarget.value)
                    }
                    disabled={!canManage}
                  >
                    <option value="">{copy.editor.standalonePo}</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {formatJobReferenceLabel(job)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.editor.status}
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateForm(
                        "status",
                        event.currentTarget
                          .value as (typeof purchaseOrderStatusOptions)[number],
                      )
                    }
                    disabled={!canManage}
                  >
                    {purchaseOrderStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {copy.statuses[status]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid two-col">
                <label>
                  {copy.editor.vendorName}
                  <input
                    value={form.vendorName}
                    onChange={(event) =>
                      updateForm("vendorName", event.currentTarget.value)
                    }
                    disabled={!canManage}
                  />
                </label>
                <label>
                  {copy.editor.poTitle}
                  <input
                    value={form.title}
                    onChange={(event) =>
                      updateForm("title", event.currentTarget.value)
                    }
                    disabled={!canManage}
                  />
                </label>
              </div>

              <div className="grid two-col">
                <label>
                  {copy.editor.vendorEmail}
                  <input
                    value={form.vendorEmail}
                    onChange={(event) =>
                      updateForm("vendorEmail", event.currentTarget.value)
                    }
                    disabled={!canManage}
                  />
                </label>
                <label>
                  {copy.editor.vendorPhone}
                  <input
                    value={form.vendorPhone}
                    onChange={(event) =>
                      updateForm("vendorPhone", event.currentTarget.value)
                    }
                    disabled={!canManage}
                  />
                </label>
              </div>

              <label>
                {copy.editor.vendorAddress}
                <textarea
                  rows={2}
                  value={form.vendorAddress}
                  onChange={(event) =>
                    updateForm("vendorAddress", event.currentTarget.value)
                  }
                  disabled={!canManage}
                />
              </label>

              <label>
                {copy.editor.notes}
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) =>
                    updateForm("notes", event.currentTarget.value)
                  }
                  disabled={!canManage}
                />
              </label>

              <div className="grid two-col">
                <label>
                  {copy.editor.taxRate}
                  <input
                    inputMode="decimal"
                    value={form.taxRatePercent}
                    onChange={(event) =>
                      updateForm("taxRatePercent", event.currentTarget.value)
                    }
                    disabled={!canManage}
                  />
                </label>
                <div
                  className="stack-cell"
                  style={{ justifyContent: "flex-end" }}
                >
                  <p className="mini-label">{copy.editor.currentTotals}</p>
                  <p className="muted">
                    {copy.editor.subtotal}{" "}
                    {formatMoney(totals.subtotal, displayLocale)} •{" "}
                    {copy.editor.tax}{" "}
                    {formatMoney(totals.taxAmount, displayLocale)} •{" "}
                    {copy.editor.total}{" "}
                    {formatMoney(totals.total, displayLocale)}
                  </p>
                </div>
              </div>
            </div>

            <section className="card" style={{ marginTop: 16 }}>
              <div className="invoice-header-row">
                <div className="stack-cell">
                  <h3>{copy.lineItems.title}</h3>
                  <p className="muted">{copy.lineItems.subtitle}</p>
                </div>
                <div className="portal-empty-actions">
                  <select
                    value={selectedCatalogMaterialId}
                    onChange={(event) =>
                      setSelectedCatalogMaterialId(event.currentTarget.value)
                    }
                    disabled={!canManage}
                  >
                    <option value="">
                      {copy.lineItems.addCatalogMaterial}
                    </option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name} • {material.category}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={addCatalogMaterial}
                    disabled={!canManage}
                  >
                    {copy.lineItems.addCatalogItem}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={addCustomLine}
                    disabled={!canManage}
                  >
                    {copy.lineItems.addCustomLine}
                  </button>
                </div>
              </div>

              <div className="table-shell" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{copy.lineItems.table.item}</th>
                      <th>{copy.lineItems.table.qty}</th>
                      <th>{copy.lineItems.table.unit}</th>
                      <th>{copy.lineItems.table.unitCost}</th>
                      <th>{copy.lineItems.table.total}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lineItems.map((item, index) => (
                      <tr key={item.id}>
                        <td style={{ minWidth: 220 }}>
                          <input
                            value={item.name}
                            onChange={(event) =>
                              updateLineItem(index, {
                                name: event.currentTarget.value,
                              })
                            }
                            placeholder={copy.lineItems.table.namePlaceholder}
                            disabled={!canManage}
                          />
                          <textarea
                            rows={2}
                            value={item.description}
                            onChange={(event) =>
                              updateLineItem(index, {
                                description: event.currentTarget.value,
                              })
                            }
                            placeholder={
                              copy.lineItems.table.descriptionPlaceholder
                            }
                            disabled={!canManage}
                            style={{ marginTop: 8 }}
                          />
                        </td>
                        <td>
                          <input
                            inputMode="decimal"
                            value={item.quantity}
                            onChange={(event) =>
                              updateLineItem(index, {
                                quantity: event.currentTarget.value,
                              })
                            }
                            disabled={!canManage}
                          />
                        </td>
                        <td>
                          <input
                            value={item.unit}
                            onChange={(event) =>
                              updateLineItem(index, {
                                unit: event.currentTarget.value,
                              })
                            }
                            disabled={!canManage}
                          />
                        </td>
                        <td>
                          <input
                            inputMode="decimal"
                            value={item.unitCost}
                            onChange={(event) =>
                              updateLineItem(index, {
                                unitCost: event.currentTarget.value,
                              })
                            }
                            disabled={!canManage}
                          />
                        </td>
                        <td>{formatMoney(item.total, displayLocale)}</td>
                        <td>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => removeLineItem(index)}
                            disabled={!canManage}
                          >
                            {copy.lineItems.table.remove}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="portal-empty-actions" style={{ marginTop: 16 }}>
              <button
                className="btn primary"
                type="button"
                onClick={() => void savePurchaseOrder()}
                disabled={saving || !canManage}
              >
                {saving
                  ? copy.actions.saving
                  : selectedPurchaseOrderId
                    ? copy.actions.save
                    : copy.actions.create}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => void prepareEmailDraft()}
                disabled={saving || !selectedPurchaseOrderId}
              >
                {copy.actions.sendEmail}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => void cancelSelectedPurchaseOrder()}
                disabled={saving || !selectedPurchaseOrderId || !canManage}
              >
                {copy.actions.cancelPo}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
