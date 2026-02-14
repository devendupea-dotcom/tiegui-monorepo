import Link from "next/link";
import { BETA_CTA_LABEL, PRIMARY_CTA_LABEL, SECONDARY_CTA_LABEL } from "../_content";
import CommissionToggle from "./commission-toggle";
import { PRICING_FAQ, TIEGUI_PRICING } from "./pricing-data";

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

function formatPercent(rate: number): string {
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

function formatAdSpend(recommended: [number, number]): string {
  const [min, max] = recommended;
  return `${formatUsd(min)}–${formatUsd(max)}/month`;
}

export default function PricingSheet({ mode = "web" }: PricingSheetProps) {
  const isPdf = mode === "pdf";
  const betaSpotsRemaining = process.env.BETA_SPOTS_REMAINING || "5";

  return (
    <main className={`pricing-sheet${isPdf ? " pricing-sheet-pdf" : ""}`}>
      <section className="section pricing-hero">
        <div className="container section-head">
          <h1>TieGui Pricing (2026 Beta)</h1>
          <p className="muted">Clear scope, clear limits, and clear expectations before we start.</p>
          {isPdf ? null : (
            <div className="section-actions center site-only">
              <Link className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </Link>
              <Link className="cta-button-outline" href="/pricing/pdf" target="_blank">
                Export PDF
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section pricing-beta-section">
        <div className="container">
          <article className="beta-notice-card">
            <h2>{TIEGUI_PRICING.betaNotice.title}</h2>
            <p>{TIEGUI_PRICING.betaNotice.description}</p>
            <p className="beta-spots">Spots remaining: {betaSpotsRemaining}</p>
          </article>
        </div>
      </section>

      <section className="section packages-section">
        <div className="container">
          <div className="package-grid">
            {TIEGUI_PRICING.packages.map((pkg) => {
              const hasAdSpend = Array.isArray(pkg.recommendedAdSpend);
              const hasTargetingLimit = Boolean(pkg.targetingLimit);
              const hasCommission = Boolean(pkg.commissionOption);

              const slug = pkg.name.toLowerCase().replace(/\s+/g, "-");
              const isFeatured = pkg.name === "Growth";

              const monthlyLabel = pkg.monthly === 0 ? "$0/mo" : `${formatUsd(pkg.monthly)}/mo`;

              return (
                <article
                  className={`package-card pricing-card pricing-card-${slug}${isFeatured ? " featured" : ""}`}
                  key={pkg.name}
                >
                  {isFeatured ? <p className="package-chip">Most Popular</p> : null}
                  <h2>{pkg.name}</h2>

                  <dl className="pricing-card-fields">
                    <div>
                      <dt>Setup Fee</dt>
                      <dd>{formatUsd(pkg.oneTime)}</dd>
                    </div>
                    <div>
                      <dt>Monthly Fee</dt>
                      <dd>{monthlyLabel}</dd>
                    </div>
                  </dl>

                  {hasAdSpend ? (
                    <p className="pricing-card-ad-note">
                      Ad spend paid directly to Google Ads. Recommended minimum:{" "}
                      <strong>{formatAdSpend(pkg.recommendedAdSpend as [number, number])}</strong>.
                    </p>
                  ) : null}

                  <ul className="pricing-card-features">
                    {pkg.features.map((feature) => (
                      <li key={`${pkg.name}-${feature}`}>{feature}</li>
                    ))}
                  </ul>

                  {hasTargetingLimit ? (
                    <div className="pricing-policy-block">
                      <p className="pricing-policy-title">Targeting limits</p>
                      <p>{pkg.targetingLimit}</p>
                    </div>
                  ) : null}

                  {pkg.name === "Foundation" ? null : (
                    <div className="pricing-policy-block">
                      <p className="pricing-policy-title">Revision policy</p>
                      <p>1 round of consolidated revisions (submit all changes together)</p>
                    </div>
                  )}

                  {hasCommission ? (
                    <div className="commission-block">
                      <p className="pricing-policy-title">Commission Options</p>
                      {isPdf ? (
                        <div className="commission-toggle-grid">
                          <article className="commission-option">
                            <h3>Standard</h3>
                            <p className="commission-line">{formatUsd(pkg.monthly)}/mo</p>
                            <p className="commission-note">No commission.</p>
                          </article>
                          <article className="commission-option">
                            <h3>Commission-based</h3>
                            <p className="commission-line">{formatUsd(pkg.commissionOption!.monthly)}/mo</p>
                            <p className="commission-line">{formatPercent(pkg.commissionOption!.commissionRate)} commission</p>
                            <p className="commission-note">{pkg.commissionOption!.rules}</p>
                          </article>
                        </div>
                      ) : (
                        <CommissionToggle
                          standardMonthly={pkg.monthly}
                          commissionMonthly={pkg.commissionOption!.monthly}
                          commissionRate={pkg.commissionOption!.commissionRate}
                          rules={pkg.commissionOption!.rules}
                        />
                      )}
                    </div>
                  ) : null}

                  {isPdf ? null : (
                    <Link className="cta-button gold site-only" href="/contact">
                      {PRIMARY_CTA_LABEL}
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
          {isPdf ? null : (
            <div className="section-actions center site-only">
              <Link className="cta-button-outline" href="/contact">
                {BETA_CTA_LABEL}
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section guarantee-section">
        <div className="container guarantee-card">
          <h2>{TIEGUI_PRICING.performanceCommitment.title}</h2>
          <p>{TIEGUI_PRICING.performanceCommitment.description}</p>
        </div>
      </section>

      <section className="section faq-section">
        <div className="container">
          <div className="section-head">
            <h2>Pricing FAQ</h2>
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

      {isPdf ? null : (
        <section className="section final-cta site-only">
          <div className="container">
            <h2>Need help choosing the right package?</h2>
            <p className="muted">We can recommend the best fit after a short kickoff call.</p>
            <div className="section-actions center">
              <Link className="cta-button gold" href="/contact">
                {PRIMARY_CTA_LABEL}
              </Link>
              <Link className="cta-button-outline" href="/#portal-demo">
                {SECONDARY_CTA_LABEL}
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
