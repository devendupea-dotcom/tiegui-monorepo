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
        Business type
        <select name="type">
          <option value="">Select</option>
          <option>Contractor</option>
          <option>Landscaping</option>
          <option>Other local service</option>
        </select>
      </label>
      <label className="field-message">
        Message (optional)
        <textarea name="message" rows={3} placeholder="Tell us a bit about your goals" />
      </label>
      <button className="cta-button gold" type="submit">{PRIMARY_CTA_LABEL}</button>
      <p className="cta-note">We’ll reach out quickly.</p>
      <p className="form-status" aria-live="polite"></p>
    </form>
  );
}
