"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import type { SmsTone } from "@prisma/client";
import { getSmsToneTemplates, renderSmsTemplate } from "@/lib/conversational-sms-templates";
import type { ResolvedMessageLocale } from "@/lib/message-language";

type ToneOption = {
  tone: SmsTone;
  label: string;
  description: string;
};

type SmsAgentPlaybookExamples = {
  primaryGoal: string;
  businessContext: string;
  servicesSummary: string;
  serviceAreaSummary: string;
  requiredDetails: string;
  handoffTriggers: string;
  toneNotes: string;
  estimatorName: string;
  schedulingNotes: string;
  doNotPromise: string;
};

type SmsVoiceCopy = {
  chooseVoice: string;
  automationControls: string;
  autoReplyEnabled: string;
  followUpsEnabled: string;
  autoBookingEnabled: string;
  businessHours: string;
  businessHoursBody: string;
  greetingLine: string;
  greetingPlaceholder: string;
  workingHoursText: string;
  workingHoursPlaceholder: string;
  websiteSignature: string;
  websitePlaceholder: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  slotDuration: string;
  buffer: string;
  daysAhead: string;
  timezone: string;
  agentPlaybook: string;
  agentPlaybookBody: string;
  primaryGoal: string;
  businessContext: string;
  servicesSummary: string;
  serviceAreaSummary: string;
  requiredDetails: string;
  handoffTriggers: string;
  toneNotes: string;
  estimatorName: string;
  schedulingNotes: string;
  doNotPromise: string;
  useInboundPhoneAsCallback: string;
  customTemplates: string;
  customTemplatesBody: string;
  greetingInitial: string;
  askAddress: string;
  askTimeframe: string;
  offerBooking: string;
  bookingConfirmation: string;
  followUp1: string;
  followUp2: string;
  followUp3: string;
  livePreview: string;
  livePreviewBody: string;
  sampleWorkReply: string;
  sampleAddressReply: string;
  sampleTimingReply: string;
};

function getToneOptions(locale: string): ToneOption[] {
  if (locale.startsWith("es")) {
    return [
      { tone: "FRIENDLY", label: "Amigable y casual", description: "Calido, conversacional y sin presion." },
      { tone: "PROFESSIONAL", label: "Profesional y pulido", description: "Tono de oficina claro y seguro." },
      { tone: "DIRECT", label: "Directo al punto", description: "Corto, eficiente y rapido de responder." },
      { tone: "SALES", label: "Ventas de alta energia", description: "Urgencia con impulso hacia la reserva." },
      { tone: "PREMIUM", label: "Premium / lujo", description: "Tono elevado con fuerte sensacion de confianza." },
      { tone: "BILINGUAL", label: "Bilingue amigable", description: "Ingles y espanol en un mismo flujo." },
      { tone: "CUSTOM", label: "Personalizado", description: "Usa tu propio texto con protecciones." },
    ];
  }

  return [
    { tone: "FRIENDLY", label: "Friendly & Casual", description: "Warm, conversational, and low-pressure." },
    { tone: "PROFESSIONAL", label: "Professional & Polished", description: "Clear and confident office tone." },
    { tone: "DIRECT", label: "Straight to the Point", description: "Short, efficient, and fast to reply." },
    { tone: "SALES", label: "High-Energy Sales", description: "Urgency-forward with booking momentum." },
    { tone: "PREMIUM", label: "Premium / Luxury", description: "Elevated service tone with strong trust." },
    { tone: "BILINGUAL", label: "Bilingual Friendly", description: "English + Spanish in a single flow." },
    { tone: "CUSTOM", label: "Custom (editable)", description: "Use your own copy with safeguards." },
  ];
}

