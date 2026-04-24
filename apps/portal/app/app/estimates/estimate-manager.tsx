"use client";

import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  formatDateForDisplay,
  formatDateTimeForDisplay,
} from "@/lib/calendar/dates";
import EstimatePhotosPanel from "./estimate-photos-panel";
import {
  canTransitionEstimateStatus,
  computeEstimateItemTotal,
  createBlankEstimateItem,
  createEstimateItemFromMaterial,
  estimateStatusOptions,
  formatEstimateCurrency,
  isPlaceholderEstimateTitle,
  requiresEstimateCustomerFacingReadiness,
  summarizeEstimateItems,
  type EstimateDetail,
  type EstimateItemRow,
  type EstimateListItem,
  type EstimateReferenceLead,
} from "@/lib/estimates";
import { getDispatchTodayDateKey } from "@/lib/dispatch";
import type { MaterialListItem } from "@/lib/materials";
import type enMessages from "@/messages/en.json";

type EstimateManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialEstimateId: string | null;
  initialCreate: boolean;
  initialLeadId: string | null;
  leadOptions: EstimateReferenceLead[];
  materials: MaterialListItem[];
};

type EstimateListResponse = {
  ok?: boolean;
  estimates?: EstimateListItem[];
  error?: string;
} | null;

type EstimateDetailResponse = {
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
} | null;

type EstimateTaxLookupResponse = {
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
} | null;

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

type StatusTranslationKey = keyof typeof enMessages.status;

const ESTIMATE_STATUS_TRANSLATION_KEYS = new Set<StatusTranslationKey>([
  "draft",
  "sent",
  "viewed",
  "approved",
  "declined",
  "expired",
  "converted",
]);

