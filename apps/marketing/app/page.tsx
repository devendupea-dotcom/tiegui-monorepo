import Image from "next/image";
import SiteHeader from "./_components/SiteHeader";
import SiteFooter from "./_components/SiteFooter";
import HeroShowcase from "./_components/HeroShowcase";
import {
  BETA_CTA_LABEL,
  FAQS,
  HOW_IT_WORKS_TIMELINE,
  PRICING_PREVIEW,
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
  SMS_EXAMPLE,
  TRUST_POINTS,
} from "./_content";

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

      <section className="section portfolio-section" id="portfolio-showcase">
        <div className="container portfolio-grid">
          <div className="portfolio-copy">
            <p className="section-eyebrow">Portfolio showcase</p>
            <h2>Real contractor site. Real conversion flow.</h2>
            <p className="muted">
              This is the quality bar for TieGui builds: clear offer, local trust signals, and a booking-first layout designed for
              mobile callers.
            </p>
            <ul className="proof-list">
              <li>Built for high-intent local traffic and fast lead capture.</li>
              <li>Designed for contractors that need calls, not vanity pageviews.</li>
              <li>Integrated with follow-up workflows so leads do not go cold.</li>
            </ul>
            <div className="section-actions">
              <a className="cta-button-outline" href="https://pnw-landscape-demo.web.app" target="_blank" rel="noreferrer">
                {SECONDARY_CTA_LABEL}
              </a>
              <a className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </a>
            </div>
          </div>
          <div className="portfolio-media">
            <Image
              src="/images/pnw-site-preview.png"
              alt="PNW landscaping website preview"
              width={1600}
              height={1000}
              sizes="(max-width: 980px) 100vw, 55vw"
              priority
            />
          </div>
        </div>
      </section>

      <section className="section timeline-section" id="how-it-works">
        <div className="container">
          <div className="section-head">
            <h2>How It Works</h2>
            <p className="muted">A straight path from traffic to booked work.</p>
          </div>
          <div className="timeline-list">
            {HOW_IT_WORKS_TIMELINE.map((item) => (
              <article className="timeline-card" key={item.title}>
                <p className="timeline-step">{item.step}</p>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
          <div className="timeline-cta">
            <a className="cta-button gold" href="/contact">
              {PRIMARY_CTA_LABEL}
            </a>
          </div>
        </div>
      </section>

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

      <section className="section pricing-preview-section" id="pricing-preview">
        <div className="container">
          <div className="section-head">
            <h2>Transparent pricing. Flexible growth path.</h2>
            <p className="muted">Pick the package that matches your stage. Upgrade when it makes sense.</p>
          </div>
          <div className="pricing-preview-grid">
            {PRICING_PREVIEW.map((tier) => (
              <article className="pricing-preview-card" key={tier.name}>
                <p className="pricing-preview-name">{tier.name}</p>
                <p className="pricing-preview-price">{tier.price}</p>
                <ul>
                  {tier.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="section-actions center">
            <a className="cta-button gold" href="/pricing">
              {BETA_CTA_LABEL}
            </a>
            <a className="cta-button-outline" href="/contact">
              {SECONDARY_CTA_LABEL}
            </a>
          </div>
        </div>
      </section>

      <section className="section sms-section alt" id="system">
        <div className="container sms-grid">
          <div className="sms-copy">
            <div className="sms-chip">{SMS_EXAMPLE.trigger}</div>
            <h2>{SMS_EXAMPLE.title}</h2>
            <p className="muted">{SMS_EXAMPLE.subtitle}</p>
            <p className="sms-trust">{SMS_EXAMPLE.trustLine}</p>
            <a className="cta-button-outline" href="/contact">
              {SECONDARY_CTA_LABEL}
            </a>
          </div>
          <div className="sms-chat">
            <div className="sms-card">
              {SMS_EXAMPLE.messages.map((msg, idx) => (
                <div key={idx} className={`sms-bubble ${msg.from}`}>
                  {msg.text}
                </div>
              ))}
            </div>
            <div className="sms-notice">
              <div className="sms-notice-title">{SMS_EXAMPLE.notification.title}</div>
              {SMS_EXAMPLE.notification.details.map((line) => (
                <div key={line} className="sms-notice-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section final-cta">
        <div className="container">
          <h2>Ready to see what this could look like for your business?</h2>
          <p className="muted">Book a quick call and we will map the best path for your market.</p>
          <div className="section-actions center">
            <a className="cta-button gold" href="/contact">
              {PRIMARY_CTA_LABEL}
            </a>
            <a className="cta-button-outline" href="/contact">
              Let&apos;s Talk
            </a>
          </div>
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

      <SiteFooter />
    </div>
  );
}