function getSmsVoiceCopy(locale: string): SmsVoiceCopy {
  if (locale.startsWith("es")) {
    return {
      chooseVoice: "Elige tu voz SMS",
      automationControls: "Controles de automatizacion",
      autoReplyEnabled: "Respuesta automatica activada",
      followUpsEnabled: "Seguimientos activados",
      autoBookingEnabled: "Autoagenda activada",
      businessHours: "¿Cuándo quieres que el agente ofrezca estimados?",
      businessHoursBody: "Pon la ventana real de estimados y el agente SMS priorizara esos horarios primero.",
      greetingLine: "Linea de saludo (opcional)",
      greetingPlaceholder: "Hola, habla Velocity Landscapes",
      workingHoursText: "Texto de horario (opcional)",
      workingHoursPlaceholder: "Lun-Vie 8am-6pm",
      websiteSignature: "Firma web (opcional)",
      websitePlaceholder: "velocitylandscapes.com",
      workingHoursStart: "Hora de inicio preferida",
      workingHoursEnd: "Hora de fin preferida",
      slotDuration: "Duracion del bloque (minutos)",
      buffer: "Buffer (minutos)",
      daysAhead: "Dias hacia adelante",
      timezone: "Zona horaria",
      agentPlaybook: "Preguntas para entrenar al agente SMS",
      agentPlaybookBody: "Haz que el dueño responda esto como habla en la vida real. Mientras mas claro sea, mejor calificara y agendara la IA.",
      primaryGoal: "1. ¿Cuál es la meta principal del agente SMS?",
      businessContext: "2. ¿Cómo maneja este negocio los nuevos leads de estimados?",
      servicesSummary: "3. ¿Qué servicios sí quieren tomar por SMS?",
      serviceAreaSummary: "4. ¿En qué ciudades o zonas sí trabajan?",
      requiredDetails: "5. ¿Qué datos debe capturar antes de agendar?",
      handoffTriggers: "6. ¿Cuándo debe dejar de automatizar y pasar a un humano?",
      toneNotes: "7. ¿Cómo debe sonar al responder?",
      estimatorName: "8. ¿Quién hace los estimados?",
      schedulingNotes: "9. ¿Qué reglas debe seguir al ofrecer horarios?",
      doNotPromise: "10. ¿Qué no debe prometer nunca?",
      useInboundPhoneAsCallback: "11. ¿Debe usar el número del SMS como callback por defecto?",
      customTemplates: "Plantillas personalizadas",
      customTemplatesBody: "Manten esto humano y natural. Evita palabras como bot/AI/automated. La logica STOP sigue bloqueada.",
      greetingInitial: "Saludo / mensaje inicial",
      askAddress: "Pedir direccion",
      askTimeframe: "Pedir tiempo",
      offerBooking: "Ofrecer agenda",
      bookingConfirmation: "Confirmacion de agenda",
      followUp1: "Seguimiento #1",
      followUp2: "Seguimiento #2",
      followUp3: "Seguimiento #3",
      livePreview: "Vista previa en vivo",
      livePreviewBody: "De llamada perdida a oferta de agenda.",
      sampleWorkReply: "Limpieza y delineado.",
      sampleAddressReply: "123 Oak St Tacoma",
      sampleTimingReply: "Esta semana.",
    };
  }

  return {
    chooseVoice: "Choose Your SMS Voice",
    automationControls: "Automation Controls",
    autoReplyEnabled: "Auto-reply enabled",
    followUpsEnabled: "Follow-ups enabled",
    autoBookingEnabled: "Auto-booking enabled",
    businessHours: "When should the agent offer estimate times?",
    businessHoursBody: "Set the real estimate window and the SMS agent will prioritize those times first.",
    greetingLine: "Greeting line (optional)",
    greetingPlaceholder: "Hey this is Velocity Landscapes",
    workingHoursText: "Working hours text (optional)",
    workingHoursPlaceholder: "Mon-Fri 8am-6pm",
    websiteSignature: "Website signature (optional)",
    websitePlaceholder: "velocitylandscapes.com",
    workingHoursStart: "Preferred estimate start time",
    workingHoursEnd: "Preferred estimate end time",
    slotDuration: "Slot duration (minutes)",
    buffer: "Buffer (minutes)",
    daysAhead: "Days ahead",
    timezone: "Timezone",
    agentPlaybook: "Questions To Train The SMS Agent",
    agentPlaybookBody: "Have the owner answer these in plain language. The clearer they are, the more human and accurate the AI will be.",
    primaryGoal: "1. What is the main job you want the SMS agent to do?",
    businessContext: "2. How does this business normally handle new estimate leads?",
    servicesSummary: "3. What services should it actively take by SMS?",
    serviceAreaSummary: "4. What cities or service areas do you actually serve?",
    requiredDetails: "5. What details must it collect before scheduling?",
    handoffTriggers: "6. When should it stop automating and hand off to a human?",
    toneNotes: "7. How should it sound when it texts customers?",
    estimatorName: "8. Who usually runs the estimates?",
    schedulingNotes: "9. What scheduling rules should it follow?",
    doNotPromise: "10. What should it never promise?",
    useInboundPhoneAsCallback: "11. Should it use the inbound SMS number as the default callback number?",
    customTemplates: "Custom Templates",
    customTemplatesBody: "Keep this human and natural. Avoid words like bot/AI/automated. STOP handling and logic remain locked.",
    greetingInitial: "Greeting / Initial message",
    askAddress: "Ask address",
    askTimeframe: "Ask timeframe",
    offerBooking: "Offer booking",
    bookingConfirmation: "Booking confirmation",
    followUp1: "Follow-up #1",
    followUp2: "Follow-up #2",
    followUp3: "Follow-up #3",
    livePreview: "Live Preview",
    livePreviewBody: "Missed call trigger to booking offer.",
    sampleWorkReply: "Cleanup and edging.",
    sampleAddressReply: "123 Oak St Tacoma",
    sampleTimingReply: "This week.",
  };
}