type EstimateManagerCopy = {
  page: {
    title: string;
    subtitle: string;
    newEstimate: string;
    listTitle: string;
    listSubtitle: string;
    search: string;
    searchPlaceholder: string;
    status: string;
    loadingList: string;
    emptyTitle: string;
    emptyBody: string;
    noCustomerAttached: string;
    noSiteDetails: string;
  };
  workspace: {
    title: string;
    titleWithNumber: (estimateNumber: string) => string;
    subtitle: string;
    emptySubtitle: string;
    openFullPage: string;
    loading: string;
    emptyTitle: string;
    emptyBody: string;
  };
  cards: {
    projectSummary: string;
    customerReady: string;
    nextStep: string;
    addEstimateTitle: string;
    attachCustomerOrLead: string;
    addSiteAddress: string;
    projectType: string;
    validUntil: string;
    ready: string;
    needsDetails: string;
    readyBody: string;
    refreshCustomerView: string;
  };
  form: {
    projectSummaryTitle: string;
    projectSummaryBody: string;
    estimateTitle: string;
    estimateTitlePlaceholder: string;
    estimateStatus: string;
    lead: string;
    noLeadAttached: string;
    customerName: string;
    customerNamePlaceholder: string;
    siteAddress: string;
    siteAddressPlaceholder: string;
    projectType: string;
    projectTypePlaceholder: string;
    taxRate: string;
    lookingUp: string;
    autoFromZip: string;
    autoTaxFrom: (zipCode: string, jurisdiction: string) => string;
    autoTaxBody: string;
    validUntil: string;
    projectSummaryField: string;
    projectSummaryPlaceholder: string;
    internalNotes: string;
    internalNotesPlaceholder: string;
    customerTerms: string;
    customerTermsPlaceholder: string;
  };
  scope: {
    title: string;
    body: string;
    addCatalogMaterial: string;
    addCustom: string;
    addLabor: string;
    emptyTitle: string;
    emptyBody: string;
    item: (index: number) => string;
    itemName: string;
    itemNamePlaceholder: string;
    detail: string;
    detailPlaceholder: string;
    type: string;
    catalogMaterial: string;
    customScope: string;
    labor: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    moveUp: string;
    moveDown: string;
    remove: string;
  };
  pricing: {
    title: string;
    body: string;
    subtotal: string;
    tax: string;
    total: string;
  };
  share: {
    title: string;
    body: string;
    recipientName: string;
    recipientNamePlaceholder: string;
    recipientEmail: string;
    recipientEmailPlaceholder: string;
    noLink: string;
    noLinkBody: string;
    lastShared: (value: string) => string;
    expires: (value: string) => string;
    customerViewed: (value: string) => string;
    customerDecision: (
      value: string,
      decisionName: string | null | undefined,
    ) => string;
    latestRecipient: string;
    secureLink: string;
    copying: string;
    copyLink: string;
    rawUrlMissing: string;
    generating: string;
    refreshShareLink: string;
    createShareLink: string;
    revoking: string;
    revokeShareLink: string;
    openCustomerView: string;
    beforeSending: string;
    unsavedEdits: string;
  };
  actions: {
    save: string;
    saving: string;
    send: string;
    sending: string;
    scheduleJob: string;
    scheduleJobDraftInvoice: string;
    scheduling: string;
    archive: string;
    archiving: string;
    positiveTotalWarning: string;
  };
  activity: {
    title: string;
    emptyTitle: string;
    created: string;
    updated: string;
    shareCreated: string;
    shareRevoked: string;
    sent: string;
    viewed: string;
    approved: string;
    declined: string;
    archived: string;
    itemAdded: string;
    itemRemoved: string;
    statusChanged: string;
    convertedToJob: string;
    convertedToInvoice: string;
  };
  review: {
    notStarted: string;
    approved: string;
    declined: string;
    viewed: string;
    sent: string;
    expired: string;
    notShared: string;
    approvedDetail: (value: string | null) => string;
    declinedDetail: (value: string | null) => string;
    viewedDetail: (value: string | null) => string;
    sentDetail: (value: string | null) => string;
    expiredDetail: string;
    notSharedDetail: string;
  };
  nextStep: {
    createEstimateTitle: string;
    finishBasicsTitle: string;
    moveApprovedTitle: string;
    reviseResendTitle: string;
    followUpWarmTitle: string;
    getReviewTitle: string;
    createCustomerViewTitle: string;
    createEstimateDetail: string;
    moveApprovedDetail: string;
    reviseResendDetail: string;
    followUpWarmDetail: string;
    getReviewDetail: string;
    createCustomerViewDetail: string;
  };
  issues: {
    title: string;
    customer: string;
    lineItems: string;
    total: string;
  };
  shareStates: {
    noLink: string;
    active: string;
    revoked: string;
    expired: string;
    approved: string;
    declined: string;
    viewed: string;
  };
  messages: {
    failedLoadEstimates: string;
    failedLoadEstimate: string;
    readOnlyCreate: string;
    failedCreate: string;
    created: (estimateNumber: string) => string;
    enterSiteAddress: string;
    failedLookupTax: string;
    taxRateUpdated: (
      taxRatePercent: string,
      jurisdiction: string,
      zipCode: string,
    ) => string;
    selectCatalogMaterial: string;
    readOnlySave: string;
    notReadyForStatus: (statusLabel: string, issues: string) => string;
    failedSave: string;
    saved: (estimateNumber: string) => string;
    notReadyToSend: (issues: string) => string;
    failedSend: string;
    sentManualShare: string;
    positiveTotalBeforeInvoice: string;
    failedConvert: string;
    sentToDispatch: (estimateNumber: string) => string;
    jobCreated: (jobId: string) => string;
    invoiceDraftCreated: (invoiceId: string) => string;
    failedArchive: string;
    archived: (estimateNumber: string) => string;
    notReadyToShare: (issues: string) => string;
    failedGenerateShareLink: string;
    shareLinkGenerated: string;
    failedRevokeShareLink: string;
    shareLinksRevoked: string;
    shareLinkCopied: string;
    shareLinkCopyFailed: string;
    invalidStatusTransition: (from: string, to: string) => string;
  };
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

function getEstimateManagerCopy(locale: string): EstimateManagerCopy {
  if (locale.startsWith("es")) {
    return {
      page: {
        title: "Estimados",
        subtitle:
          "Prepara estimados listos para el cliente para {orgName}, sigue la revision y mueve el trabajo aprobado a agenda o facturacion.",
        newEstimate: "Nuevo estimado",
        listTitle: "Estimados",
        listSubtitle:
          "Busca por cliente, numero de estimado o estado para reabrir el estimado correcto rapido.",
        search: "Buscar",
        searchPlaceholder: "Numero de estimado, cliente o lead",
        status: "Estado",
        loadingList: "Cargando estimados...",
        emptyTitle: "Aun no hay estimados.",
        emptyBody:
          "Crea tu primer estimado interno para empezar a cotizar trabajo.",
        noCustomerAttached: "Sin cliente adjunto",
        noSiteDetails: "Aun no hay detalles del sitio",
      },
      workspace: {
        title: "Espacio del estimado",
        titleWithNumber: (estimateNumber) =>
          `${estimateNumber} Espacio del estimado`,
        subtitle:
          "Da forma al estimado para el cliente, confirma que este listo y mueve el trabajo aprobado a operaciones.",
        emptySubtitle:
          "Selecciona un estimado para dar forma al alcance, precio y siguiente paso.",
        openFullPage: "Abrir pagina completa",
        loading: "Cargando estimado...",
        emptyTitle: "No hay estimado seleccionado.",
        emptyBody: "Elige un estimado de la lista o crea uno nuevo.",
      },
      cards: {
        projectSummary: "Resumen del proyecto",
        customerReady: "Listo para cliente",
        nextStep: "Siguiente paso",
        addEstimateTitle: "Agrega un titulo para el estimado",
        attachCustomerOrLead: "Adjunta el cliente o lead",
        addSiteAddress: "Agrega la direccion del sitio",
        projectType: "Tipo de proyecto",
        validUntil: "Valido hasta",
        ready: "Listo para cliente",
        needsDetails: "Faltan detalles para el cliente",
        readyBody: "Los datos clave para el cliente ya estan listos.",
        refreshCustomerView:
          "Guarda los cambios para refrescar la vista del cliente usada al compartir.",
      },
      form: {
        projectSummaryTitle: "Resumen del proyecto",
        projectSummaryBody:
          "Configura el titulo visible para el cliente, los detalles de la propiedad y los terminos antes de enviarlo.",
        estimateTitle: "Titulo del estimado",
        estimateTitlePlaceholder: "Renovacion del patio frontal",
        estimateStatus: "Estado del estimado",
        lead: "Lead",
        noLeadAttached: "Sin lead adjunto",
        customerName: "Nombre del cliente",
        customerNamePlaceholder: "Maria Ramirez",
        siteAddress: "Direccion del sitio",
        siteAddressPlaceholder: "123 Cedar Ave",
        projectType: "Tipo de proyecto",
        projectTypePlaceholder: "Instalacion de paisaje",
        taxRate: "Impuesto %",
        lookingUp: "Buscando...",
        autoFromZip: "Auto por ZIP",
        autoTaxFrom: (zipCode, jurisdiction) =>
          `Impuesto automatico desde Washington DOR · ${zipCode}${jurisdiction ? ` · ${jurisdiction}` : ""}`,
        autoTaxBody:
          "El impuesto automatico funciona para ZIP de trabajos en Washington. Puedes escribir una tarifa manual cuando quieras.",
        validUntil: "Valido hasta",
        projectSummaryField: "Resumen del proyecto",
        projectSummaryPlaceholder:
          "Resumen breve del proyecto visible para el cliente.",
        internalNotes: "Notas internas",
        internalNotesPlaceholder:
          "Notas internas de alcance, recordatorios de seguimiento o contexto solo para el contratista.",
        customerTerms: "Terminos para el cliente",
        customerTermsPlaceholder:
          "Garantia, terminos de pago, notas de agenda o detalles visibles para el cliente.",
      },
      scope: {
        title: "Alcance para el cliente",
        body: "Da forma a la mano de obra, materiales y alcance personalizado que el cliente revisara.",
        addCatalogMaterial: "Agregar material del catalogo",
        addCustom: "Agregar personalizado",
        addLabor: "Agregar mano de obra",
        emptyTitle: "Aun no hay alcance para el cliente.",
        emptyBody:
          "Agrega mano de obra, materiales del catalogo o alcance personalizado antes de enviar este estimado.",
        item: (index) => `Partida ${index}`,
        itemName: "Nombre de la partida para el cliente",
        itemNamePlaceholder: "Mano de obra para instalacion de paisaje",
        detail: "Detalle del alcance",
        detailPlaceholder: "Lo que cubre esta partida para el cliente.",
        type: "Tipo",
        catalogMaterial: "Material del catalogo",
        customScope: "Alcance personalizado",
        labor: "Mano de obra",
        quantity: "Cantidad",
        unit: "Unidad",
        unitPrice: "Precio unitario",
        moveUp: "Subir",
        moveDown: "Bajar",
        remove: "Quitar",
      },
      pricing: {
        title: "Precio / Inversion",
        body: "Mantén clara la inversion antes de enviar el estimado o convertirlo en trabajo real.",
        subtotal: "Subtotal",
        tax: "Impuesto",
        total: "Total",
      },
      share: {
        title: "Envio y aprobacion",
        body: "Entrega la vista del cliente, sigue la actividad de revision y mantén el estimado avanzando hacia la aprobacion.",
        recipientName: "Nombre del destinatario",
        recipientNamePlaceholder: "Nombre del cliente",
        recipientEmail: "Correo del destinatario",
        recipientEmailPlaceholder: "cliente@ejemplo.com",
        noLink: "Sin enlace",
        noLinkBody: "Aun no se ha generado un enlace para el cliente.",
        lastShared: (value) => `Ultimo envio ${value}`,
        expires: (value) => `Expira ${value}`,
        customerViewed: (value) => `Cliente lo vio ${value}`,
        customerDecision: (value, decisionName) =>
          `Decision del cliente ${value}${decisionName ? ` por ${decisionName}` : ""}`,
        latestRecipient: "Ultimo destinatario:",
        secureLink: "Enlace seguro del estimado",
        copying: "Copiando...",
        copyLink: "Copiar enlace",
        rawUrlMissing:
          "Existe un enlace seguro, pero la URL ya no puede recargarse desde almacenamiento. Genera un enlace nuevo si necesitas copiarlo otra vez.",
        generating: "Generando...",
        refreshShareLink: "Refrescar enlace",
        createShareLink: "Crear enlace",
        revoking: "Revocando...",
        revokeShareLink: "Revocar enlace",
        openCustomerView: "Abrir vista del cliente",
        beforeSending: "Antes de enviar el estimado en vivo:",
        unsavedEdits:
          "Tienes cambios visibles para el cliente sin guardar. Guarda primero si quieres que el estimado compartido coincida con lo que ves aqui.",
      },
      actions: {
        save: "Guardar estimado",
        saving: "Guardando...",
        send: "Enviar estimado",
        sending: "Enviando...",
        scheduleJob: "Agendar trabajo",
        scheduleJobDraftInvoice: "Agendar trabajo + factura borrador",
        scheduling: "Agendando...",
        archive: "Archivar estimado",
        archiving: "Archivando...",
        positiveTotalWarning:
          "Define un total positivo antes de crear una factura borrador desde este estimado.",
      },
      activity: {
        title: "Actividad del estimado",
        emptyTitle: "Aun no hay actividad.",
        created: "Estimado creado",
        updated: "Estimado actualizado",
        shareCreated: "Enlace generado",
        shareRevoked: "Enlace revocado",
        sent: "Estimado marcado como enviado",
        viewed: "Estimado visto",
        approved: "Estimado aprobado",
        declined: "Estimado rechazado",
        archived: "Estimado archivado",
        itemAdded: "Partida agregada",
        itemRemoved: "Partida eliminada",
        statusChanged: "Estado actualizado",
        convertedToJob: "Convertido en trabajo",
        convertedToInvoice: "Convertido en factura",
      },
      review: {
        notStarted: "Sin empezar",
        approved: "Aprobado por el cliente",
        declined: "Pidio cambios",
        viewed: "Visto por el cliente",
        sent: "Enviado para revision",
        expired: "Vencido",
        notShared: "Aun no se comparte",
        approvedDetail: (value) => `Aprobado ${value || "recientemente"}.`,
        declinedDetail: (value) =>
          `El cliente pidio cambios ${value || "recientemente"}.`,
        viewedDetail: (value) => `Visto ${value || "recientemente"}.`,
        sentDetail: (value) => `Enviado ${value || "recientemente"}.`,
        expiredDetail:
          "Refresca la version para el cliente antes de volver a pedir aprobacion.",
        notSharedDetail: "Da forma al estimado y envialo cuando este listo.",
      },
      nextStep: {
        createEstimateTitle: "Crear un estimado",
        finishBasicsTitle: "Termina lo basico para el cliente",
        moveApprovedTitle: "Mueve el trabajo aprobado a operaciones",
        reviseResendTitle: "Ajusta y vuelve a enviar",
        followUpWarmTitle: "Da seguimiento mientras el estimado esta caliente",
        getReviewTitle: "Logra que el cliente lo revise",
        createCustomerViewTitle: "Crea la vista del cliente",
        createEstimateDetail:
          "Empieza un nuevo estimado, valora el alcance y dejalo listo para el cliente.",
        moveApprovedDetail:
          "Crea el trabajo, envialo a despacho o prepara la factura borrador.",
        reviseResendDetail:
          "Revisa la nota del cliente, ajusta el estimado y envia un enlace nuevo.",
        followUpWarmDetail:
          "El cliente ya lo vio. Da seguimiento o espera aprobacion y luego mueve el trabajo a operaciones.",
        getReviewDetail:
          "Envia el estimado y deja claro el siguiente paso para cerrarlo rapido.",
        createCustomerViewDetail:
          "Genera el enlace seguro para el cliente o envia el estimado tan pronto como el alcance este listo.",
      },
      issues: {
        title: "Agrega un titulo especifico para el estimado.",
        customer:
          "Adjunta un cliente antes de compartir o enviar este estimado.",
        lineItems:
          "Agrega al menos una partida antes de compartir o enviar este estimado.",
        total:
          "Define un total positivo antes de compartir o enviar este estimado.",
      },
      shareStates: {
        noLink: "Sin enlace",
        active: "Activo",
        revoked: "Revocado",
        expired: "Vencido",
        approved: "Aprobado",
        declined: "Rechazado",
        viewed: "Visto",
      },
      messages: {
        failedLoadEstimates: "No se pudieron cargar los estimados.",
        failedLoadEstimate: "No se pudo cargar el estimado.",
        readOnlyCreate:
          "Los usuarios de solo lectura no pueden crear estimados.",
        failedCreate: "No se pudo crear el estimado.",
        created: (estimateNumber) => `Estimado ${estimateNumber} creado.`,
        enterSiteAddress:
          "Ingresa la direccion del sitio antes de buscar el impuesto.",
        failedLookupTax: "No se pudo buscar el impuesto.",
        taxRateUpdated: (taxRatePercent, jurisdiction, zipCode) =>
          `Impuesto actualizado a ${taxRatePercent}%${jurisdiction ? ` para ${jurisdiction}` : ""}${zipCode ? ` (${zipCode})` : ""}.`,
        selectCatalogMaterial: "Primero selecciona un material del catalogo.",
        readOnlySave:
          "Los usuarios de solo lectura no pueden guardar estimados.",
        notReadyForStatus: (statusLabel, issues) =>
          `El estimado no esta listo para ${statusLabel.toLowerCase()}. ${issues}`,
        failedSave: "No se pudo guardar el estimado.",
        saved: (estimateNumber) => `Estimado ${estimateNumber} guardado.`,
        notReadyToSend: (issues) =>
          `El estimado no esta listo para enviarse. ${issues}`,
        failedSend: "No se pudo enviar el estimado.",
        sentManualShare:
          "El estimado se marco como enviado para compartirlo manualmente.",
        positiveTotalBeforeInvoice:
          "Define un total positivo antes de crear una factura desde este estimado.",
        failedConvert: "No se pudo convertir el estimado.",
        sentToDispatch: (estimateNumber) =>
          `Estimado ${estimateNumber} enviado a despacho.`,
        jobCreated: (jobId) => `Trabajo creado: ${jobId}`,
        invoiceDraftCreated: (invoiceId) =>
          `Factura borrador creada: ${invoiceId}`,
        failedArchive: "No se pudo archivar el estimado.",
        archived: (estimateNumber) => `Estimado ${estimateNumber} archivado.`,
        notReadyToShare: (issues) =>
          `El estimado no esta listo para compartirse. ${issues}`,
        failedGenerateShareLink: "No se pudo generar el enlace para compartir.",
        shareLinkGenerated:
          "Se genero el enlace seguro del estimado. Compartelo manualmente por correo o SMS y luego marca el estimado como enviado cuando lo entregues.",
        failedRevokeShareLink: "No se pudo revocar el enlace para compartir.",
        shareLinksRevoked: "Se revocaron los enlaces activos para el cliente.",
        shareLinkCopied: "Enlace copiado al portapapeles.",
        shareLinkCopyFailed:
          "No se pudo copiar el enlace automaticamente. Copialo manualmente desde el campo.",
        invalidStatusTransition: (from, to) =>
          `No puedes mover este estimado de ${from} a ${to}.`,
      },
    };
  }

  return {
    page: {
      title: "Estimates",
      subtitle:
        "Prepare customer-ready estimates for {orgName}, track review, and move approved work into scheduling or invoicing.",
      newEstimate: "New Estimate",
      listTitle: "Estimates",
      listSubtitle:
        "Search by customer, estimate number, or review status to reopen the right estimate fast.",
      search: "Search",
      searchPlaceholder: "Estimate number, customer, lead",
      status: "Status",
      loadingList: "Loading estimates...",
      emptyTitle: "No estimates yet.",
      emptyBody: "Create your first internal estimate to start pricing work.",
      noCustomerAttached: "No customer attached",
      noSiteDetails: "No site details yet",
    },
    workspace: {
      title: "Estimate Workspace",
      titleWithNumber: (estimateNumber) =>
        `${estimateNumber} Estimate Workspace`,
      subtitle:
        "Shape the customer-facing estimate, confirm readiness, and move approved work into operations.",
      emptySubtitle:
        "Select an estimate to shape its scope, pricing, and next step.",
      openFullPage: "Open Full Page",
      loading: "Loading estimate...",
      emptyTitle: "No estimate selected.",
      emptyBody: "Choose an estimate from the list or create a new one.",
    },
    cards: {
      projectSummary: "Project Summary",
      customerReady: "Customer Ready",
      nextStep: "Next Step",
      addEstimateTitle: "Add an estimate title",
      attachCustomerOrLead: "Attach the customer or lead",
      addSiteAddress: "Add the site address",
      projectType: "Project Type",
      validUntil: "Valid Until",
      ready: "Customer-ready",
      needsDetails: "Needs customer-facing details",
      readyBody: "Customer-facing essentials are in place.",
      refreshCustomerView:
        "Save changes to refresh the live customer view used for sharing.",
    },
    form: {
      projectSummaryTitle: "Project Summary",
      projectSummaryBody:
        "Set the customer-facing title, property details, and estimate terms before you send it.",
      estimateTitle: "Estimate Title",
      estimateTitlePlaceholder: "Front yard refresh",
      estimateStatus: "Estimate Status",
      lead: "Lead",
      noLeadAttached: "No lead attached",
      customerName: "Customer name",
      customerNamePlaceholder: "Maria Ramirez",
      siteAddress: "Site address",
      siteAddressPlaceholder: "123 Cedar Ave",
      projectType: "Project type",
      projectTypePlaceholder: "Landscape install",
      taxRate: "Tax rate %",
      lookingUp: "Looking up...",
      autoFromZip: "Auto from ZIP",
      autoTaxFrom: (zipCode, jurisdiction) =>
        `Auto tax from Washington DOR · ${zipCode}${jurisdiction ? ` · ${jurisdiction}` : ""}`,
      autoTaxBody:
        "Auto tax is built in for Washington job ZIP codes. Type a manual rate any time to override it.",
      validUntil: "Valid until",
      projectSummaryField: "Project Summary",
      projectSummaryPlaceholder:
        "Short customer-facing overview of the project.",
      internalNotes: "Internal Notes",
      internalNotesPlaceholder:
        "Internal scope notes, follow-up reminders, or contractor-only context.",
      customerTerms: "Customer Terms",
      customerTermsPlaceholder:
        "Warranty, payment terms, scheduling notes, or customer-facing details.",
    },
    scope: {
      title: "Customer Scope",
      body: "Shape the labor, materials, and custom scope the customer will review.",
      addCatalogMaterial: "Add catalog material",
      addCustom: "Add Custom",
      addLabor: "Add Labor",
      emptyTitle: "No customer scope yet.",
      emptyBody:
        "Add labor, catalog materials, or custom scope before sending this estimate.",
      item: (index) => `Scope Item ${index}`,
      itemName: "Customer-facing item name",
      itemNamePlaceholder: "Landscape installation labor",
      detail: "Scope detail",
      detailPlaceholder: "What this item covers for the customer.",
      type: "Type",
      catalogMaterial: "Catalog Material",
      customScope: "Custom Scope",
      labor: "Labor",
      quantity: "Quantity",
      unit: "Unit",
      unitPrice: "Unit price",
      moveUp: "Move Up",
      moveDown: "Move Down",
      remove: "Remove",
    },
    pricing: {
      title: "Pricing / Investment",
      body: "Keep the investment clear before you send the estimate or convert it into real work.",
      subtotal: "Subtotal",
      tax: "Tax",
      total: "Total",
    },
    share: {
      title: "Send & Approval",
      body: "Deliver the customer view, track review activity, and keep the estimate moving toward approval.",
      recipientName: "Recipient name",
      recipientNamePlaceholder: "Customer name",
      recipientEmail: "Recipient email",
      recipientEmailPlaceholder: "customer@example.com",
      noLink: "No Link",
      noLinkBody: "No customer link generated yet.",
      lastShared: (value) => `Last shared ${value}`,
      expires: (value) => `Expires ${value}`,
      customerViewed: (value) => `Customer viewed ${value}`,
      customerDecision: (value, decisionName) =>
        `Customer decision ${value}${decisionName ? ` by ${decisionName}` : ""}`,
      latestRecipient: "Latest recipient:",
      secureLink: "Secure estimate link",
      copying: "Copying...",
      copyLink: "Copy Link",
      rawUrlMissing:
        "A secure link exists but the raw URL cannot be reloaded from storage. Generate a fresh link if you need to copy it again.",
      generating: "Generating...",
      refreshShareLink: "Refresh Share Link",
      createShareLink: "Create Share Link",
      revoking: "Revoking...",
      revokeShareLink: "Revoke Share Link",
      openCustomerView: "Open Customer View",
      beforeSending: "Before sending the live estimate:",
      unsavedEdits:
        "You have unsaved customer-facing edits. Save first if you want the shared estimate to match what you see here.",
    },
    actions: {
      save: "Save Estimate",
      saving: "Saving...",
      send: "Send Estimate",
      sending: "Sending...",
      scheduleJob: "Schedule Job",
      scheduleJobDraftInvoice: "Schedule Job + Draft Invoice",
      scheduling: "Scheduling...",
      archive: "Archive Estimate",
      archiving: "Archiving...",
      positiveTotalWarning:
        "Set a positive total before creating an invoice draft from this estimate.",
    },
    activity: {
      title: "Estimate Activity",
      emptyTitle: "No activity yet.",
      created: "Estimate created",
      updated: "Estimate updated",
      shareCreated: "Share link generated",
      shareRevoked: "Share link revoked",
      sent: "Estimate marked sent",
      viewed: "Estimate viewed",
      approved: "Estimate approved",
      declined: "Estimate declined",
      archived: "Estimate archived",
      itemAdded: "Line item added",
      itemRemoved: "Line item removed",
      statusChanged: "Status updated",
      convertedToJob: "Converted to job",
      convertedToInvoice: "Converted to invoice",
    },
    review: {
      notStarted: "Not started",
      approved: "Approved by customer",
      declined: "Revision requested",
      viewed: "Viewed by customer",
      sent: "Sent for review",
      expired: "Expired",
      notShared: "Not shared yet",
      approvedDetail: (value) => `Approved ${value || "recently"}.`,
      declinedDetail: (value) =>
        `Customer asked for changes ${value || "recently"}.`,
      viewedDetail: (value) => `Viewed ${value || "recently"}.`,
      sentDetail: (value) => `Sent ${value || "recently"}.`,
      expiredDetail:
        "Refresh the customer-facing version before asking for approval.",
      notSharedDetail: "Shape the estimate and send it when it is ready.",
    },
    nextStep: {
      createEstimateTitle: "Create an estimate",
      finishBasicsTitle: "Finish the customer-facing basics",
      moveApprovedTitle: "Move approved work into operations",
      reviseResendTitle: "Revise and resend",
      followUpWarmTitle: "Follow up while the estimate is warm",
      getReviewTitle: "Get the customer to review it",
      createCustomerViewTitle: "Create the customer view",
      createEstimateDetail:
        "Start a new estimate, price the scope, and get it customer-ready.",
      moveApprovedDetail:
        "Create the job, send it to dispatch, or spin up the invoice draft.",
      reviseResendDetail:
        "Review the customer note, adjust the estimate, and send a fresh link.",
      followUpWarmDetail:
        "They have already seen it. Follow up or wait for approval, then move the work into ops.",
      getReviewDetail:
        "Send the estimate and keep the next step clear so it closes quickly.",
      createCustomerViewDetail:
        "Generate the secure customer link or send the estimate as soon as the scope is ready.",
    },
    issues: {
      title: "Add a specific estimate title.",
      customer: "Attach a customer before sharing or sending this estimate.",
      lineItems:
        "Add at least one line item before sharing or sending this estimate.",
      total: "Set a positive total before sharing or sending this estimate.",
    },
    shareStates: {
      noLink: "No Link",
      active: "Active",
      revoked: "Revoked",
      expired: "Expired",
      approved: "Approved",
      declined: "Declined",
      viewed: "Viewed",
    },
    messages: {
      failedLoadEstimates: "Failed to load estimates.",
      failedLoadEstimate: "Failed to load estimate.",
      readOnlyCreate: "Read-only users cannot create estimates.",
      failedCreate: "Failed to create estimate.",
      created: (estimateNumber) => `Estimate ${estimateNumber} created.`,
      enterSiteAddress: "Enter the job site address before looking up tax.",
      failedLookupTax: "Failed to look up tax.",
      taxRateUpdated: (taxRatePercent, jurisdiction, zipCode) =>
        `Tax rate updated to ${taxRatePercent}%${jurisdiction ? ` for ${jurisdiction}` : ""}${zipCode ? ` (${zipCode})` : ""}.`,
      selectCatalogMaterial: "Select a catalog material first.",
      readOnlySave: "Read-only users cannot save estimates.",
      notReadyForStatus: (statusLabel, issues) =>
        `Estimate is not ready for ${statusLabel.toLowerCase()}. ${issues}`,
      failedSave: "Failed to save estimate.",
      saved: (estimateNumber) => `Estimate ${estimateNumber} saved.`,
      notReadyToSend: (issues) => `Estimate is not ready to send. ${issues}`,
      failedSend: "Failed to send estimate.",
      sentManualShare: "Estimate marked as sent for manual sharing.",
      positiveTotalBeforeInvoice:
        "Set a positive total before creating an invoice from this estimate.",
      failedConvert: "Failed to convert estimate.",
      sentToDispatch: (estimateNumber) =>
        `Estimate ${estimateNumber} sent to dispatch.`,
      jobCreated: (jobId) => `Job created: ${jobId}`,
      invoiceDraftCreated: (invoiceId) => `Invoice draft created: ${invoiceId}`,
      failedArchive: "Failed to archive estimate.",
      archived: (estimateNumber) => `Estimate ${estimateNumber} archived.`,
      notReadyToShare: (issues) => `Estimate is not ready to share. ${issues}`,
      failedGenerateShareLink: "Failed to generate share link.",
      shareLinkGenerated:
        "Secure estimate link generated. Share it manually by email or SMS, then mark the estimate as sent once you deliver it.",
      failedRevokeShareLink: "Failed to revoke share link.",
      shareLinksRevoked: "Active customer share links were revoked.",
      shareLinkCopied: "Share link copied to clipboard.",
      shareLinkCopyFailed:
        "Could not copy the share link automatically. Copy it manually from the field.",
      invalidStatusTransition: (from, to) =>
        `Cannot move this estimate from ${from} to ${to}.`,
    },
  };
}

function getEstimateCustomerFacingIssuesLocalized(input: {
  title: string | null | undefined;
  customerName: string | null | undefined;
  leadLabel?: string | null | undefined;
  lineItemCount: number;
  total: number;
  copy: EstimateManagerCopy;
}): string[] {
  const issues: string[] = [];

  if (isPlaceholderEstimateTitle(input.title)) {
    issues.push(input.copy.issues.title);
  }

  if (
    !(input.customerName && input.customerName.trim()) &&
    !(input.leadLabel && input.leadLabel.trim())
  ) {
    issues.push(input.copy.issues.customer);
  }

  if (!Number.isFinite(input.lineItemCount) || input.lineItemCount < 1) {
    issues.push(input.copy.issues.lineItems);
  }

  if (!Number.isFinite(input.total) || input.total <= 0) {
    issues.push(input.copy.issues.total);
  }

  return issues;
}

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
    validUntil: form.validUntil
      ? new Date(`${form.validUntil}T12:00:00.000Z`).toISOString()
      : null,
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
  focus?: "editor" | null;
}) {
  const params = new URLSearchParams();
  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }
  if (input.mobileMode) {
    params.set("mobile", "1");
  }
  if (input.focus) {
    params.set("focus", input.focus);
  }
  const query = params.toString();
  const base = input.estimateId
    ? `/app/estimates/${input.estimateId}`
    : "/app/estimates";
  const hash = input.focus === "editor" ? "#estimate-workspace" : "";
  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
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

