import { SkeletonCard } from "./dashboard-ui";

export default function AppHomeLoading() {
  return (
    <div className="dashboard-shell">
      <section className="card dashboard-header">
        <div className="dashboard-header-copy">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-subtitle" />
        </div>
        <div className="dashboard-actions">
          <div className="skeleton skeleton-btn" />
          <div className="skeleton skeleton-btn" />
          <div className="skeleton skeleton-btn" />
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <SkeletonCard rows={1} compact />
        <SkeletonCard rows={1} compact />
        <SkeletonCard rows={1} compact />
        <SkeletonCard rows={1} compact />
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-stack">
          <SkeletonCard rows={5} />
          <SkeletonCard rows={5} />
        </div>
        <div className="dashboard-stack">
          <SkeletonCard rows={4} />
          <SkeletonCard rows={3} />
        </div>
      </section>
    </div>
  );
}
