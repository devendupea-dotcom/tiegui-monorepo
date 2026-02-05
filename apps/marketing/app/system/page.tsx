import SiteHeader from "../_components/SiteHeader";
import { CTA_LABEL, SYSTEM_STEPS } from "../_content";

export default function SystemPage() {
  return (
    <div className="page">
      <SiteHeader />
      <section className="section">
        <div className="container">
          <div className="section-head">
            <h1>The System</h1>
            <p className="muted">A simple revenue engine installed for contractors.</p>
          </div>
          <div className="engine-grid">
            {SYSTEM_STEPS.map((item) => (
              <div className="engine-card" key={item.title}>
                <div className="engine-title">{item.title}</div>
                <p className="engine-desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section final-cta">
        <div className="container">
          <h2>Ready to see it for your business?</h2>
          <p className="muted">We’ll review your current setup and recommend the fastest path to more calls.</p>
          <a className="btn primary" href="/contact">{CTA_LABEL}</a>
        </div>
      </section>
    </div>
  );
}

