import SiteHeader from "../_components/SiteHeader";
import SiteFooter from "../_components/SiteFooter";
import { BETA_CTA_LABEL, PRIMARY_CTA_LABEL } from "../_content";

const tiers = [
  {
    name: "Starter Engine",
    setup: "$1,500 one-time setup",
    monthly: "$497 / month",
    points: [
      "Conversion-focused website setup",
      "Lead capture forms + call tracking foundation",
      "Basic missed-call follow-up flow",
      "Monthly optimization check-in",
    ],
  },
  {
    name: "Growth Engine",
    setup: "$2,500 one-time setup",
    monthly: "$997 / month",
    points: [
      "Everything in Starter",
      "Google Ads management + local keyword mapping",
      "Attribution and call-quality reporting",
      "Lead response workflow tuning",
    ],
    featured: true,
  },
  {
    name: "Performance Partner",
    setup: "$3,500 setup",
    monthly: "Base retainer + commission option",
    points: [
      "Everything in Growth",
      "Revenue-linked optimization support",
      "Advanced follow-up + booking workflow design",
      "Executive visibility on ROI and lead quality",
    ],
  },
];

const comparisonRows = [
  { feature: "Website + conversion UX", starter: "Included", growth: "Included", performance: "Included" },
  { feature: "Google Ads management", starter: "Optional add-on", growth: "Included", performance: "Included" },
  { feature: "Call tracking + attribution", starter: "Core", growth: "Expanded", performance: "Expanded + deep reporting" },
  { feature: "Automation workflows", starter: "Basic", growth: "Enhanced", performance: "Advanced" },
  { feature: "Commission-friendly options", starter: "No", growth: "Optional", performance: "Yes" },
];

const pricingFaq = [
  {
    q: "Can we start on Starter and upgrade later?",
    a: "Yes. Most teams start with Starter or Growth and upgrade once lead flow and close-rate confidence improve.",
  },
  {
    q: "Do you lock us into annual terms?",
    a: "No. We keep agreements simple and avoid long-term lock-ins.",
  },
  {
    q: "How does commission pricing work?",
    a: "Commission structures are scoped case-by-case around tracked outcomes so both sides stay aligned.",
  },
  {
    q: "Do these plans include payment processing or CRM replacement?",
    a: "No. TieGui focuses on lead generation, follow-up, scheduling flow, and conversion clarity.",
  },
];

export default function PricingPage() {
  return (
    <div className="page">
      <SiteHeader />

      <main>
        <section className="section pricing-hero">
          <div className="container section-head">
            <h1>Pricing</h1>
            <p className="muted">Transparent tiers, clear scope, and room to scale as your operation grows.</p>
          </div>
        </section>

        <section className="section packages-section">
          <div className="container">
            <div className="package-grid">
              {tiers.map((tier) => (
                <article className={`package-card${tier.featured ? " featured" : ""}`} key={tier.name}>
                  {tier.featured ? <p className="package-chip">Most selected</p> : null}
                  <h2>{tier.name}</h2>
                  <p className="package-price">{tier.monthly}</p>
                  <p className="package-setup">{tier.setup}</p>
                  <ul>
                    {tier.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  <a className="cta-button gold" href="/contact">
                    {PRIMARY_CTA_LABEL}
                  </a>
                </article>
              ))}
            </div>
            <div className="section-actions center">
              <a className="cta-button-outline" href="/contact">
                {BETA_CTA_LABEL}
              </a>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head">
              <h2>What changes by tier</h2>
              <p className="muted">Simple side-by-side comparison so you can choose based on current goals.</p>
            </div>
            <div className="pricing-table-wrap">
              <table className="pricing-table" aria-label="Pricing comparison">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Starter</th>
                    <th>Growth</th>
                    <th>Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      <td>{row.starter}</td>
                      <td>{row.growth}</td>
                      <td>{row.performance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section guarantee-section">
          <div className="container guarantee-card">
            <h2>60-Day Performance Guarantee</h2>
            <p>
              If we can&apos;t show clear progress on lead quality + conversion tracking by day 60, we&apos;ll adjust the strategy or
              part ways. No long-term contracts. No penalties. No BS.
            </p>
            <p className="guarantee-tagline">We only win when you win.</p>
          </div>
        </section>

        <section className="section faq-section">
          <div className="container">
            <div className="section-head">
              <h2>Pricing FAQ</h2>
              <p className="muted">Answers to the most common planning questions.</p>
            </div>
            <div className="faq-grid">
              {pricingFaq.map((item) => (
                <details className="faq-item" key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="section final-cta">
          <div className="container">
            <h2>Need help choosing the right package?</h2>
            <p className="muted">Tell us your market and revenue goals, and we&apos;ll recommend a practical path.</p>
            <a className="cta-button gold" href="/contact">
              Let&apos;s Talk
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
