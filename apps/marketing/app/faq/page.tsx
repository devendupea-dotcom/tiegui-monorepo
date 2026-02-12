import SiteHeader from "../_components/SiteHeader";
import SiteFooter from "../_components/SiteFooter";
import { FAQS } from "../_content";

export default function FAQPage() {
  return (
    <div className="page">
      <SiteHeader />
      <section className="section faq-section">
        <div className="container">
          <div className="section-head">
            <h1>FAQ</h1>
            <p className="muted">Quick answers before we talk.</p>
          </div>
          <div className="faq-grid">
            {FAQS.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
