import { AppApiError } from "@/lib/app-api-permissions";
import { getJobTrackingByToken, formatJobTrackingTimelineDateTime } from "@/lib/job-tracking-store";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function JobTrackingPage(
  props: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  const params = await props.params;
  try {
    const tracking = await getJobTrackingByToken(params.token);

    return (
      <main className="estimate-share-page tracking-page">
        <section className="card estimate-share-card tracking-card">
          <header className="estimate-share-header">
            <div className="estimate-share-brand">
              <div className="stack-cell">
                <span className="estimate-share-eyebrow">{tracking.trackingEyebrow}</span>
                <h1>{tracking.contractor.name}</h1>
                {tracking.contractor.website ? (
                  <a href={tracking.contractor.website} target="_blank" rel="noreferrer">
                    {tracking.contractor.website}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="stack-cell estimate-share-status">
              <span className={`badge status-${tracking.currentStatus}`}>{tracking.currentStatusLabel}</span>
              <strong>{tracking.trackingTitle}</strong>
              <span className="muted">{tracking.customerName}</span>
            </div>
          </header>

          <div className="estimate-share-meta-grid">
            <article className="estimate-share-panel">
              <span className="muted">Project</span>
              <strong>{tracking.trackingTitle}</strong>
              <span>{tracking.address || "Address to be confirmed"}</span>
              <span className="muted">Status: {tracking.currentStatusLabel}</span>
            </article>
            <article className="estimate-share-panel">
              <span className="muted">{tracking.scheduleLabel}</span>
              <strong>{tracking.scheduledDate || "Scheduling in progress"}</strong>
              <span>{tracking.scheduledWindow}</span>
              <span className="muted">{tracking.assignedCrewName ? `Assigned crew: ${tracking.assignedCrewName}` : "Crew assignment pending"}</span>
            </article>
            <article className="estimate-share-panel">
              <span className="muted">Contractor</span>
              <strong>{tracking.contractor.name}</strong>
              {tracking.contractor.phone ? <span>{tracking.contractor.phone}</span> : null}
              {tracking.contractor.email ? <span>{tracking.contractor.email}</span> : null}
            </article>
          </div>

          <section className="estimate-share-section">
            <div className="dispatch-panel-head">
              <div>
                <h2>{tracking.progressTitle}</h2>
                <p className="muted">{tracking.progressDescription}</p>
              </div>
            </div>

            <div className="tracking-progress-grid">
              {tracking.progressSteps.map((step, index) => (
                <article
                  key={step.key}
                  className={`tracking-progress-step tracking-progress-step--${step.state}`}
                  aria-current={step.state === "current" ? "step" : undefined}
                >
                  <span className="tracking-progress-index">{index + 1}</span>
                  <strong>{step.label}</strong>
                </article>
              ))}
            </div>
          </section>

          <section className="estimate-share-section">
            <div className="dispatch-panel-head">
              <div>
                <h2>Timeline</h2>
                <p className="muted">{tracking.timelineDescription}</p>
              </div>
            </div>

            {tracking.timeline.length > 0 ? (
              <ul className="timeline tracking-timeline">
                {tracking.timeline.map((item) => (
                  <li key={item.id} className="timeline-item">
                    <span className={`timeline-dot tracking-timeline-dot tracking-timeline-dot--${item.kind}`} />
                    <div className="timeline-content tracking-timeline-content">
                      <strong>{item.title}</strong>
                      {item.detail ? <span>{item.detail}</span> : null}
                      <span className="muted">{formatJobTrackingTimelineDateTime(item.occurredAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="portal-empty-state tracking-empty-state">
                <strong>Updates will appear here.</strong>
                <p className="muted">Your contractor hasn&apos;t published any customer-facing dispatch updates yet.</p>
              </div>
            )}
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
          : "This tracking link is invalid or no longer available.";

    return (
      <main className="estimate-share-page tracking-page">
        <section className="card estimate-share-card">
          <div className="portal-empty-state tracking-empty-state">
            <strong>Tracking unavailable</strong>
            <p className="muted">{message}</p>
          </div>
        </section>
      </main>
    );
  }
}
