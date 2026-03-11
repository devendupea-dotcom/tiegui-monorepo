export default function AdsAnalyticsLoading() {
  return (
    <>
      <section className="card command-center-hero">
        <div className="skeleton skeleton-line short" />
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-subtitle" />
      </section>

      <section className="command-center-grid">
        <section className="card">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-subtitle" />
          <div className="skeleton skeleton-list-item" />
          <div className="skeleton skeleton-list-item" />
        </section>
      </section>

      <section className="ads-channel-grid">
        <section className="card">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-subtitle" />
          <div className="skeleton skeleton-list-item" />
          <div className="skeleton skeleton-list-item" />
        </section>
        <section className="card">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-subtitle" />
          <div className="skeleton skeleton-list-item" />
          <div className="skeleton skeleton-list-item" />
        </section>
      </section>
    </>
  );
}
