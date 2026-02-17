import Link from "next/link";
import { PRIMARY_CTA_LABEL, SECONDARY_CTA_LABEL } from "../_content";
import { PRICING_FAQ } from "./pricing-data";

type PricingSheetProps = {
  mode?: "web" | "pdf";
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function PricingSheet({ mode = "web" }: PricingSheetProps) {
  const isPdf = mode === "pdf";
  const avgJobValue = 2000;
  const missedJobsPerWeek = 2;
  const monthlyLostRevenue = avgJobValue * missedJobsPerWeek * 4;

  return (
    <main className={`pricing-sheet${isPdf ? " pricing-sheet-pdf" : ""}`}>
      <section className="section pricing-hero">
        <div className="container section-head">
          <h1>Pricing</h1>
          <p className="muted">Transparent expectations. Flexible setups.</p>
          <p className="muted">
            TieGui is onboarding select contractor partners. We help you activate leads, scheduling, and revenue
            automation. Get a free audit + personalized onboarding.
          </p>
          {isPdf ? null : (
            <div className="section-actions center site-only">
              <Link className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </Link>
              <Link className="cta-button-outline" href="/#demo-video">
                {SECONDARY_CTA_LABEL}
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section pricing-transparency-section">
        <div className="container">
          <article className="pricing-transparency-card tg-card tg-card--pricing">
            <div className="tg-card__inner">
              <h2 className="tg-card__title">Pricing Transparency</h2>
              <p className="tg-card__sub">You&apos;re wondering what TieGui costs. Fair question.</p>
              <p>
                Most contractors invest between <strong>$399</strong> and <strong>$1,500</strong> per month depending on
                business size, workflow complexity, and growth goals.
              </p>
              <ul className="pricing-model-list tg-list">
                <li>Some prefer fixed monthly pricing.</li>
                <li>Some prefer performance-based pricing.</li>
                <li>Many choose a hybrid.</li>
                <li>Complex workflows may require a custom setup.</li>
              </ul>
              <p className="muted pricing-transparency-note">We&apos;ll recommend what makes the most sense for your business.</p>
              {isPdf ? null : (
                <div className="section-actions">
                  <Link className="cta-button gold" href="/contact">
                    {PRIMARY_CTA_LABEL}
                  </Link>
                  <Link className="cta-button-outline" href="/pricing/pdf" target="_blank">
                    Export PDF
                  </Link>
                </div>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="section pricing-roi-section alt">
        <div className="container">
          <article className="pricing-roi-card tg-card tg-card--pricing">
            <div className="tg-card__inner">
              <h2 className="tg-card__title">Cost of Missed Leads</h2>
              <div className="tg-callout">
                <div className="tg-callout__big">
                  If you miss just <strong>{missedJobsPerWeek} jobs</strong> per week at{" "}
                  <strong>{formatUsd(avgJobValue)}</strong> per job, that&apos;s{" "}
                  <strong>{formatUsd(monthlyLostRevenue)}</strong> per month in lost revenue.
                </div>
                <div className="tg-callout__muted pricing-roi-question">
                  Would investing <strong>$800–$1,000/month</strong> to fix that make sense?
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="section pricing-installs-section">
        <div className="container">
          <div className="section-head">
            <h2>What TieGui Installs</h2>
            <p className="muted">A contractor-first lead-to-schedule system (not another generic CRM).</p>
          </div>
          <article className="pricing-installs-card tg-card">
            <div className="tg-card__inner">
              <ul className="pricing-installs-list tg-list">
                <li>Conversion-focused website</li>
                <li>Missed-call text-back automation</li>
                <li>Calendar &amp; crew sync</li>
                <li>Lead &amp; ROI tracking portal</li>
                <li>Optional Google Ads management</li>
                <li>Direct founder support</li>
              </ul>
            </div>
          </article>
        </div>
      </section>

      <section className="section pricing-final-section alt">
        <div className="container">
          <article className="guarantee-card">
            <h2>Book a 15-minute Free Audit</h2>
            <p>
              We&apos;ll identify where you&apos;re losing revenue and map the best setup and pricing for your business.
            </p>
            {isPdf ? null : (
              <div className="section-actions">
                <Link className="cta-button gold" href="/contact">
                  {PRIMARY_CTA_LABEL}
                </Link>
                <Link className="cta-button-outline" href="/#demo-video">
                  {SECONDARY_CTA_LABEL}
                </Link>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="section faq-section">
        <div className="container">
          <div className="section-head">
            <h2>FAQ</h2>
            <p className="muted">Important details before kickoff.</p>
          </div>
          <div className="faq-grid">
            {PRICING_FAQ.map((item) => (
              <details className="faq-item" key={item.q} open={isPdf}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