function getSmsAgentPlaybookExamples(locale: string): SmsAgentPlaybookExamples {
  if (locale.startsWith("es")) {
    return {
      primaryGoal: "Agendar estimados en sitio para Cesar y dejar leads bien calificados en el CRM.",
      businessContext: "Somos Velocity Landscapes. Queremos responder rapido, sacar tipo de trabajo y dirección, y agendar si el lead encaja.",
      servicesSummary: "Muros de contención, hardscape, limpieza de yarda, drenaje, pavers y trabajos de landscape que sí queremos cotizar.",
      serviceAreaSummary: "Tacoma, Puyallup, Lakewood, University Place y zonas cercanas donde sí damos servicio.",
      requiredDetails: "Tipo de trabajo, dirección completa, ciudad, acceso/gate code si aplica, y plazo del cliente.",
      handoffTriggers: "Pásalo a humano si el cliente quiere llamar, pide precio exacto por texto, tiene un proyecto raro, o quiere un horario fuera de nuestra ventana.",
      toneNotes: "Humano, seguro, servicial y nada robótico. Como recepcionista de oficina, no vendedor agresivo.",
      estimatorName: "Cesar",
      schedulingNotes: "Cesar prefiere hacer estimados más tarde, normalmente entre 4pm y 7pm. Si no puede ese horario, pásalo a humano.",
      doNotPromise: "No prometas precio final, fecha de inicio garantizada, ni que podemos hacer cualquier trabajo sin que Cesar lo vea.",
    };
  }

  return {
    primaryGoal: "Book on-site estimates for Cesar and leave clean, qualified lead details in the CRM.",
    businessContext: "We are Velocity Landscapes. We want fast replies, collect the job type and address, and book the estimate if the lead is a fit.",
    servicesSummary: "Retaining walls, hardscape, yard cleanup, drainage, pavers, and landscaping work we actively want to quote.",
    serviceAreaSummary: "Tacoma, Puyallup, Lakewood, University Place, and nearby areas we actually serve.",
    requiredDetails: "Work needed, full address, city, gate/access notes if relevant, and the customer's timeframe.",
    handoffTriggers: "Hand off if the customer wants a call, asks for exact pricing over text, has an unusual project, or wants times outside our preferred estimate window.",
    toneNotes: "Human, calm, helpful, and confident. It should sound like a real office coordinator, not a bot or aggressive salesperson.",
    estimatorName: "Cesar",
    schedulingNotes: "Cesar prefers to run estimates later in the day, usually between 4pm and 7pm. If that window does not work, hand it to a human.",
    doNotPromise: "Do not promise final pricing, guaranteed start dates, or that we take the job before Cesar reviews it.",
  };
}

export type SmsVoiceCustomTemplates = {
  greeting: string;
  askAddress: string;
  askTimeframe: string;
  offerBooking: string;
  bookingConfirmation: string;
  followUp1: string;
  followUp2: string;
  followUp3: string;
};