function formatWorkflowTimestamp(
  value: string | null,
  locale: string,
): string | null {
  if (!value) return null;
  return formatDateTimeForDisplay(
    value,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    { locale },
  );
}

function formatShareStateLabelLocalized(
  value: string | null | undefined,
  copy: EstimateManagerCopy,
): string {
  if (!value) return copy.shareStates.noLink;
  switch (value) {
    case "ACTIVE":
      return copy.shareStates.active;
    case "REVOKED":
      return copy.shareStates.revoked;
    case "EXPIRED":
      return copy.shareStates.expired;
    case "APPROVED":
      return copy.shareStates.approved;
    case "DECLINED":
      return copy.shareStates.declined;
    case "VIEWED":
      return copy.shareStates.viewed;
    default:
      return value.replace(/_/g, " ");
  }
}

function formatEstimateStatusLabelLocalized(
  status: string,
  translate: (key: StatusTranslationKey) => string,
): string {
  const key = status.toLowerCase() as StatusTranslationKey;
  return ESTIMATE_STATUS_TRANSLATION_KEYS.has(key)
    ? translate(key)
    : status.replace(/_/g, " ");
}

function formatEstimateItemTypeLabelLocalized(
  type: EstimateItemRow["type"],
  copy: EstimateManagerCopy,
): string {
  if (type === "LABOR") return copy.scope.labor;
  if (type === "CUSTOM_MATERIAL") return copy.scope.customScope;
  return copy.scope.catalogMaterial;
}

