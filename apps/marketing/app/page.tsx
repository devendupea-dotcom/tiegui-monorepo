import Image from "next/image";
import SiteHeader from "./_components/SiteHeader";
import SiteFooter from "./_components/SiteFooter";
import HeroShowcase, { PortalDemoCarousel } from "./_components/HeroShowcase";
import {
  FAQS,
  HOW_IT_WORKS_TIMELINE,
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
  SMS_EXAMPLE,
  TRUST_POINTS,
} from "./_content";

const DELIVERY_MILESTONES = [
  {
    title: "Lead Flow Audit + Offer Map",
    window: "Days 1–2",
    desc: "We review your current lead flow, market, and offer so we can stop wasted spend fast.",
    bullets: ["Map your first 5 calls", "Define your service area + targeting limits", "Set measurable milestones"],
  },
  {
    title: "Conversion Website + Tracking Installed",
    window: "Days 3–7",
    desc: "A booking-first site built for mobile callers with tracking wired end-to-end.",
    bullets: ["Click-to-call + fast forms", "UTMs + call tracking", "Clear booking path on every page"],
  },
  {
    title: "Instant Follow-Up (Missed Call → Text Back)",
    window: "Days 8–10",
    desc: "If you miss a call, the lead gets a fast text so you still win the job.",
    bullets: ["Missed-call text-back", "Basic intake questions", "Follow-up prompts for your team"],
  },
  {
    title: "Launch + Command Center Dashboard",
    window: "Days 11–14",
    desc: "You get a clean dashboard that ties ad spend to calls, booked jobs, and ROI.",
    bullets: ["Leads + job log", "Revenue + ROI scorecard", "Simple weekly performance view"],
  },
] as const;

const SYSTEM_PROOF_METRICS = [
  { label: "Leads", value: "42", note: "Last 30 days" },
  { label: "Won", value: "$18,900", note: "Revenue (won)" },
  { label: "ROI", value: "3.2×", note: "Spend → revenue" },
] as const;

