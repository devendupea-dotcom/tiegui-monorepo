"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CalendarAccessRole } from "@prisma/client";

type QuickAddLeadButtonProps = {
  defaultOrgId: string | null;
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
  label?: string;
  className?: string;
};

type PossibleCustomerMatch = {
  id: string;
  name: string;
  phoneE164: string;
  email: string | null;
  addressLine: string | null;
};

type SubmitMode = "save" | "schedule";

type SubmitOptions = {
  linkCustomerId?: string | null;
  ignorePossibleMatch?: boolean;
};

type LeadCreateResult = {
  ok?: boolean;
  error?: string;
  lead?: { id: string };
  possibleMatches?: PossibleCustomerMatch[];
};

type LeadMatchLookupResult = {
  ok?: boolean;
  error?: string;
  matches?: PossibleCustomerMatch[];
};

const SOURCE_OPTIONS = [
  { value: "ORGANIC", label: "Organic" },
  { value: "REFERRAL", label: "Referral" },
  { value: "WALKIN", label: "Walk-in" },
  { value: "REPEAT", label: "Repeat" },
  { value: "UNKNOWN", label: "Unknown" },
] as const;

function toLocalInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromIsoToLocalInput(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return toLocalInputValue(parsed);
}

export default function QuickAddLeadButton({
  defaultOrgId,
  internalUser,
  calendarAccessRole,
  label = "+ Add Lead",
  className,
}: QuickAddLeadButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const canOpen =
    internalUser || calendarAccessRole === "OWNER" || calendarAccessRole === "ADMIN" || calendarAccessRole === "WORKER";

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [sourceType, setSourceType] = useState<(typeof SOURCE_OPTIONS)[number]["value"]>("ORGANIC");
  const [sourceDetail, setSourceDetail] = useState("");
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [scheduleNow, setScheduleNow] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<30 | 60 | 90>(30);
  const [quickWorkerId, setQuickWorkerId] = useState("");
  const [possibleMatches, setPossibleMatches] = useState<PossibleCustomerMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string>("");
  const [lookingUpMatches, setLookingUpMatches] = useState(false);
  const [advancedForceCreateOpen, setAdvancedForceCreateOpen] = useState(false);
  const [forceCreateDuplicate, setForceCreateDuplicate] = useState(false);
  const [confirmDuplicateCreate, setConfirmDuplicateCreate] = useState(false);
  const [toast, setToast] = useState<{ message: string; href: string } | null>(null);

  const quickAddRequested = searchParams.get("quickAdd") === "1";

  const resolvedOrgId = useMemo(() => {
    const queryOrgId = searchParams.get("orgId")?.trim() || "";
    if (queryOrgId) return queryOrgId;
    return defaultOrgId || "";
  }, [defaultOrgId, searchParams]);

  function clearQuickAddParams() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("quickAdd");
    params.delete("quickStart");
    params.delete("quickDuration");
    params.delete("quickWorkerId");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function primeFromQuery() {
    const quickStart = searchParams.get("quickStart")?.trim() || null;
    const quickDuration = Number.parseInt(searchParams.get("quickDuration") || "", 10);
    const queryWorkerId = searchParams.get("quickWorkerId")?.trim() || "";

    if (quickStart) {
      setScheduleNow(true);
      setStartLocal(fromIsoToLocalInput(quickStart));
    }

    if (quickDuration === 60 || quickDuration === 90) {
      setDurationMinutes(quickDuration);
    } else {
      setDurationMinutes(30);
    }

    setQuickWorkerId(queryWorkerId);
  }

  function openModal() {
    setError(null);
    setPossibleMatches([]);
    setSelectedMatchId("");
    setLookingUpMatches(false);
    setShowMoreFields(false);
    setAdvancedForceCreateOpen(false);
    setForceCreateDuplicate(false);
    setConfirmDuplicateCreate(false);
    setQuickWorkerId("");
    setOpen(true);
    if (quickAddRequested) {
      primeFromQuery();
    }
  }

  function closeModal() {
    setOpen(false);
    setSubmitting(false);
    setError(null);
    setPossibleMatches([]);
    setSelectedMatchId("");
    setLookingUpMatches(false);
    setShowMoreFields(false);
    setAdvancedForceCreateOpen(false);
    setForceCreateDuplicate(false);
    setConfirmDuplicateCreate(false);
    setQuickWorkerId("");
    if (quickAddRequested) {
      clearQuickAddParams();
    }
  }

  useEffect(() => {
    if (!canOpen) return;
    if (!quickAddRequested || open) return;
    openModal();
    // We intentionally react only to query transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, quickAddRequested, open]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const rawPhone = phone.trim();
    if (!rawPhone) {
      setPossibleMatches([]);
      setSelectedMatchId("");
      setAdvancedForceCreateOpen(false);
      setForceCreateDuplicate(false);
      setConfirmDuplicateCreate(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      const params = new URLSearchParams();
      params.set("phone", rawPhone);
      if (resolvedOrgId) {
        params.set("orgId", resolvedOrgId);
      }

      setLookingUpMatches(true);
      try {
        const response = await fetch(`/api/leads/matches?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as LeadMatchLookupResult | null;
        if (cancelled) {
          return;
        }
        if (!response.ok || !result?.ok) {
          setPossibleMatches([]);
          setSelectedMatchId("");
          setAdvancedForceCreateOpen(false);
          setForceCreateDuplicate(false);
          setConfirmDuplicateCreate(false);
          return;
        }

        const matches = result.matches || [];
        setPossibleMatches(matches);
        setSelectedMatchId((current) => {
          if (current && matches.some((match) => match.id === current)) {
            return current;
          }
          return matches[0]?.id || "";
        });
        if (matches.length === 0) {
          setAdvancedForceCreateOpen(false);
          setForceCreateDuplicate(false);
          setConfirmDuplicateCreate(false);
        }
      } catch {
        if (cancelled) {
          return;
        }
        setPossibleMatches([]);
        setSelectedMatchId("");
        setAdvancedForceCreateOpen(false);
        setForceCreateDuplicate(false);
        setConfirmDuplicateCreate(false);
      } finally {
        if (!cancelled) {
          setLookingUpMatches(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [open, phone, resolvedOrgId]);

  async function submitLead(mode: SubmitMode, options?: SubmitOptions) {
    if (!canOpen || submitting) return;

    const finalSchedule = mode === "schedule" || scheduleNow;

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    if (!phone.trim()) {
      setError("Phone is required.");
      return;
    }

    if (finalSchedule && !startLocal) {
      setError("Choose a schedule date/time.");
      return;
    }

    const hasPossibleMatch = possibleMatches.length > 0;
    const explicitForceCreate = forceCreateDuplicate || options?.ignorePossibleMatch === true;
    if (hasPossibleMatch && explicitForceCreate && !confirmDuplicateCreate) {
      setError("Confirm duplicate creation before saving.");
      return;
    }

    const selectedLinkCustomerId =
      options?.linkCustomerId || selectedMatchId || possibleMatches[0]?.id || null;

    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        orgId: resolvedOrgId || undefined,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        note: note.trim() || undefined,
        sourceType,
        sourceDetail: sourceDetail.trim() || undefined,
        scheduleNow: finalSchedule,
        ignorePossibleMatch: hasPossibleMatch && explicitForceCreate,
      };

      if (hasPossibleMatch && !explicitForceCreate && selectedLinkCustomerId) {
        payload.linkCustomerId = selectedLinkCustomerId;
      } else if (options?.linkCustomerId) {
        payload.linkCustomerId = options.linkCustomerId;
      }

      if (finalSchedule) {
        payload.schedule = {
          startAt: new Date(startLocal).toISOString(),
          durationMinutes,
          type: "JOB",
          status: "SCHEDULED",
          workerIds: quickWorkerId ? [quickWorkerId] : undefined,
        };
      }

      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => null)) as LeadCreateResult | null;

      if (response.status === 409 && result?.possibleMatches?.length) {
        setPossibleMatches(result.possibleMatches);
        setSelectedMatchId(result.possibleMatches[0]?.id || "");
        setError(result.error || "Possible customer match found.");
        return;
      }

      if (!response.ok || !result?.ok || !result.lead?.id) {
        setError(result?.error || "Failed to save lead.");
        return;
      }

      const next = internalUser && resolvedOrgId
        ? `/app/jobs/${result.lead.id}?orgId=${encodeURIComponent(resolvedOrgId)}`
        : `/app/jobs/${result.lead.id}`;

      closeModal();
      router.refresh();
      if (finalSchedule) {
        const bookedAt = startLocal ? new Date(startLocal) : null;
        const bookedLabel =
          bookedAt && !Number.isNaN(bookedAt.getTime())
            ? new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              }).format(bookedAt)
            : "scheduled time";
        setToast({
          message: `Booked for ${bookedLabel}`,
          href: next,
        });
      } else {
        router.push(next);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save lead.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canOpen) {
    return null;
  }

  const duplicateConfirmationRequired = possibleMatches.length > 0 && forceCreateDuplicate && !confirmDuplicateCreate;

  return (
    <>
      <button type="button" className={className || "btn primary portal-quick-add-btn"} onClick={openModal}>
        {label}
      </button>

      {open ? (
        <div className="quicklead-backdrop" role="dialog" aria-modal>
          <div className="quicklead-modal">
            <header>
              <h3>Add Organic Lead</h3>
              <p className="muted">Mobile-first entry: name + phone in under 30 seconds.</p>
            </header>

            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitLead("save");
              }}
            >
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jordan Lee"
                />
              </label>

              <label>
                Phone
                <input
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+12065550100"
                />
              </label>

              <details
                className="quicklead-more"
                open={showMoreFields}
                onToggle={(event) => setShowMoreFields((event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>More fields</summary>
                <div className="quicklead-more-grid">
                  <label>
                    Note (optional)
                    <textarea
                      rows={3}
                      maxLength={4000}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Quick context for the crew"
                    />
                  </label>

                  <label>
                    Email (optional)
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@email.com" />
                  </label>

                  <label>
                    Address (optional)
                    <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="123 Main St" />
                  </label>

                  <label>
                    Source
                    <select value={sourceType} onChange={(event) => setSourceType(event.target.value as (typeof SOURCE_OPTIONS)[number]["value"])}>
                      {SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Source detail (optional)
                    <input
                      value={sourceDetail}
                      onChange={(event) => setSourceDetail(event.target.value)}
                      placeholder="Walked in after seeing truck wrap"
                    />
                  </label>
                </div>
              </details>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={scheduleNow}
                  onChange={(event) => setScheduleNow(event.target.checked)}
                />
                Schedule now
              </label>

              {scheduleNow ? (
                <div className="quicklead-schedule-grid">
                  <label>
                    Start
                    <input
                      type="datetime-local"
                      value={startLocal}
                      onChange={(event) => setStartLocal(event.target.value)}
                      step={1800}
                    />
                  </label>

                  <label>
                    Duration
                    <select
                      value={durationMinutes}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10);
                        setDurationMinutes(value === 60 || value === 90 ? value : 30);
                      }}
                    >
                      <option value={30}>30 min</option>
                      <option value={60}>60 min</option>
                      <option value={90}>90 min</option>
                    </select>
                  </label>
                </div>
              ) : null}

              {lookingUpMatches && phone.trim() ? (
                <p className="muted">Checking for possible customer matches...</p>
              ) : null}

              {possibleMatches.length > 0 ? (
                <section className="quicklead-matches">
                  <p className="quicklead-matches-title">Possible customer match</p>
                  <p className="muted">
                    Default action will link this lead to an existing customer with the same phone number.
                  </p>
                  <div className="quicklead-matches-list">
                    {possibleMatches.map((match) => (
                      <label key={match.id} className="quicklead-match-item">
                        <input
                          type="radio"
                          name="selectedMatch"
                          checked={selectedMatchId === match.id}
                          onChange={() => setSelectedMatchId(match.id)}
                        />
                        <span>
                          <strong>{match.name}</strong>
                          <span>{match.phoneE164}</span>
                          <span>{match.email || "No email"}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setAdvancedForceCreateOpen((value) => !value)}
                    disabled={submitting}
                  >
                    {advancedForceCreateOpen ? "Hide Advanced" : "Advanced"}
                  </button>
                  {advancedForceCreateOpen ? (
                    <div className="quicklead-advanced-create">
                      <label className="inline-toggle">
                        <input
                          type="checkbox"
                          checked={forceCreateDuplicate}
                          onChange={(event) => {
                            const next = event.target.checked;
                            setForceCreateDuplicate(next);
                            if (!next) {
                              setConfirmDuplicateCreate(false);
                            }
                          }}
                        />
                        Create new customer instead of linking
                      </label>
                      {forceCreateDuplicate ? (
                        <>
                          <label className="inline-toggle">
                            <input
                              type="checkbox"
                              checked={confirmDuplicateCreate}
                              onChange={(event) => setConfirmDuplicateCreate(event.target.checked)}
                            />
                            I understand this may create duplicates.
                          </label>
                          {!confirmDuplicateCreate ? (
                            <p className="muted">Confirm duplicate creation to enable save actions.</p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {error ? <p className="form-status">{error}</p> : null}

              <div className="quicklead-sticky-footer">
                <div className="quicklead-actions">
                  <button type="button" className="btn secondary" onClick={closeModal} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn secondary" disabled={submitting || duplicateConfirmationRequired}>
                    {submitting ? "Saving..." : "Save Lead"}
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={submitting || duplicateConfirmationRequired}
                    onClick={() => void submitLead("schedule")}
                  >
                    {submitting ? "Saving..." : "Save + Schedule"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? (
        <aside className="quicklead-toast" role="status" aria-live="polite">
          <p>{toast.message}</p>
          <div className="quicklead-toast-actions">
            <button type="button" className="btn secondary" onClick={() => setToast(null)}>
              Dismiss
            </button>
            <Link className="btn primary" href={toast.href}>
              Open job
            </Link>
          </div>
        </aside>
      ) : null}
    </>
  );
}