export type SmsAgentPlaybookFormValues = {
  primaryGoal: string;
  businessContext: string;
  servicesSummary: string;
  serviceAreaSummary: string;
  requiredDetails: string;
  handoffTriggers: string;
  toneNotes: string;
  estimatorName: string;
  schedulingNotes: string;
  doNotPromise: string;
  useInboundPhoneAsCallback: boolean;
};

type SmsVoiceSectionProps = {
  businessName: string;
  locale: ResolvedMessageLocale;
  canManage: boolean;
  initialTone: SmsTone;
  initialAutoReplyEnabled: boolean;
  initialFollowUpsEnabled: boolean;
  initialAutoBookingEnabled: boolean;
  initialGreetingLine: string;
  initialWorkingHoursText: string;
  initialWebsiteSignature: string;
  initialWorkingHoursStart: string;
  initialWorkingHoursEnd: string;
  initialSlotDurationMinutes: number;
  initialBufferMinutes: number;
  initialDaysAhead: number;
  initialTimeZone: string;
  initialAgentPlaybook: SmsAgentPlaybookFormValues;
  initialCustomTemplates: SmsVoiceCustomTemplates;
  previewSlots: string[];
};

function getPreviewPack(input: {
  tone: SmsTone;
  locale: ResolvedMessageLocale;
  customTemplates: SmsVoiceCustomTemplates;
}) {
  const base = getSmsToneTemplates({ tone: input.tone, locale: input.locale });
  if (input.tone !== "CUSTOM") {
    return {
      initial: base.initial,
      askAddress: base.askAddress,
      askTimeframe: base.askTimeframe,
      offerBooking: base.offerBooking,
      bookingConfirmation: base.bookingConfirmation,
      followUp1: base.followUp1,
      followUp2: base.followUp2,
      followUp3: base.followUp3,
    };
  }

  return {
    initial: input.customTemplates.greeting.trim() || base.initial,
    askAddress: input.customTemplates.askAddress.trim() || base.askAddress,
    askTimeframe: input.customTemplates.askTimeframe.trim() || base.askTimeframe,
    offerBooking: input.customTemplates.offerBooking.trim() || base.offerBooking,
    bookingConfirmation: input.customTemplates.bookingConfirmation.trim() || base.bookingConfirmation,
    followUp1: input.customTemplates.followUp1.trim() || base.followUp1,
    followUp2: input.customTemplates.followUp2.trim() || base.followUp2,
    followUp3: input.customTemplates.followUp3.trim() || base.followUp3,
  };
}