const DEMO_VIDEO_EMBED_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_EMBED_URL || "";

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

      <section className="section demo-video-section alt" id="demo-video">
        <div className="container">
          <div className="section-head">
            <p className="section-eyebrow">Demo</p>
            <h2>Watch How Contractors Book Jobs Automatically</h2>
            <p className="muted">Real missed call → automatic text → booked job → crew scheduled.</p>
          </div>

          <div className="demo-video-frame">
            {DEMO_VIDEO_EMBED_URL ? (
              <iframe
                className="demo-video-iframe"
                src={DEMO_VIDEO_EMBED_URL}
                title="TieGui demo video"
                loading="lazy"
                allow="fullscreen; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="demo-video-fallback">
                <p className="muted" style={{ margin: 0 }}>
                  Demo video coming soon.
                </p>
                <p className="muted" style={{ margin: "10px 0 0" }}>
                  Set <code>NEXT_PUBLIC_DEMO_VIDEO_EMBED_URL</code> to your Loom/Vimeo embed URL.
                </p>
              </div>
            )}
          </div>

          <div className="section-actions center">
            <a className="cta-button gold" href="/contact">
              {PRIMARY_CTA_LABEL}
            </a>
          </div>
        </div>
      </section>

      <section className="section proof-section" id="system-proof">
        <div className="container">
          <div className="section-head">
            <p className="section-eyebrow">System proof</p>
            <h2>Proof beats promises.</h2>
            <p className="muted">Demo metrics shown — your dashboard tracks these metrics.</p>
          </div>

          <div className="proof-metrics-grid">
            {SYSTEM_PROOF_METRICS.map((metric) => (
              <article className="proof-metric" key={metric.label}>
                <div className="proof-metric-label">{metric.label}</div>
                <div className="proof-metric-value">{metric.value}</div>
                <div className="proof-metric-note">{metric.note}</div>
              </article>
            ))}
            <article className="proof-metric proof-metric-wide">
              <div className="proof-metric-label">What gets tracked</div>
              <ul className="proof-metric-list">
                <li>Ad spend → calls → booked jobs → revenue</li>
                <li>Lead source + landing page + UTM proof view</li>
                <li>Immutable activity timeline for accountability</li>
              </ul>
            </article>
          </div>

          <div className="section-actions center">
            <a className="cta-button gold" href="/contact">
              {PRIMARY_CTA_LABEL}
            </a>
            <a className="cta-button-outline" href="#demo-video">
              {SECONDARY_CTA_LABEL}
            </a>
          </div>
        </div>
      </section>

      <section className="section delivery-section" id="what-you-get">
        <div className="container">
          <div className="section-head">
            <p className="section-eyebrow">What you get</p>
            <h2>What You Get in 14 Days</h2>
            <p className="muted">
              Clear deliverables, measurable milestones, and a simple revision loop that protects your time.
            </p>
          </div>

          <div className="milestone-grid">
            {DELIVERY_MILESTONES.map((milestone) => (
              <article className="milestone-card" key={milestone.title}>
                <div className="milestone-window">{milestone.window}</div>
                <h3>{milestone.title}</h3>
                <p className="muted">{milestone.desc}</p>
                <ul>
                  {milestone.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <p className="muted delivery-note">
            Revision policy: 1 round of <strong>consolidated revisions</strong> (submit all changes together in one list).
          </p>

          <div className="section-actions center">
            <a className="cta-button gold" href="/contact">
              {PRIMARY_CTA_LABEL}
            </a>
            <a className="cta-button-outline" href="#demo-video">
              {SECONDARY_CTA_LABEL}
            </a>
          </div>
        </div>
      </section>

      <section className="section portal-demo-section alt" id="portal-demo">
        <div className="container portal-demo-grid">
          <div className="portal-demo-copy">
            <p className="section-eyebrow">Watch the flow</p>
            <h2>New Call → Scheduled Job → Project Folder → Proof</h2>
            <p className="muted">
              This is the contractor workflow that reduces ghosting, speeds up booking, and makes ROI visible.
            </p>
            <ul className="proof-list">
              <li>See exactly where every call came from (UTMs + tracking).</li>
              <li>Book fast from mobile without calendar chaos.</li>
              <li>Store notes, photos, and measurements in the job folder.</li>
            </ul>
            <div className="section-actions">
              <a className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </a>
              <a className="cta-button-outline" href="#demo-video">
                {SECONDARY_CTA_LABEL}
              </a>
            </div>
            <p className="muted portal-demo-note">
              See which calls turned into booked revenue — not vanity clicks.
            </p>
          </div>

          <div className="portal-demo-media">
            <PortalDemoCarousel />
          </div>
        </div>
      </section>

      <section className="section portfolio-section" id="portfolio-showcase">
        <div className="container portfolio-grid">
          <div className="portfolio-copy">
            <p className="section-eyebrow">Case study</p>
            <h2>PNW Landscaping — booking-first layout + follow-up automation</h2>
            <p className="muted">
              A demo example of the TieGui quality bar: clear offer, local trust signals, and a booking path designed for
              mobile callers. Demo metrics shown — your dashboard tracks these metrics.
            </p>
            <ul className="proof-list">
              <li>Response-time workflow under 60 seconds (missed-call text-back).</li>
              <li>Booking-first mobile layout built for calls, not vanity traffic.</li>
              <li>Tracking installed: UTMs + call records + proof view for attribution.</li>
            </ul>
            <div className="section-actions">
              <a className="cta-button-outline" href="https://pnw-landscape-demo.web.app" target="_blank" rel="noreferrer">
                View Live Example
              </a>
              <a className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </a>
            </div>
          </div>
          <div className="portfolio-media">
            <Image
              src="/images/pnw-site-screenshot.png"
              alt="PNW landscaping website screenshot"
              width={1600}
              height={1000}
              sizes="(max-width: 980px) 100vw, 55vw"
              priority
            />
          </div>
        </div>
      </section>

      <section className="section loss-section" id="why-contractors-lose-leads">
        <div className="container">
          <div className="section-head">
            <p className="section-eyebrow">Why leads get lost</p>
            <h2>Why Most Contractors Lose Leads</h2>
            <p className="muted">It’s usually not “bad ads.” It’s the lead flow.</p>
          </div>

          <div className="loss-grid">
            <article className="loss-card">
              <h3>Three killers</h3>
              <ul className="loss-list">
                <li>
                  <strong>Slow response time</strong> (the first 5 minutes)
                </li>
                <li>
                  <strong>No booking path on mobile</strong> (clicks become dead ends)
                </li>
                <li>
                  <strong>No attribution</strong> (ads feel like gambling)
                </li>
              </ul>
            </article>

            <article className="loss-card highlight">
              <h3>Revenue engines, not brochure sites.</h3>
              <p className="muted">
                TieGui is built for one thing: turning demand into booked work. We install fast follow-up, clean
                scheduling, and ROI tracking so you can see what’s working and stop guessing.
              </p>
              <div className="section-actions">
                <a className="cta-button gold" href="/contact">
                  {PRIMARY_CTA_LABEL}
                </a>
                <a className="cta-button-outline" href="#demo-video">
                  {SECONDARY_CTA_LABEL}
                </a>
              </div>
            </article>
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

      <section className="section sms-section alt" id="system">
        <div className="container sms-grid">
          <div className="sms-copy">
            <div className="sms-chip">{SMS_EXAMPLE.trigger}</div>
            <h2>{SMS_EXAMPLE.title}</h2>
            <p className="muted">{SMS_EXAMPLE.subtitle}</p>
            <p className="sms-trust">{SMS_EXAMPLE.trustLine}</p>
            <a className="cta-button-outline" href="#demo-video">
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

      <section className="section founder-story-section" id="founder-story">
        <div className="container">
          <article className="founder-card founder-story-card">
            <p className="section-eyebrow">Founder story</p>
            <div className="founder-story-copy">
              <p>
                I built TieGui after seeing contractors lose jobs simply because they were too busy working to answer
                their phones.
              </p>
              <p>
                Most CRM systems are built for office sales teams. TieGui is built for contractors in the field.
              </p>
              <p>
                We&apos;re working with a small group of businesses to refine the system before wider rollout, which
                means you get direct access to the founder and hands-on setup.
              </p>
              <p className="founder-signature">— Deven Dupea, Founder</p>
            </div>
            <div className="section-actions">
              <a className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </a>
              <a className="cta-button-outline" href="#demo-video">
                {SECONDARY_CTA_LABEL}
              </a>
            </div>
          </article>
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
            <a className="cta-button-outline" href="#demo-video">
              {SECONDARY_CTA_LABEL}
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
