"use client";

import { useState, useTransition } from "react";

type FormState = {
  name: string;
  company: string;
  email: string;
  phone: string;
  projectType: string;
  details: string;
};

const initialState: FormState = {
  name: "",
  company: "",
  email: "",
  phone: "",
  projectType: "Construction",
  details: "",
};

export default function LeadForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const subject = `Project inquiry: ${form.projectType} - ${form.company || form.name}`;
    const body = [
      `Name: ${form.name}`,
      `Company: ${form.company || "Not provided"}`,
      `Email: ${form.email}`,
      `Phone: ${form.phone || "Not provided"}`,
      `Project type: ${form.projectType}`,
      "",
      "Project details:",
      form.details,
    ].join("\n");

    const mailto = `mailto:info@sslandinc.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    startTransition(() => {
      window.location.href = mailto;
      setStatus("Opening your email client with a prefilled inquiry.");
    });
  }

  return (
    <div className="lead-form-shell">
      <div className="lead-form-shell__header">
        <p className="eyebrow">Project inquiry</p>
        <h3>Send a structured lead instead of a vague contact message.</h3>
        <p>
          This form opens a prefilled email draft so the inquiry includes the basics the team
          actually needs.
        </p>
      </div>

      <form className="lead-form" onSubmit={handleSubmit}>
        <div className="field-grid">
          <label className="field">
            <span>Name</span>
            <input
              autoComplete="name"
              onChange={(event) => updateField("name", event.target.value)}
              required
              type="text"
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Company</span>
            <input
              autoComplete="organization"
              onChange={(event) => updateField("company", event.target.value)}
              type="text"
              value={form.company}
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              onChange={(event) => updateField("email", event.target.value)}
              required
              type="email"
              value={form.email}
            />
          </label>

          <label className="field">
            <span>Phone</span>
            <input
              autoComplete="tel"
              onChange={(event) => updateField("phone", event.target.value)}
              type="tel"
              value={form.phone}
            />
          </label>
        </div>

        <label className="field">
          <span>Project type</span>
          <select
            onChange={(event) => updateField("projectType", event.target.value)}
            value={form.projectType}
          >
            <option>Construction</option>
            <option>Maintenance</option>
            <option>Construction + Maintenance</option>
            <option>Irrigation / Repair</option>
          </select>
        </label>

        <label className="field">
          <span>Project details</span>
          <textarea
            onChange={(event) => updateField("details", event.target.value)}
            placeholder="Property type, city, timeline, plans, and any scope notes."
            required
            rows={6}
            value={form.details}
          />
        </label>

        <button className="button button--solid lead-form__submit" disabled={isPending} type="submit">
          {isPending ? "Opening..." : "Open inquiry draft"}
        </button>

        {status ? <p className="lead-form__status">{status}</p> : null}
      </form>
    </div>
  );
}
