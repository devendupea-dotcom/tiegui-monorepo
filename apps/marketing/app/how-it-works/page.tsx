import SiteHeader from "../_components/SiteHeader";
import { CTA_LABEL, SYSTEM_STEPS } from "../_content";

export default function HowItWorksPage() {
  return (
    <div className="page">
      <SiteHeader />
      <section className="section">
        <div className="container">
          <div className="section-head">
            <h1>How It Works</h1>
            <p className="muted">A step-by-step system installed to generate calls.</p>
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
          <h2>Let’s see if we’re a fit</h2>
          <p className="muted">We’ll review your current setup and recommend next steps.</p>
          <a className="btn primary" href="/contact">{CTA_LABEL}</a>
        </div>
      </section>
    </div>
  );
}
