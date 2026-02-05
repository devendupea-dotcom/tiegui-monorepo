import SiteHeader from "./_components/SiteHeader";
import HeroShowcase from "./_components/HeroShowcase";
import { CTA_LABEL, HOW_IT_WORKS, SMS_EXAMPLE, TRUST_POINTS, FAQS } from "./_content";

export default function HomePage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="hero" id="top">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-base" />
          <div className="hero-glow" />
          <div className="hero-watermark" aria-hidden="true" />
          <div className="hero-vignette" />
          <div className="hero-noise" />
        </div>

        <HeroShowcase />
      </main>

      <section className="trust-strip">
        <div className="container trust-inner">
          {TRUST_POINTS.map((item) => (
            <div key={item} className="trust-item">
              <span className="trust-dot" aria-hidden="true" />
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="section how-section alt">
        <div className="container">
          <div className="section-head">
            <h2>How we help contractors grow</h2>
            <p className="muted">A simple system that turns traffic into booked jobs.</p>
          </div>
          <div className="how-grid">
            {HOW_IT_WORKS.map((step) => (
              <div className="how-card" key={step.title}>
                <div className="how-title">{step.title}</div>
                <p className="how-desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section proof-section">
        <div className="container">
          <div className="section-head">
            <h2>Why contractors work with us</h2>
            <p className="muted">Focused on calls, not vanity metrics.</p>
          </div>
          <ul className="proof-list">
            <li>Operator-led systems built for local service businesses</li>
            <li>Clear tracking so you know which calls make you money</li>
            <li>Automation that saves time and keeps leads moving</li>
          </ul>
        </div>
      </section>

      <section className="section sms-section alt">
        <div className="container sms-grid">
          <div className="sms-copy">
            <div className="sms-chip">{SMS_EXAMPLE.trigger}</div>
            <h2>{SMS_EXAMPLE.title}</h2>
            <p className="muted">{SMS_EXAMPLE.subtitle}</p>
            <p className="sms-trust">{SMS_EXAMPLE.trustLine}</p>
            <a className="btn primary" href="/contact">See if this fits your business</a>
          </div>
          <div className="sms-chat">
            <div className="sms-card">
              {SMS_EXAMPLE.messages.map((msg, idx) => (
                <div key={idx} className={`sms-bubble ${msg.from}`}>{msg.text}</div>
              ))}
            </div>
            <div className="sms-notice">
              <div className="sms-notice-title">{SMS_EXAMPLE.notification.title}</div>
              {SMS_EXAMPLE.notification.details.map((line) => (
                <div key={line} className="sms-notice-line">{line}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section final-cta">
        <div className="container">
          <h2>Ready to get more calls?</h2>
          <p className="muted">Book a quick call and we’ll map the right system for your business.</p>
          <a className="btn primary" href="/contact">{CTA_LABEL}</a>
        </div>
      </section>

      <section className="section faq-section" id="faq">
        <div className="container">
          <div className="section-head">
            <h2>FAQ</h2>
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

      <footer className="footer" id="site-footer">
        <div className="container footer-inner">
          <div className="footer-trust">Websites &amp; lead systems for local service businesses.</div>
          <div>(c) {new Date().getFullYear()} Tiegui Solutions</div>
        </div>
      </footer>
    </div>
  );
}
