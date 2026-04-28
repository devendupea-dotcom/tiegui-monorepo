"use client";

import { useState } from "react";
import { siteCopy } from "../../content/siteCopy";

type SubmissionState = "idle" | "submitted";

export default function ContactForm() {
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const formCopy = siteCopy.contact.form;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (window.gtag) {
      window.gtag("event", "form_submit", { form: "strategy_call" });
    }

    form.reset();
    setSubmissionState("submitted");
  };

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-form__row">
        <div className="contact-form__field">
          <label htmlFor="contact-name">{formCopy.nameLabel}</label>
          <input id="contact-name" name="name" type="text" autoComplete="name" required minLength={2} />
        </div>

        <div className="contact-form__field">
          <label htmlFor="contact-company">{formCopy.companyLabel}</label>
          <input id="contact-company" name="company" type="text" autoComplete="organization" required minLength={2} />
        </div>
      </div>

      <div className="contact-form__row">
        <div className="contact-form__field">
          <label htmlFor="contact-email">{formCopy.emailLabel}</label>
          <input id="contact-email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className="contact-form__field">
          <label htmlFor="contact-phone">{formCopy.phoneLabel}</label>
          <input
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            pattern="[0-9+()\-\s]{7,20}"
            required
            aria-describedby="contact-phone-help"
          />
          <p id="contact-phone-help">Use digits, spaces, or symbols like + ( ) -.</p>
        </div>
      </div>

      <div className="contact-form__field">
        <label htmlFor="contact-challenge">{formCopy.challengeLabel}</label>
        <textarea id="contact-challenge" name="challenge" rows={5} required minLength={20} />
      </div>

      <button className="tg-btn tg-btn--primary" type="submit">
        {formCopy.submitLabel}
      </button>

      <p className="contact-form__status" aria-live="polite">
        {submissionState === "submitted" ? formCopy.successMessage : ""}
      </p>
    </form>
  );
}