function describeEstimateActivityTypeLocalized(
  type: string,
  copy: EstimateManagerCopy,
): string {
  switch (type) {
    case "CREATED":
      return copy.activity.created;
    case "UPDATED":
      return copy.activity.updated;
    case "SHARE_LINK_CREATED":
      return copy.activity.shareCreated;
    case "SHARE_LINK_REVOKED":
      return copy.activity.shareRevoked;
    case "SENT":
      return copy.activity.sent;
    case "VIEWED":
      return copy.activity.viewed;
    case "APPROVED":
      return copy.activity.approved;
    case "DECLINED":
      return copy.activity.declined;
    case "ARCHIVED":
      return copy.activity.archived;
    case "ITEM_ADDED":
      return copy.activity.itemAdded;
    case "ITEM_REMOVED":
      return copy.activity.itemRemoved;
    case "STATUS_CHANGED":
      return copy.activity.statusChanged;
    case "CONVERTED_TO_JOB":
      return copy.activity.convertedToJob;
    case "CONVERTED_TO_INVOICE":
      return copy.activity.convertedToInvoice;
    default:
      return type.replace(/_/g, " ");
  }
}

export default function EstimateManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialEstimateId,
  initialCreate,
  initialLeadId,
  leadOptions,
  materials,
}: EstimateManagerProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const statusT = useTranslations("status");
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = useMemo(() => getEstimateManagerCopy(locale), [locale]);
  const displayLocale = locale.startsWith("es") ? "es-US" : "en-US";
  const mobileMode = searchParams.get("mobile") === "1";
  const focusTarget = searchParams.get("focus");
  const [estimates, setEstimates] = useState<EstimateListItem[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(
    initialEstimateId,
  );
  const [selectedEstimate, setSelectedEstimate] =
    useState<EstimateDetail | null>(null);
  const [form, setForm] = useState<EstimateFormState>(emptyFormState);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(
    Boolean(initialEstimateId),
  );
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
  const workspaceSectionRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const totals = useMemo(
    () =>
      summarizeEstimateItems(
        form.lineItems.map((line, index) => ({ ...line, sortOrder: index })),
        form.taxRatePercent,
      ),
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
        const payload = (await response
          .json()
          .catch(() => null)) as EstimateListResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.estimates)) {
          throw new Error(payload?.error || copy.messages.failedLoadEstimates);
        }

        if (cancelled) return;
        setEstimates(payload.estimates);
      } catch (loadError) {
        if (cancelled) return;
        setEstimates([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.messages.failedLoadEstimates,
        );
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
  }, [copy, deferredSearch, internalUser, orgId, refreshToken, statusFilter]);

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
        const payload = (await response
          .json()
          .catch(() => null)) as EstimateDetailResponse;
        if (!response.ok || !payload?.ok || !payload.estimate) {
          throw new Error(payload?.error || copy.messages.failedLoadEstimate);
        }

        if (cancelled) return;
        setSelectedEstimate(payload.estimate);
        setForm(estimateToForm(payload.estimate));
      } catch (loadError) {
        if (cancelled) return;
        setSelectedEstimate(null);
        setForm(emptyFormState);
        setError(
          loadError instanceof Error
            ? loadError.message
            : copy.messages.failedLoadEstimate,
        );
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
  }, [copy, selectedEstimateId]);

  useEffect(() => {
    setLatestShareUrl(null);
  }, [selectedEstimateId]);

  useEffect(() => {
    if (focusTarget !== "editor" || loadingDetail || !selectedEstimate) {
      return;
    }
    if (!(mobileMode || window.matchMedia("(max-width: 960px)").matches)) {
      return;
    }

    workspaceSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    focusTarget,
    loadingDetail,
    mobileMode,
    selectedEstimate,
    selectedEstimate?.id,
  ]);

  useEffect(() => {
    setShareRecipientName(
      selectedEstimate?.latestShareLink?.recipientName || "",
    );
    setShareRecipientEmail(
      selectedEstimate?.latestShareLink?.recipientEmail || "",
    );
  }, [
    selectedEstimate?.id,
    selectedEstimate?.latestShareLink?.recipientName,
    selectedEstimate?.latestShareLink?.recipientEmail,
  ]);

  const updatePath = useCallback(
    (nextEstimateId: string | null, focus?: "editor" | null) => {
      router.replace(
        buildPath({
          estimateId: nextEstimateId,
          orgId,
          internalUser,
          mobileMode,
          focus: focus || null,
        }),
      );
    },
    [internalUser, mobileMode, orgId, router],
  );

  const handleCreateEstimate = useCallback(async () => {
    if (!canManage) {
      setError(copy.messages.readOnlyCreate);
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
        body: JSON.stringify(
          internalUser
            ? { orgId, leadId: initialLeadId || undefined }
            : { leadId: initialLeadId || undefined },
        ),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || copy.messages.failedCreate);
      }

      setSelectedEstimateId(payload.estimate.id);
      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setNotice(copy.messages.created(payload.estimate.estimateNumber));
      setRefreshToken((current) => current + 1);
      updatePath(payload.estimate.id, "editor");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : copy.messages.failedCreate,
      );
    } finally {
      setSaving(false);
    }
  }, [canManage, copy, initialLeadId, internalUser, orgId, updatePath]);

  useEffect(() => {
    if (!initialCreate || autoCreated.current || !canManage) return;
    autoCreated.current = true;
    void handleCreateEstimate();
  }, [canManage, handleCreateEstimate, initialCreate]);

  function updateForm<K extends keyof EstimateFormState>(
    field: K,
    value: EstimateFormState[K],
  ) {
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
        setError(copy.messages.enterSiteAddress);
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
        body: JSON.stringify(
          internalUser ? { orgId, siteAddress } : { siteAddress },
        ),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateTaxLookupResponse;
      if (!response.ok || !payload?.ok || !payload.taxRatePercent) {
        throw new Error(payload?.error || copy.messages.failedLookupTax);
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
        copy.messages.taxRateUpdated(
          payload.taxRatePercent,
          payload.taxJurisdiction || "",
          payload.taxZipCode || "",
        ),
      );
    } catch (lookupError) {
      if (!input?.silent) {
        setError(
          lookupError instanceof Error
            ? lookupError.message
            : copy.messages.failedLookupTax,
        );
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
      setError(copy.messages.selectCatalogMaterial);
      return;
    }

    updateForm("lineItems", [
      ...form.lineItems,
      hydrateLine(
        {
          ...createEstimateItemFromMaterial(material),
          sortOrder: form.lineItems.length,
        },
        form.lineItems.length,
      ),
    ]);
    setError(null);
  }

  function addCustomMaterial() {
    updateForm("lineItems", [
      ...form.lineItems,
      hydrateLine(
        {
          ...createBlankEstimateItem("CUSTOM_MATERIAL"),
          sortOrder: form.lineItems.length,
          name: copy.scope.customScope,
        },
        form.lineItems.length,
      ),
    ]);
  }

  function addLaborLine() {
    updateForm("lineItems", [
      ...form.lineItems,
      hydrateLine(
        {
          ...createBlankEstimateItem("LABOR"),
          sortOrder: form.lineItems.length,
          name: copy.scope.labor,
          unit: "hours",
        },
        form.lineItems.length,
      ),
    ]);
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
      setError(copy.messages.readOnlySave);
      return;
    }

    if (
      requiresEstimateCustomerFacingReadiness(form.status) &&
      draftCustomerFacingIssues.length > 0
    ) {
      setError(
        copy.messages.notReadyForStatus(
          formatEstimateStatusLabelLocalized(form.status, statusT),
          draftCustomerFacingIssueText,
        ),
      );
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
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || copy.messages.failedSave);
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setNotice(copy.messages.saved(payload.estimate.estimateNumber));
      setRefreshToken((current) => current + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : copy.messages.failedSave,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEstimate() {
    if (!selectedEstimateId) return;
    if (customerFacingIssueText) {
      setError(copy.messages.notReadyToSend(customerFacingIssueText));
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/estimates/${selectedEstimateId}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            recipientName: shareRecipientName || null,
            recipientEmail: shareRecipientEmail || null,
          }),
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || copy.messages.failedSend);
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      if (payload.share?.url) {
        setLatestShareUrl(payload.share.url);
      }
      setNotice(payload.message || copy.messages.sentManualShare);
      setRefreshToken((current) => current + 1);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : copy.messages.failedSend,
      );
    } finally {
      setSending(false);
    }
  }

  async function handleConvertEstimate(createInvoice: boolean) {
    if (!selectedEstimateId) return;
    if (createInvoice && selectedEstimate && selectedEstimate.total <= 0) {
      setError(copy.messages.positiveTotalBeforeInvoice);
      return;
    }
    setConverting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/estimates/${selectedEstimateId}/convert`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            createJob: true,
            createInvoice,
            dispatchDate: getDispatchTodayDateKey(),
          }),
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || copy.messages.failedConvert);
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

      const notices = [
        copy.messages.sentToDispatch(payload.estimate.estimateNumber),
      ];
      if (payload.jobId) notices.push(copy.messages.jobCreated(payload.jobId));
      if (payload.invoiceId)
        notices.push(copy.messages.invoiceDraftCreated(payload.invoiceId));
      setNotice(notices.join(" "));
      setRefreshToken((current) => current + 1);
    } catch (convertError) {
      setError(
        convertError instanceof Error
          ? convertError.message
          : copy.messages.failedConvert,
      );
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
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || copy.messages.failedArchive);
      }

      setNotice(copy.messages.archived(payload.estimate.estimateNumber));
      setSelectedEstimateId(null);
      setSelectedEstimate(null);
      setForm(emptyFormState);
      setRefreshToken((current) => current + 1);
      updatePath(null);
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : copy.messages.failedArchive,
      );
    } finally {
      setArchiving(false);
    }
  }

  async function handleGenerateShareLink() {
    if (!selectedEstimateId) return;
    if (customerFacingIssueText) {
      setError(copy.messages.notReadyToShare(customerFacingIssueText));
      return;
    }
    setSharing(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/estimates/${selectedEstimateId}/share`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            recipientName: shareRecipientName || null,
            recipientEmail: shareRecipientEmail || null,
          }),
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (
        !response.ok ||
        !payload?.ok ||
        !payload.estimate ||
        !payload.share?.url
      ) {
        throw new Error(
          payload?.error || copy.messages.failedGenerateShareLink,
        );
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setLatestShareUrl(payload.share.url);
      setNotice(copy.messages.shareLinkGenerated);
      setRefreshToken((current) => current + 1);
    } catch (shareError) {
      setError(
        shareError instanceof Error
          ? shareError.message
          : copy.messages.failedGenerateShareLink,
      );
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
      const response = await fetch(
        `/api/estimates/${selectedEstimateId}/revoke-share`,
        {
          method: "POST",
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as EstimateDetailResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || copy.messages.failedRevokeShareLink);
      }

      setSelectedEstimate(payload.estimate);
      setForm(estimateToForm(payload.estimate));
      setLatestShareUrl(null);
      setNotice(copy.messages.shareLinksRevoked);
      setRefreshToken((current) => current + 1);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : copy.messages.failedRevokeShareLink,
      );
    } finally {
      setRevokingShare(false);
    }
  }

  async function handleCopyShareLink() {
    if (!latestShareUrl) return;
    setCopyingShare(true);
    try {
      await navigator.clipboard.writeText(latestShareUrl);
      setNotice(copy.messages.shareLinkCopied);
    } catch {
      setError(copy.messages.shareLinkCopyFailed);
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
    ? getEstimateCustomerFacingIssuesLocalized({
        title: selectedEstimate.title,
        customerName: selectedEstimate.customerName,
        leadLabel: selectedEstimate.lead?.label || "",
        lineItemCount: selectedEstimate.lineItems.length,
        total: selectedEstimate.total,
        copy,
      })
    : [];
  const draftCustomerFacingIssues = selectedEstimate
    ? getEstimateCustomerFacingIssuesLocalized({
        title: form.title,
        customerName: form.customerName,
        leadLabel: linkedLead?.label || selectedEstimate.lead?.label || "",
        lineItemCount: form.lineItems.length,
        total: totals.total,
        copy,
      })
    : [];
  const customerFacingIssueText = savedCustomerFacingIssues.join(" ");
  const draftCustomerFacingIssueText = draftCustomerFacingIssues.join(" ");
  const readinessChanged =
    draftCustomerFacingIssueText !== customerFacingIssueText;
  const customerReadyLabel =
    draftCustomerFacingIssues.length === 0
      ? copy.cards.ready
      : copy.cards.needsDetails;
  const reviewStatusLabel = selectedEstimate
    ? selectedEstimate.status === "APPROVED"
      ? copy.review.approved
      : selectedEstimate.status === "DECLINED"
        ? copy.review.declined
        : selectedEstimate.status === "VIEWED"
          ? copy.review.viewed
          : selectedEstimate.status === "SENT"
            ? copy.review.sent
            : selectedEstimate.status === "EXPIRED"
              ? copy.review.expired
              : copy.review.notShared
    : copy.review.notStarted;
  const reviewStatusDetail = selectedEstimate
    ? selectedEstimate.status === "APPROVED"
      ? copy.review.approvedDetail(
          formatWorkflowTimestamp(selectedEstimate.approvedAt, displayLocale),
        )
      : selectedEstimate.status === "DECLINED"
        ? copy.review.declinedDetail(
            formatWorkflowTimestamp(selectedEstimate.declinedAt, displayLocale),
          )
        : selectedEstimate.status === "VIEWED"
          ? copy.review.viewedDetail(
              formatWorkflowTimestamp(
                selectedEstimate.customerViewedAt,
                displayLocale,
              ),
            )
          : selectedEstimate.status === "SENT"
            ? copy.review.sentDetail(
                formatWorkflowTimestamp(
                  selectedEstimate.sentAt || selectedEstimate.sharedAt,
                  displayLocale,
                ),
              )
            : selectedEstimate.status === "EXPIRED"
              ? copy.review.expiredDetail
              : copy.review.notSharedDetail
    : "";
  const nextStepTitle = !selectedEstimate
    ? copy.nextStep.createEstimateTitle
    : draftCustomerFacingIssues.length > 0
      ? copy.nextStep.finishBasicsTitle
      : selectedEstimate.status === "APPROVED"
        ? copy.nextStep.moveApprovedTitle
        : selectedEstimate.status === "DECLINED"
          ? copy.nextStep.reviseResendTitle
          : selectedEstimate.status === "VIEWED"
            ? copy.nextStep.followUpWarmTitle
            : selectedEstimate.status === "SENT"
              ? copy.nextStep.getReviewTitle
              : copy.nextStep.createCustomerViewTitle;
  const nextStepDetail = !selectedEstimate
    ? copy.nextStep.createEstimateDetail
    : draftCustomerFacingIssues.length > 0
      ? draftCustomerFacingIssues.join(" ")
      : selectedEstimate.status === "APPROVED"
        ? copy.nextStep.moveApprovedDetail
        : selectedEstimate.status === "DECLINED"
          ? copy.nextStep.reviseResendDetail
          : selectedEstimate.status === "VIEWED"
            ? copy.nextStep.followUpWarmDetail
            : selectedEstimate.status === "SENT"
              ? copy.nextStep.getReviewDetail
              : copy.nextStep.createCustomerViewDetail;
  const canSend = Boolean(
    selectedEstimate &&
    ["DRAFT", "SENT", "VIEWED", "EXPIRED"].includes(selectedEstimate.status) &&
    savedCustomerFacingIssues.length === 0,
  );
  const canConvert = selectedEstimate?.status === "APPROVED";
  const canConvertToInvoice = Boolean(
    canConvert && selectedEstimate && selectedEstimate.total > 0,
  );
  const canGenerateShare = Boolean(
    selectedEstimate &&
    ["DRAFT", "SENT", "VIEWED", "APPROVED"].includes(selectedEstimate.status) &&
    !selectedEstimate.archivedAt &&
    savedCustomerFacingIssues.length === 0,
  );
  const canRevokeShare = Boolean(
    selectedEstimate?.latestShareLink &&
    selectedEstimate.latestShareLink.state === "ACTIVE",
  );
  const previewShareUrl = useMemo(() => {
    if (!latestShareUrl) return null;

    try {
      const url = new URL(latestShareUrl);
      url.searchParams.set("preview", "1");
      return url.toString();
    } catch {
      return `${latestShareUrl}${latestShareUrl.includes("?") ? "&" : "?"}preview=1`;
    }
  }, [latestShareUrl]);

  return (
    <div className="estimate-module-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>{copy.page.title}</h2>
            <p className="muted">
              {copy.page.subtitle.replace("{orgName}", orgName)}
            </p>
          </div>
          <div className="portal-empty-actions">
            <button
              className="btn primary"
              type="button"
              disabled={saving || !canManage}
              onClick={() => void handleCreateEstimate()}
            >
              {copy.page.newEstimate}
            </button>
          </div>
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

      <div className="estimate-module-grid">
        <section
          className="card"
          id="estimate-workspace"
          ref={workspaceSectionRef}
          style={{ scrollMarginTop: 24 }}
        >
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>{copy.page.listTitle}</h3>
              <p className="muted">{copy.page.listSubtitle}</p>
            </div>
          </div>

          <form className="filters" style={{ marginTop: 12 }}>
            <label>
              {copy.page.search}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={copy.page.searchPlaceholder}
              />
            </label>
            <label>
              {copy.page.status}
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.currentTarget.value)}
              >
                <option value="">
                  {locale.startsWith("es") ? "Todos" : "All"}
                </option>
                {estimateStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatEstimateStatusLabelLocalized(status, statusT)}
                  </option>
                ))}
              </select>
            </label>
          </form>

          {loadingList ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>{copy.page.loadingList}</strong>
            </div>
          ) : estimates.length === 0 ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>{copy.page.emptyTitle}</strong>
              <p className="muted">{copy.page.emptyBody}</p>
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
                    <span className="muted">
                      {estimate.customerName ||
                        estimate.lead?.label ||
                        copy.page.noCustomerAttached}
                    </span>
                  </div>
                  <div className="quick-meta">
                    <span className="badge">
                      {formatEstimateStatusLabelLocalized(
                        estimate.status,
                        statusT,
                      )}
                    </span>
                    <span className="badge">
                      {formatEstimateCurrency(estimate.total)}
                    </span>
                  </div>
                  <span className="muted">
                    {estimate.siteAddress ||
                      estimate.projectType ||
                      copy.page.noSiteDetails}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="invoice-header-row">
            <div className="stack-cell">
              <h3>
                {selectedEstimate
                  ? copy.workspace.titleWithNumber(
                      selectedEstimate.estimateNumber,
                    )
                  : copy.workspace.title}
              </h3>
              <p className="muted">
                {selectedEstimate
                  ? copy.workspace.subtitle
                  : copy.workspace.emptySubtitle}
              </p>
            </div>
            {selectedEstimate &&
            pathname !== `/app/estimates/${selectedEstimate.id}` ? (
              <div className="portal-empty-actions">
                <Link
                  className="btn secondary"
                  href={buildPath({
                    estimateId: selectedEstimate.id,
                    orgId,
                    internalUser,
                    mobileMode,
                    focus: "editor",
                  })}
                >
                  {copy.workspace.openFullPage}
                </Link>
              </div>
            ) : null}
          </div>

          {loadingDetail ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>{copy.workspace.loading}</strong>
            </div>
          ) : !selectedEstimate ? (
            <div className="portal-empty-state estimate-module-empty">
              <strong>{copy.workspace.emptyTitle}</strong>
              <p className="muted">{copy.workspace.emptyBody}</p>
            </div>
          ) : (
            <>
              <section className="estimate-module-section">
                <div className="estimate-proposal-grid">
                  <article className="estimate-proposal-card">
                    <span className="estimate-share-eyebrow">
                      {copy.cards.projectSummary}
                    </span>
                    <strong>{form.title || copy.cards.addEstimateTitle}</strong>
                    <span>
                      {form.customerName ||
                        linkedLead?.label ||
                        copy.cards.attachCustomerOrLead}
                    </span>
                    <span className="muted">
                      {form.siteAddress || copy.cards.addSiteAddress}
                    </span>
                    <div className="estimate-proposal-status-inline">
                      <span className="badge">
                        {form.projectType || copy.cards.projectType}
                      </span>
                      {form.validUntil ? (
                        <span className="badge">
                          {copy.cards.validUntil}{" "}
                          {formatDateForDisplay(
                            `${form.validUntil}T12:00:00.000Z`,
                            { locale: displayLocale },
                          )}
                        </span>
                      ) : null}
                    </div>
                  </article>

                  <article className="estimate-proposal-card">
                    <span className="estimate-share-eyebrow">
                      {copy.cards.customerReady}
                    </span>
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
                      <span className="muted">{copy.cards.readyBody}</span>
                    )}
                    {readinessChanged ? (
                      <span className="muted">
                        {copy.cards.refreshCustomerView}
                      </span>
                    ) : null}
                  </article>

                  <article className="estimate-proposal-card">
                    <span className="estimate-share-eyebrow">
                      {copy.cards.nextStep}
                    </span>
                    <strong>{nextStepTitle}</strong>
                    <span className="muted">{nextStepDetail}</span>
                    <div className="estimate-proposal-status-inline">
                      <span className="badge">
                        {formatShareStateLabelLocalized(
                          selectedEstimate.latestShareLink?.state,
                          copy,
                        )}
                      </span>
                      <span className="badge">
                        {formatEstimateStatusLabelLocalized(
                          selectedEstimate.status,
                          statusT,
                        )}
                      </span>
                    </div>
                  </article>
                </div>
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>{copy.form.projectSummaryTitle}</h4>
                    <p className="muted">{copy.form.projectSummaryBody}</p>
                  </div>
                </div>

                <form
                  className="auth-form"
                  style={{ marginTop: 14 }}
                  onSubmit={(event) => event.preventDefault()}
                >
                  <div className="grid two-col">
                    <label>
                      {copy.form.estimateTitle}
                      <input
                        ref={titleInputRef}
                        value={form.title}
                        onChange={(event) =>
                          updateForm("title", event.currentTarget.value)
                        }
                        placeholder={copy.form.estimateTitlePlaceholder}
                      />
                    </label>
                    <label>
                      {copy.form.estimateStatus}
                      <select
                        value={form.status}
                        onChange={(event) => {
                          const nextStatus = event.currentTarget
                            .value as EstimateFormState["status"];
                          if (
                            !canTransitionEstimateStatus(
                              selectedEstimate.status,
                              nextStatus,
                            )
                          ) {
                            setError(
                              copy.messages.invalidStatusTransition(
                                formatEstimateStatusLabelLocalized(
                                  selectedEstimate.status,
                                  statusT,
                                ),
                                formatEstimateStatusLabelLocalized(
                                  nextStatus,
                                  statusT,
                                ),
                              ),
                            );
                            return;
                          }
                          setError(null);
                          updateForm("status", nextStatus);
                        }}
                      >
                        {estimateStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {formatEstimateStatusLabelLocalized(
                              status,
                              statusT,
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid two-col">
                    <label>
                      {copy.form.lead}
                      <select
                        value={form.leadId}
                        onChange={(event) =>
                          updateLead(event.currentTarget.value)
                        }
                      >
                        <option value="">{copy.form.noLeadAttached}</option>
                        {leadOptions.map((lead) => (
                          <option key={lead.id} value={lead.id}>
                            {lead.label} · {lead.phoneE164}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy.form.customerName}
                      <input
                        value={form.customerName}
                        onChange={(event) =>
                          updateForm("customerName", event.currentTarget.value)
                        }
                        placeholder={copy.form.customerNamePlaceholder}
                      />
                    </label>
                  </div>

                  <div className="grid two-col">
                    <label>
                      {copy.form.siteAddress}
                      <input
                        value={form.siteAddress}
                        onChange={(event) =>
                          updateForm("siteAddress", event.currentTarget.value)
                        }
                        onBlur={() => {
                          const zipCode = extractZipCode(form.siteAddress);
                          const shouldAutoLookup =
                            Boolean(zipCode) &&
                            ((!form.taxCalculatedAt &&
                              /^0(?:\.0+)?$/.test(
                                (form.taxRatePercent || "0").trim() || "0",
                              )) ||
                              (form.taxRateSource === "WA_DOR" &&
                                form.taxZipCode !== zipCode));
                          if (shouldAutoLookup) {
                            void handleLookupTaxRate({ silent: true });
                          }
                        }}
                        placeholder={copy.form.siteAddressPlaceholder}
                      />
                    </label>
                    <label>
                      {copy.form.projectType}
                      <input
                        value={form.projectType}
                        onChange={(event) =>
                          updateForm("projectType", event.currentTarget.value)
                        }
                        placeholder={copy.form.projectTypePlaceholder}
                      />
                    </label>
                  </div>

                  <div className="grid two-col">
                    <label>
                      {copy.form.taxRate}
                      <div
                        className="inline"
                        style={{
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <input
                          value={form.taxRatePercent}
                          onChange={(event) =>
                            setManualTaxRate(event.currentTarget.value)
                          }
                          style={{ flex: "1 1 180px" }}
                        />
                        <button
                          className="btn secondary"
                          type="button"
                          disabled={lookingUpTax || !form.siteAddress.trim()}
                          onClick={() => void handleLookupTaxRate()}
                        >
                          {lookingUpTax
                            ? copy.form.lookingUp
                            : copy.form.autoFromZip}
                        </button>
                      </div>
                      <span className="muted">
                        {form.taxRateSource === "WA_DOR" && form.taxZipCode
                          ? copy.form.autoTaxFrom(
                              form.taxZipCode,
                              form.taxJurisdiction,
                            )
                          : copy.form.autoTaxBody}
                      </span>
                    </label>
                    <label>
                      {copy.form.validUntil}
                      <input
                        type="date"
                        value={form.validUntil}
                        onChange={(event) =>
                          updateForm("validUntil", event.currentTarget.value)
                        }
                      />
                    </label>
                  </div>

                  <label>
                    {copy.form.projectSummaryField}
                    <textarea
                      value={form.description}
                      onChange={(event) =>
                        updateForm("description", event.currentTarget.value)
                      }
                      rows={3}
                      placeholder={copy.form.projectSummaryPlaceholder}
                    />
                  </label>

                  <label>
                    {copy.form.internalNotes}
                    <textarea
                      value={form.notes}
                      onChange={(event) =>
                        updateForm("notes", event.currentTarget.value)
                      }
                      rows={4}
                      placeholder={copy.form.internalNotesPlaceholder}
                    />
                  </label>

                  <label>
                    {copy.form.customerTerms}
                    <textarea
                      value={form.terms}
                      onChange={(event) =>
                        updateForm("terms", event.currentTarget.value)
                      }
                      rows={4}
                      placeholder={copy.form.customerTermsPlaceholder}
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
                    <h4>{copy.scope.title}</h4>
                    <p className="muted">{copy.scope.body}</p>
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
                      <option value="">{copy.scope.addCatalogMaterial}</option>
                      {materials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.category} · {material.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={addCustomMaterial}
                    >
                      {copy.scope.addCustom}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={addLaborLine}
                    >
                      {copy.scope.addLabor}
                    </button>
                  </div>
                </div>

                {form.lineItems.length === 0 ? (
                  <div className="portal-empty-state estimate-module-empty">
                    <strong>{copy.scope.emptyTitle}</strong>
                    <p className="muted">{copy.scope.emptyBody}</p>
                  </div>
                ) : (
                  <div className="estimate-scope-editor">
                    {form.lineItems.map((line, index) => (
                      <article
                        className="estimate-scope-editor-card"
                        key={line.id}
                      >
                        <div className="estimate-scope-editor-card-header">
                          <div className="stack-cell">
                            <span className="estimate-share-eyebrow">
                              {copy.scope.item(index + 1)}
                            </span>
                            <label>
                              {copy.scope.itemName}
                              <input
                                value={line.name}
                                onChange={(event) =>
                                  updateLine(line.id, {
                                    name: event.currentTarget.value,
                                  })
                                }
                                placeholder={copy.scope.itemNamePlaceholder}
                              />
                            </label>
                          </div>
                          <div className="estimate-scope-editor-total">
                            <span className="muted">
                              {formatEstimateItemTypeLabelLocalized(
                                line.type,
                                copy,
                              )}
                            </span>
                            <strong>
                              {formatEstimateCurrency(line.total)}
                            </strong>
                          </div>
                        </div>

                        <label>
                          {copy.scope.detail}
                          <textarea
                            value={line.description}
                            onChange={(event) =>
                              updateLine(line.id, {
                                description: event.currentTarget.value,
                              })
                            }
                            rows={2}
                            placeholder={copy.scope.detailPlaceholder}
                          />
                        </label>

                        <div className="estimate-scope-editor-fields">
                          <label>
                            {copy.scope.type}
                            <select
                              value={line.type}
                              onChange={(event) =>
                                updateLine(line.id, {
                                  type: event.currentTarget
                                    .value as EstimateItemRow["type"],
                                })
                              }
                            >
                              <option value="MATERIAL">
                                {copy.scope.catalogMaterial}
                              </option>
                              <option value="CUSTOM_MATERIAL">
                                {copy.scope.customScope}
                              </option>
                              <option value="LABOR">{copy.scope.labor}</option>
                            </select>
                          </label>
                          <label>
                            {copy.scope.quantity}
                            <input
                              value={line.quantity}
                              onChange={(event) =>
                                updateLine(line.id, {
                                  quantity: event.currentTarget.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            {copy.scope.unit}
                            <input
                              value={line.unit}
                              onChange={(event) =>
                                updateLine(line.id, {
                                  unit: event.currentTarget.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            {copy.scope.unitPrice}
                            <input
                              value={line.unitPrice}
                              onChange={(event) =>
                                updateLine(line.id, {
                                  unitPrice: event.currentTarget.value,
                                })
                              }
                            />
                          </label>
                        </div>

                        <div className="estimate-module-line-actions">
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => moveLine(line.id, -1)}
                            disabled={index === 0}
                          >
                            {copy.scope.moveUp}
                          </button>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => moveLine(line.id, 1)}
                            disabled={index === form.lineItems.length - 1}
                          >
                            {copy.scope.moveDown}
                          </button>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => removeLine(line.id)}
                          >
                            {copy.scope.remove}
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
                    <h4>{copy.pricing.title}</h4>
                    <p className="muted">{copy.pricing.body}</p>
                  </div>
                </div>

                <div className="estimate-summary-grid">
                  <article className="card estimate-summary-card">
                    <span className="muted">{copy.pricing.subtotal}</span>
                    <strong>{formatEstimateCurrency(totals.subtotal)}</strong>
                  </article>
                  <article className="card estimate-summary-card">
                    <span className="muted">{copy.pricing.tax}</span>
                    <strong>{formatEstimateCurrency(totals.tax)}</strong>
                  </article>
                  <article className="card estimate-summary-card estimate-summary-card--final">
                    <span className="muted">{copy.pricing.total}</span>
                    <strong>{formatEstimateCurrency(totals.total)}</strong>
                  </article>
                </div>
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>{copy.share.title}</h4>
                    <p className="muted">{copy.share.body}</p>
                  </div>
                </div>

                <div
                  className="estimate-share-internal-card"
                  style={{ marginTop: 12 }}
                >
                  <div
                    className="estimate-proposal-status-inline"
                    style={{ marginBottom: 12 }}
                  >
                    <span className="badge">{customerReadyLabel}</span>
                    <span className="badge">{reviewStatusLabel}</span>
                    <span className="muted">{reviewStatusDetail}</span>
                  </div>

                  <div className="grid two-col" style={{ marginTop: 0 }}>
                    <label>
                      {copy.share.recipientName}
                      <input
                        value={shareRecipientName}
                        onChange={(event) =>
                          setShareRecipientName(event.currentTarget.value)
                        }
                        placeholder={copy.share.recipientNamePlaceholder}
                      />
                    </label>
                    <label>
                      {copy.share.recipientEmail}
                      <input
                        type="email"
                        value={shareRecipientEmail}
                        onChange={(event) =>
                          setShareRecipientEmail(event.currentTarget.value)
                        }
                        placeholder={copy.share.recipientEmailPlaceholder}
                      />
                    </label>
                  </div>

                  <div className="estimate-share-inline-meta">
                    <span className="badge">
                      {selectedEstimate.latestShareLink
                        ? formatShareStateLabelLocalized(
                            selectedEstimate.latestShareLink.state,
                            copy,
                          )
                        : copy.share.noLink}
                    </span>
                    <span className="muted">
                      {selectedEstimate.sharedAt
                        ? copy.share.lastShared(
                            formatDateTimeForDisplay(
                              selectedEstimate.sharedAt,
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              },
                              { locale: displayLocale },
                            ),
                          )
                        : copy.share.noLinkBody}
                    </span>
                    {selectedEstimate.shareExpiresAt ? (
                      <span className="muted">
                        {copy.share.expires(
                          formatDateTimeForDisplay(
                            selectedEstimate.shareExpiresAt,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            },
                            { locale: displayLocale },
                          ),
                        )}
                      </span>
                    ) : null}
                    {selectedEstimate.customerViewedAt ? (
                      <span className="muted">
                        {copy.share.customerViewed(
                          formatDateTimeForDisplay(
                            selectedEstimate.customerViewedAt,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            },
                            { locale: displayLocale },
                          ),
                        )}
                      </span>
                    ) : null}
                    {selectedEstimate.customerDecisionAt ? (
                      <span className="muted">
                        {copy.share.customerDecision(
                          formatDateTimeForDisplay(
                            selectedEstimate.customerDecisionAt,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            },
                            { locale: displayLocale },
                          ),
                          selectedEstimate.customerDecisionName,
                        )}
                      </span>
                    ) : null}
                  </div>

                  {selectedEstimate.latestShareLink?.recipientName ||
                  selectedEstimate.latestShareLink?.recipientEmail ||
                  selectedEstimate.latestShareLink?.recipientPhoneE164 ? (
                    <p className="muted" style={{ marginTop: 8 }}>
                      {copy.share.latestRecipient}
                      {[
                        selectedEstimate.latestShareLink.recipientName,
                        selectedEstimate.latestShareLink.recipientEmail,
                        selectedEstimate.latestShareLink.recipientPhoneE164,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}

                  {latestShareUrl ? (
                    <div
                      className="estimate-share-link-box"
                      style={{ marginTop: 12 }}
                    >
                      <label>
                        {copy.share.secureLink}
                        <input
                          value={latestShareUrl}
                          readOnly
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      </label>
                      <div className="portal-empty-actions">
                        <button
                          className="btn secondary"
                          type="button"
                          disabled={copyingShare}
                          onClick={() => void handleCopyShareLink()}
                        >
                          {copyingShare
                            ? copy.share.copying
                            : copy.share.copyLink}
                        </button>
                      </div>
                    </div>
                  ) : selectedEstimate.latestShareLink ? (
                    <p className="muted" style={{ marginTop: 12 }}>
                      {copy.share.rawUrlMissing}
                    </p>
                  ) : null}

                  <div
                    className="portal-empty-actions"
                    style={{ marginTop: 12 }}
                  >
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={!canManage || !canGenerateShare || sharing}
                      onClick={() => void handleGenerateShareLink()}
                    >
                      {sharing
                        ? copy.share.generating
                        : selectedEstimate.latestShareLink
                          ? copy.share.refreshShareLink
                          : copy.share.createShareLink}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={!canManage || !canRevokeShare || revokingShare}
                      onClick={() => void handleRevokeShareLink()}
                    >
                      {revokingShare
                        ? copy.share.revoking
                        : copy.share.revokeShareLink}
                    </button>
                    {previewShareUrl ? (
                      <a
                        className="btn secondary"
                        href={previewShareUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {copy.share.openCustomerView}
                      </a>
                    ) : null}
                  </div>
                  {customerFacingIssueText ? (
                    <p className="form-status" style={{ marginTop: 12 }}>
                      {copy.share.beforeSending} {customerFacingIssueText}
                    </p>
                  ) : null}
                  {readinessChanged ? (
                    <p className="muted" style={{ marginTop: 12 }}>
                      {copy.share.unsavedEdits}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>{copy.cards.nextStep}</h4>
                    <p className="muted">{nextStepDetail}</p>
                  </div>
                </div>

                <div className="portal-empty-actions" style={{ marginTop: 12 }}>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={!canManage || saving}
                    onClick={() => void handleSaveEstimate()}
                  >
                    {saving ? copy.actions.saving : copy.actions.save}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canManage || !canSend || sending}
                    onClick={() => void handleSendEstimate()}
                  >
                    {sending ? copy.actions.sending : copy.actions.send}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canManage || !canConvert || converting}
                    onClick={() => void handleConvertEstimate(false)}
                  >
                    {converting
                      ? copy.actions.scheduling
                      : copy.actions.scheduleJob}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canManage || !canConvertToInvoice || converting}
                    onClick={() => void handleConvertEstimate(true)}
                  >
                    {converting
                      ? copy.actions.scheduling
                      : copy.actions.scheduleJobDraftInvoice}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!canManage || archiving}
                    onClick={() => void handleArchiveEstimate()}
                  >
                    {archiving ? copy.actions.archiving : copy.actions.archive}
                  </button>
                </div>
                {selectedEstimate && selectedEstimate.total <= 0 ? (
                  <p className="form-status" style={{ marginTop: 12 }}>
                    {copy.actions.positiveTotalWarning}
                  </p>
                ) : null}
              </section>

              <section className="estimate-module-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h4>{copy.activity.title}</h4>
                  </div>
                </div>
                {selectedEstimate.activities.length === 0 ? (
                  <div
                    className="portal-empty-state estimate-module-empty"
                    style={{ marginTop: 12 }}
                  >
                    <strong>{copy.activity.emptyTitle}</strong>
                  </div>
                ) : (
                  <ul className="timeline" style={{ marginTop: 12 }}>
                    {selectedEstimate.activities.map((activity) => (
                      <li key={activity.id} className="timeline-item">
                        <span className="timeline-dot" />
                        <div className="timeline-content">
                          <strong>
                            {describeEstimateActivityTypeLocalized(
                              activity.type,
                              copy,
                            )}
                          </strong>
                          <span className="muted">{activity.actorName}</span>
                          <span className="muted">
                            {formatDateTimeForDisplay(
                              activity.createdAt,
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              },
                              { locale: displayLocale },
                            )}
                          </span>
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