export function SmsVoiceSection(props: SmsVoiceSectionProps) {
  const locale = useLocale();
  const copy = getSmsVoiceCopy(locale);
  const toneOptions = getToneOptions(locale);
  const [tone, setTone] = useState<SmsTone>(props.initialTone);
  const [customTemplates, setCustomTemplates] = useState<SmsVoiceCustomTemplates>(props.initialCustomTemplates);

  const previewPack = useMemo(
    () =>
      getPreviewPack({
        tone,
        locale: props.locale,
        customTemplates,
      }),
    [tone, props.locale, customTemplates],
  );

  const slotList = props.previewSlots.length > 0 ? props.previewSlots.join("  ") : "A) Tomorrow 10:00am  B) Thu 2:00pm  C) Fri 9:00am";
  const [slot1 = "A) Tomorrow 10:00am", slot2 = "B) Thu 2:00pm", slot3 = "C) Fri 9:00am"] =
    props.previewSlots.length > 0 ? props.previewSlots : ["A) Tomorrow 10:00am", "B) Thu 2:00pm", "C) Fri 9:00am"];

  const initialText = renderSmsTemplate(previewPack.initial, {
    bizName: props.businessName,
  });
  const askAddressText = renderSmsTemplate(previewPack.askAddress, {
    bizName: props.businessName,
  });
  const askTimeframeText = renderSmsTemplate(previewPack.askTimeframe, {
    bizName: props.businessName,
  });
  const offerBookingText = renderSmsTemplate(previewPack.offerBooking, {
    bizName: props.businessName,
    slotList,
    slot1,
    slot2,
    slot3,
  });

  return (
    <div className="sms-voice-layout">
      <section className="sms-voice-controls">
        <h3>{copy.chooseVoice}</h3>
        <div className="sms-voice-card-grid">
          {toneOptions.map((option) => {
            const tonePack = getSmsToneTemplates({ tone: option.tone, locale: props.locale });
            return (
              <label key={option.tone} className={`sms-voice-card ${tone === option.tone ? "active" : ""}`}>
                <input
                  type="radio"
                  name="smsTone"
                  value={option.tone}
                  checked={tone === option.tone}
                  onChange={() => setTone(option.tone)}
                  disabled={!props.canManage}
                />
                <strong>{option.label}</strong>
                <span>{option.description}</span>
                <small>{tonePack.initial}</small>
              </label>
            );
          })}
        </div>

        <h3>{copy.automationControls}</h3>
        <label className="inline-toggle">
          <input type="checkbox" name="autoReplyEnabled" defaultChecked={props.initialAutoReplyEnabled} disabled={!props.canManage} />
          {copy.autoReplyEnabled}
        </label>
        <label className="inline-toggle">
          <input type="checkbox" name="followUpsEnabled" defaultChecked={props.initialFollowUpsEnabled} disabled={!props.canManage} />
          {copy.followUpsEnabled}
        </label>
        <label className="inline-toggle">
          <input type="checkbox" name="autoBookingEnabled" defaultChecked={props.initialAutoBookingEnabled} disabled={!props.canManage} />
          {copy.autoBookingEnabled}
        </label>

        <h3>{copy.businessHours}</h3>
        <p className="muted">{copy.businessHoursBody}</p>
        <label>
          {copy.greetingLine}
          <input
            name="smsGreetingLine"
            maxLength={220}
            defaultValue={props.initialGreetingLine}
            placeholder={copy.greetingPlaceholder}
            disabled={!props.canManage}
          />
        </label>
        <label>
          {copy.workingHoursText}
          <input
            name="smsWorkingHoursText"
            maxLength={220}
            defaultValue={props.initialWorkingHoursText}
            placeholder={copy.workingHoursPlaceholder}
            disabled={!props.canManage}
          />
        </label>
        <label>
          {copy.websiteSignature}
          <input
            name="smsWebsiteSignature"
            maxLength={220}
            defaultValue={props.initialWebsiteSignature}
            placeholder={copy.websitePlaceholder}
            disabled={!props.canManage}
          />
        </label>
        <div className="sms-voice-grid-two">
          <label>
            {copy.workingHoursStart}
            <input type="time" name="workingHoursStart" defaultValue={props.initialWorkingHoursStart} disabled={!props.canManage} />
          </label>
          <label>
            {copy.workingHoursEnd}
            <input type="time" name="workingHoursEnd" defaultValue={props.initialWorkingHoursEnd} disabled={!props.canManage} />
          </label>
          <label>
            {copy.slotDuration}
            <input type="number" min={15} max={180} name="slotDurationMinutes" defaultValue={props.initialSlotDurationMinutes} disabled={!props.canManage} />
          </label>
          <label>
            {copy.buffer}
            <input type="number" min={0} max={120} name="bufferMinutes" defaultValue={props.initialBufferMinutes} disabled={!props.canManage} />
          </label>
          <label>
            {copy.daysAhead}
            <input type="number" min={1} max={14} name="daysAhead" defaultValue={props.initialDaysAhead} disabled={!props.canManage} />
          </label>
          <label>
            {copy.timezone}
            <input name="messagingTimezone" defaultValue={props.initialTimeZone} disabled={!props.canManage} />
          </label>
        </div>

        <div className="sms-voice-custom-editor">
          <h3>{copy.agentPlaybook}</h3>
          <p className="muted">{copy.agentPlaybookBody}</p>
          <label>
            {copy.primaryGoal}
            <textarea
              name="smsAgentPrimaryGoal"
              rows={2}
              defaultValue={props.initialAgentPlaybook.primaryGoal}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.businessContext}
            <textarea
              name="smsAgentBusinessContext"
              rows={3}
              defaultValue={props.initialAgentPlaybook.businessContext}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.servicesSummary}
            <textarea
              name="smsAgentServicesSummary"
              rows={3}
              defaultValue={props.initialAgentPlaybook.servicesSummary}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.serviceAreaSummary}
            <textarea
              name="smsAgentServiceAreaSummary"
              rows={2}
              defaultValue={props.initialAgentPlaybook.serviceAreaSummary}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.requiredDetails}
            <textarea
              name="smsAgentRequiredDetails"
              rows={3}
              defaultValue={props.initialAgentPlaybook.requiredDetails}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.handoffTriggers}
            <textarea
              name="smsAgentHandoffTriggers"
              rows={3}
              defaultValue={props.initialAgentPlaybook.handoffTriggers}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.toneNotes}
            <textarea
              name="smsAgentToneNotes"
              rows={3}
              defaultValue={props.initialAgentPlaybook.toneNotes}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.estimatorName}
            <input
              name="smsAgentEstimatorName"
              defaultValue={props.initialAgentPlaybook.estimatorName}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.schedulingNotes}
            <textarea
              name="smsAgentSchedulingNotes"
              rows={3}
              defaultValue={props.initialAgentPlaybook.schedulingNotes}
              disabled={!props.canManage}
            />
          </label>
          <label>
            {copy.doNotPromise}
            <textarea
              name="smsAgentDoNotPromise"
              rows={3}
              defaultValue={props.initialAgentPlaybook.doNotPromise}
              disabled={!props.canManage}
            />
          </label>
          <label className="inline-toggle">
            <input
              type="checkbox"
              name="smsAgentUseInboundPhoneAsCallback"
              defaultChecked={props.initialAgentPlaybook.useInboundPhoneAsCallback}
              disabled={!props.canManage}
            />
            {copy.useInboundPhoneAsCallback}
          </label>
        </div>

        {tone === "CUSTOM" ? (
          <div className="sms-voice-custom-editor">
            <h3>{copy.customTemplates}</h3>
            <p className="muted">{copy.customTemplatesBody}</p>
            <label>
              {copy.greetingInitial}
              <textarea
                name="customTemplateGreeting"
                rows={3}
                value={customTemplates.greeting}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, greeting: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.askAddress}
              <textarea
                name="customTemplateAskAddress"
                rows={2}
                value={customTemplates.askAddress}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, askAddress: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.askTimeframe}
              <textarea
                name="customTemplateAskTimeframe"
                rows={2}
                value={customTemplates.askTimeframe}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, askTimeframe: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.offerBooking}
              <textarea
                name="customTemplateOfferBooking"
                rows={3}
                value={customTemplates.offerBooking}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, offerBooking: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.bookingConfirmation}
              <textarea
                name="customTemplateBookingConfirmation"
                rows={3}
                value={customTemplates.bookingConfirmation}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, bookingConfirmation: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.followUp1}
              <textarea
                name="customTemplateFollowUp1"
                rows={2}
                value={customTemplates.followUp1}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, followUp1: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.followUp2}
              <textarea
                name="customTemplateFollowUp2"
                rows={2}
                value={customTemplates.followUp2}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, followUp2: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              {copy.followUp3}
              <textarea
                name="customTemplateFollowUp3"
                rows={2}
                value={customTemplates.followUp3}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, followUp3: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
          </div>
        ) : (
          <div className="sms-voice-hidden-custom-inputs">
            <input type="hidden" name="customTemplateGreeting" value="" />
            <input type="hidden" name="customTemplateAskAddress" value="" />
            <input type="hidden" name="customTemplateAskTimeframe" value="" />
            <input type="hidden" name="customTemplateOfferBooking" value="" />
            <input type="hidden" name="customTemplateBookingConfirmation" value="" />
            <input type="hidden" name="customTemplateFollowUp1" value="" />
            <input type="hidden" name="customTemplateFollowUp2" value="" />
            <input type="hidden" name="customTemplateFollowUp3" value="" />
          </div>
        )}
      </section>

      <aside className="sms-voice-preview">
        <h3>{copy.livePreview}</h3>
        <p className="muted">{copy.livePreviewBody}</p>
        <div className="sms-preview-thread">
          <div className="sms-bubble outbound">{initialText}</div>
          <div className="sms-bubble inbound">{copy.sampleWorkReply}</div>
          <div className="sms-bubble outbound">{askAddressText}</div>
          <div className="sms-bubble inbound">{copy.sampleAddressReply}</div>
          <div className="sms-bubble outbound">{askTimeframeText}</div>
          <div className="sms-bubble inbound">{copy.sampleTimingReply}</div>
          <div className="sms-bubble outbound">{offerBookingText}</div>
        </div>
      </aside>
    </div>
  );
}
