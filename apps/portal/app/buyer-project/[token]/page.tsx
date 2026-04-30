import { AppApiError } from "@/lib/app-api-permissions";
import { getBuyerProjectByToken } from "@/lib/buyer-projects";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

function formatProjectDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatSquareFeet(value: number | null): string | null {
  return value ? `${value.toLocaleString()} sq ft` : null;
}

function formatProjectMoneyFromCents(value: number | null): string {
  if (value === null) return "Deposit amount to be confirmed";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function resolveExternalHomeUrl(input: {
  homeUrl: string | null;
  website: string;
}): string | null {
  if (!input.homeUrl) return null;
  if (input.homeUrl.startsWith("http://") || input.homeUrl.startsWith("https://")) {
    return input.homeUrl;
  }
  if (!input.website) return input.homeUrl;
  return `${input.website.replace(/\/$/, "")}/${input.homeUrl.replace(/^\//, "")}`;
}

export default async function BuyerProjectPage(
  props: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  const params = await props.params;

  try {
    const project = await getBuyerProjectByToken(params.token);
    const homeUrl = resolveExternalHomeUrl({
      homeUrl: project.selectedHome.url,
      website: project.organization.website,
    });
    const homeFacts = [
      project.selectedHome.type,
      project.selectedHome.beds ? `${project.selectedHome.beds} bed` : null,
      project.selectedHome.bathsLabel ? `${project.selectedHome.bathsLabel} bath` : null,
      formatSquareFeet(project.selectedHome.sqft),
    ].filter(Boolean);

    return (
      <main className="estimate-share-page tracking-page">
        <section className="card estimate-share-card tracking-card">
          <header className="estimate-share-header">
            <div className="estimate-share-brand">
              <div className="stack-cell">
                <span className="estimate-share-eyebrow">Endeavor Home Journey</span>
                <h1>{project.organization.name}</h1>
                {project.organization.website ? (
                  <a href={project.organization.website} target="_blank" rel="noreferrer">
                    {project.organization.website}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="stack-cell estimate-share-status">
              <span className="badge status-scheduled">{project.currentStageLabel}</span>
              <strong>{project.projectName}</strong>
              <span className="muted">Private project room for {project.buyerName}</span>
            </div>
          </header>

          <div className="estimate-share-meta-grid">
            <article className="estimate-share-panel">
              <span className="muted">Project Type</span>
              <strong>{project.projectTypeLabel}</strong>
              <span>{project.timeline || "Timeline to be confirmed"}</span>
              <span className="muted">Updated {formatProjectDate(project.updatedAt)}</span>
            </article>
            <article className="estimate-share-panel">
              <span className="muted">Budget + Financing</span>
              <strong>{project.budgetRange || "Budget range pending"}</strong>
              <span>{project.financingStatus || "Financing path to be confirmed"}</span>
              <span className="muted">{project.landStatus || "Land/site status pending"}</span>
            </article>
            <article className="estimate-share-panel">
              <span className="muted">Contact</span>
              <strong>{project.organization.name}</strong>
              {project.organization.phone ? <span>{project.organization.phone}</span> : null}
              {project.organization.email ? <span>{project.organization.email}</span> : null}
            </article>
          </div>

          <section className="estimate-share-section">
            <div className="dispatch-panel-head">
              <div>
                <h2>Selected Home Context</h2>
                <p className="muted">
                  The details below come from the Endeavor website inquiry and keep the portal tied to the home path you started from.
                </p>
              </div>
            </div>

            <article className="estimate-share-panel">
              <span className="muted">{project.selectedHome.modelSeries || project.selectedHome.status || "Home starting point"}</span>
              <strong>{project.selectedHome.title || "Home selection to be confirmed"}</strong>
              {homeFacts.length > 0 ? <span>{homeFacts.join(" | ")}</span> : null}
              {project.selectedHome.priceLabel ? <span>{project.selectedHome.priceLabel}</span> : null}
              {project.selectedHome.locationLabel ? <span>{project.selectedHome.locationLabel}</span> : null}
              {homeUrl ? (
                <a href={homeUrl} target="_blank" rel="noreferrer">
                  Review home details
                </a>
              ) : null}
            </article>
          </section>

          <section className="estimate-share-section">
            <div className="dispatch-panel-head">
              <div>
                <h2>Home Journey</h2>
                <p className="muted">
                  Endeavor uses these stages to keep the home, financing, land fit, delivery, setup, and move-in path connected.
                </p>
              </div>
            </div>

            <div className="tracking-progress-grid">
              {project.milestones.map((step, index) => (
                <article
                  key={step.key}
                  className={`tracking-progress-step tracking-progress-step--${step.state}`}
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  <span className="tracking-progress-index">{index + 1}</span>
                  <strong>{step.label}</strong>
                  <span className="muted">{step.detail}</span>
                </article>
              ))}
            </div>
          </section>

          {project.contractProject ? (
            <section className="estimate-share-section">
              <div className="dispatch-panel-head">
                <div>
                  <h2>Contract + Build Updates</h2>
                  <p className="muted">
                    Contract, deposit, change order, and build-start details stay connected to the same Endeavor project room.
                  </p>
                </div>
              </div>

              <div className="estimate-share-meta-grid">
                <article className="estimate-share-panel">
                  <span className="muted">Contract Status</span>
                  <strong>{project.contractProject.statusLabel}</strong>
                  {project.contractProject.contractDocumentUrl ? (
                    <a href={project.contractProject.contractDocumentUrl} target="_blank" rel="noreferrer">
                      {project.contractProject.contractDocumentLabel || "Open contract document"}
                    </a>
                  ) : (
                    <span>Contract document link pending</span>
                  )}
                  <span className="muted">
                    {project.contractProject.contractSignedAt
                      ? `Signed ${formatProjectDate(project.contractProject.contractSignedAt)}`
                      : "Signature status pending"}
                  </span>
                </article>
                <article className="estimate-share-panel">
                  <span className="muted">Deposit + Payments</span>
                  <strong>{project.contractProject.paymentStatusLabel}</strong>
                  <span>{formatProjectMoneyFromCents(project.contractProject.depositDueCents)}</span>
                  <span className="muted">
                    {project.contractProject.depositPaidAt
                      ? `Deposit received ${formatProjectDate(project.contractProject.depositPaidAt)}`
                      : "Deposit receipt pending"}
                  </span>
                </article>
                <article className="estimate-share-panel">
                  <span className="muted">Estimates</span>
                  <strong>{project.contractProject.changeOrderStatusLabel}</strong>
                  <span>
                    {project.contractProject.activeStartedAt
                      ? `Build active since ${formatProjectDate(project.contractProject.activeStartedAt)}`
                      : "Build start pending"}
                  </span>
                  {project.contractProject.completedAt ? (
                    <span className="muted">Completed {formatProjectDate(project.contractProject.completedAt)}</span>
                  ) : null}
                </article>
              </div>
            </section>
          ) : null}

          <section className="estimate-share-section">
            <div className="estimate-share-meta-grid">
              <article className="estimate-share-panel">
                <span className="muted">Next From Buyer</span>
                <strong>{project.currentStageLabel}</strong>
                <span>{project.buyerNextStep || project.milestones.find((step) => step.state === "current")?.buyerPrompt}</span>
              </article>
              <article className="estimate-share-panel">
                <span className="muted">Buyer Goal</span>
                <strong>{project.buyerGoal ? "Shared with Endeavor" : "To be confirmed"}</strong>
                {project.buyerGoal ? <span>{project.buyerGoal}</span> : null}
              </article>
              <article className="estimate-share-panel">
                <span className="muted">Project Notes</span>
                <strong>{project.publicNotes || "Updates will appear here"}</strong>
                <span className="muted">Created {formatProjectDate(project.createdAt)}</span>
              </article>
            </div>
          </section>
        </section>
      </main>
    );
  } catch (error) {
    const message =
      error instanceof AppApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "This project link is invalid or no longer available.";

    return (
      <main className="estimate-share-page tracking-page">
        <section className="card estimate-share-card">
          <div className="portal-empty-state tracking-empty-state">
            <strong>Project room unavailable</strong>
            <p className="muted">{message}</p>
          </div>
        </section>
      </main>
    );
  }
}
