"use client";

import { PRIMARY_CTA_LABEL } from "../_content";

export default function ContactForm() {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (window.gtag) window.gtag("event", "form_submit", { form: "contact" });
    event.currentTarget.reset();
    const status = event.currentTarget.querySelector(".form-status");
    if (status) status.textContent = "Thanks — we’ll reach out shortly.";
  };

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input type="text" name="name" placeholder="Your name" required />
      </label>
      <label>
        Phone number
        <input type="tel" name="phone" placeholder="(555) 555-5555" required />
      </label>
      <label>
        Email
        <input type="email" name="email" placeholder="you@company.com" required />
      </label>
      <label className="field-message">
        Biggest challenge
        <textarea name="challenge" rows={3} placeholder="What is the #1 thing you want to fix right now?" />
      </label>
      <button className="cta-button gold" type="submit">
        {PRIMARY_CTA_LABEL}
      </button>
      <p className="cta-note">We’ll reach out quickly.</p>
      <p className="form-status" aria-live="polite"></p>
    </form>
  );
}
