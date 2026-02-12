export default function AppHomeLoading() {
  return (
    <>
      <section className="card app-today-card">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-subtitle" />
        <div className="next-job-card">
          <div className="skeleton skeleton-kicker" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
          <div className="skeleton-row">
            <div className="skeleton skeleton-btn" />
            <div className="skeleton skeleton-btn" />
            <div className="skeleton skeleton-btn" />
          </div>
        </div>
        <div className="skeleton skeleton-list-item" />
        <div className="skeleton skeleton-list-item" />
        <div className="skeleton skeleton-list-item" />
      </section>
    </>
  );
}

