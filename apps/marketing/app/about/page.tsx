import Image from "next/image";
import SiteHeader from "../_components/SiteHeader";
import SiteFooter from "../_components/SiteFooter";
import { PRIMARY_CTA_LABEL, SECONDARY_CTA_LABEL } from "../_content";

export default function AboutPage() {
  return (
    <div className="page">
      <SiteHeader />

      <main>
        <section className="section about-hero">
          <div className="container">
            <p className="about-eyebrow">About TieGui Solutions</p>
            <h1>Built in Tacoma for contractors who care about booked jobs, not fluff metrics.</h1>
            <p className="about-subhead">
              We are a local operator-led team helping home service companies turn ad spend into predictable calls,
              follow-ups, and scheduled work.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container origin-grid">
            <div className="about-text">
              <h2>Why we built TieGui</h2>
              <p>
                We saw too many contractors paying for marketing that looked polished but could not clearly prove lead
                quality. TieGui was built to fix that gap with practical systems: strong web foundations, clear attribution,
                and fast follow-up.
              </p>
              <p>
                We keep delivery straightforward: transparent pricing, visible reporting, and workflows your team can
                actually run day-to-day.
              </p>
              <ul className="about-bullets">
                <li>Clear conversion tracking tied to real calls and jobs</li>
                <li>Contractor-first UX built for speed on mobile</li>
                <li>No long-term lock-ins or confusing retainers</li>
              </ul>
              <div className="section-actions">
                <a className="cta-button gold" href="/contact">
                  {PRIMARY_CTA_LABEL}
                </a>
                <a className="cta-button-outline" href="/case-studies">
                  {SECONDARY_CTA_LABEL}
                </a>
              </div>
            </div>
            <div className="origin-media">
              <Image
                src="/images/pnw-site-screenshot.png"
                alt="TieGui portfolio snapshot"
                width={1600}
                height={1000}
                sizes="(max-width: 980px) 100vw, 45vw"
              />
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>How we work with clients</h2>
            <div className="about-grid">
              <article className="about-card">
                <h3 className="about-card-title">Diagnose first</h3>
                <p>We start by auditing your current offer flow, lead quality, and follow-up speed.</p>
              </article>
              <article className="about-card">
                <h3 className="about-card-title">Build what matters</h3>
                <p>We implement only the pieces that directly improve booked calls and close-rate visibility.</p>
              </article>
              <article className="about-card">
                <h3 className="about-card-title">Optimize with proof</h3>
                <p>Every decision is tied back to tracked outcomes, not vanity dashboards.</p>
              </article>
              <article className="about-card">
                <h3 className="about-card-title">Stay accountable</h3>
                <p>No long-term contracts. We keep earning the relationship through measurable progress.</p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
