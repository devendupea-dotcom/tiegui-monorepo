"use client";

import { useMemo, useState } from "react";
import type { SmsTone } from "@prisma/client";
import { getSmsToneTemplates, renderSmsTemplate } from "@/lib/conversational-sms-templates";
import type { ResolvedMessageLocale } from "@/lib/message-language";

type ToneOption = {
  tone: SmsTone;
  label: string;
  description: string;
};

const TONE_OPTIONS: ToneOption[] = [
  {
    tone: "FRIENDLY",
    label: "Friendly & Casual",
    description: "Warm, conversational, and low-pressure.",
  },
  {
    tone: "PROFESSIONAL",
    label: "Professional & Polished",
    description: "Clear and confident office tone.",
  },
  {
    tone: "DIRECT",
    label: "Straight to the Point",
    description: "Short, efficient, and fast to reply.",
  },
  {
    tone: "SALES",
    label: "High-Energy Sales",
    description: "Urgency-forward with booking momentum.",
  },
  {
    tone: "PREMIUM",
    label: "Premium / Luxury",
    description: "Elevated service tone with strong trust.",
  },
  {
    tone: "BILINGUAL",
    label: "Bilingual Friendly",
    description: "English + Spanish in a single flow.",
  },
  {
    tone: "CUSTOM",
    label: "Custom (editable)",
    description: "Use your own copy with safeguards.",
  },
];

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
  });

  return (
    <div className="sms-voice-layout">
      <section className="sms-voice-controls">
        <h3>Choose Your SMS Voice</h3>
        <div className="sms-voice-card-grid">
          {TONE_OPTIONS.map((option) => {
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

        <h3>Automation Controls</h3>
        <label className="inline-toggle">
          <input type="checkbox" name="autoReplyEnabled" defaultChecked={props.initialAutoReplyEnabled} disabled={!props.canManage} />
          Auto-reply enabled
        </label>
        <label className="inline-toggle">
          <input type="checkbox" name="followUpsEnabled" defaultChecked={props.initialFollowUpsEnabled} disabled={!props.canManage} />
          Follow-ups enabled
        </label>
        <label className="inline-toggle">
          <input type="checkbox" name="autoBookingEnabled" defaultChecked={props.initialAutoBookingEnabled} disabled={!props.canManage} />
          Auto-booking enabled
        </label>

        <h3>Business Hours & Booking</h3>
        <label>
          Greeting line (optional)
          <input
            name="smsGreetingLine"
            maxLength={220}
            defaultValue={props.initialGreetingLine}
            placeholder="Hey this is Velocity Landscapes"
            disabled={!props.canManage}
          />
        </label>
        <label>
          Working hours text (optional)
          <input
            name="smsWorkingHoursText"
            maxLength={220}
            defaultValue={props.initialWorkingHoursText}
            placeholder="Mon-Fri 8am-6pm"
            disabled={!props.canManage}
          />
        </label>
        <label>
          Website signature (optional)
          <input
            name="smsWebsiteSignature"
            maxLength={220}
            defaultValue={props.initialWebsiteSignature}
            placeholder="velocitylandscapes.com"
            disabled={!props.canManage}
          />
        </label>
        <div className="sms-voice-grid-two">
          <label>
            Working hours start
            <input type="time" name="workingHoursStart" defaultValue={props.initialWorkingHoursStart} disabled={!props.canManage} />
          </label>
          <label>
            Working hours end
            <input type="time" name="workingHoursEnd" defaultValue={props.initialWorkingHoursEnd} disabled={!props.canManage} />
          </label>
          <label>
            Slot duration (minutes)
            <input type="number" min={15} max={180} name="slotDurationMinutes" defaultValue={props.initialSlotDurationMinutes} disabled={!props.canManage} />
          </label>
          <label>
            Buffer (minutes)
            <input type="number" min={0} max={120} name="bufferMinutes" defaultValue={props.initialBufferMinutes} disabled={!props.canManage} />
          </label>
          <label>
            Days ahead
            <input type="number" min={1} max={14} name="daysAhead" defaultValue={props.initialDaysAhead} disabled={!props.canManage} />
          </label>
          <label>
            Timezone
            <input name="messagingTimezone" defaultValue={props.initialTimeZone} disabled={!props.canManage} />
          </label>
        </div>

        {tone === "CUSTOM" ? (
          <div className="sms-voice-custom-editor">
            <h3>Custom Templates</h3>
            <p className="muted">
              Keep this human and natural. Avoid words like bot/AI/automated. STOP handling and logic remain locked.
            </p>
            <label>
              Greeting / Initial message
              <textarea
                name="customTemplateGreeting"
                rows={3}
                value={customTemplates.greeting}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, greeting: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Ask address
              <textarea
                name="customTemplateAskAddress"
                rows={2}
                value={customTemplates.askAddress}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, askAddress: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Ask timeframe
              <textarea
                name="customTemplateAskTimeframe"
                rows={2}
                value={customTemplates.askTimeframe}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, askTimeframe: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Offer booking
              <textarea
                name="customTemplateOfferBooking"
                rows={3}
                value={customTemplates.offerBooking}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, offerBooking: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Booking confirmation
              <textarea
                name="customTemplateBookingConfirmation"
                rows={3}
                value={customTemplates.bookingConfirmation}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, bookingConfirmation: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Follow-up #1
              <textarea
                name="customTemplateFollowUp1"
                rows={2}
                value={customTemplates.followUp1}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, followUp1: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Follow-up #2
              <textarea
                name="customTemplateFollowUp2"
                rows={2}
                value={customTemplates.followUp2}
                onChange={(event) => setCustomTemplates((prev) => ({ ...prev, followUp2: event.target.value }))}
                disabled={!props.canManage}
              />
            </label>
            <label>
              Follow-up #3
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
        <h3>Live Preview</h3>
        <p className="muted">Missed call trigger to booking offer.</p>
        <div className="sms-preview-thread">
          <div className="sms-bubble outbound">{initialText}</div>
          <div className="sms-bubble inbound">Cleanup and edging.</div>
          <div className="sms-bubble outbound">{askAddressText}</div>
          <div className="sms-bubble inbound">123 Oak St Tacoma</div>
          <div className="sms-bubble outbound">{askTimeframeText}</div>
          <div className="sms-bubble inbound">This week.</div>
          <div className="sms-bubble outbound">{offerBookingText}</div>
        </div>
      </aside>
    </div>
  );
}
