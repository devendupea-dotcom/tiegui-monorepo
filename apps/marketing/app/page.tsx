import type { Metadata } from "next";
import { siteCopy } from "../content/siteCopy";
import SiteFooter from "./_components/SiteFooter";
import SiteHeader from "./_components/SiteHeader";
import Card from "./_components/ui/Card";
import Hero from "./_components/ui/Hero";
import Section from "./_components/ui/Section";
import ButtonLink from "./_components/ui/ButtonLink";

const { home } = siteCopy;

export const metadata: Metadata = {
  title: "Call-to-Cash Contractor OS",
  description:
    "TieGui helps contractors capture leads, reply fast, send estimates, schedule jobs, dispatch crews, and track invoices in one workspace.",
};

export default function HomePage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section className="hero-section">
          <Hero
            eyebrow={home.hero.eyebrow}
            title={home.hero.title}
            highlight={home.hero.highlight}
            subtitle={home.hero.subtitle}
            supportLine={home.hero.supportLine}
            chips={home.hero.chips}
            showcase={home.hero.showcase}
            primaryCta={home.hero.primaryCta}
            secondaryCta={home.hero.secondaryCta}
          />
        </Section>

        <Section id="proof" variant="borderTop">
          <div className="section-head">
            <p className="tg-eyebrow">{home.proofRow.title}</p>
          </div>
          <ul className="proof-row" aria-label="Credibility points">
            {home.proofRow.bullets.map((bullet) => (
              <li key={bullet} className="proof-row__item">
                {bullet}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="problem" variant="muted">
          <div className="section-head">
            <h2 className="tg-title">{home.problem.title}</h2>
            <p className="tg-lead">{home.problem.statement}</p>
          </div>
          <ul className="problem-points">
            {home.problem.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </Section>

        <Section id="what-we-build">
          <div className="section-head">
            <h2 className="tg-title">{home.build.title}</h2>
            <p className="tg-muted">{home.build.subtitle}</p>
          </div>
          <div className="systems-grid">
            {home.build.cards.map((card) => (
              <Card key={card.title}>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                <ul>
                  {card.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="app-preview" variant="muted">
          <div className="section-head">
            <h2 className="tg-title">See what needs attention before it costs you money.</h2>
            <p className="tg-muted">
              TieGui shows the owner what needs a reply, what estimate is waiting, what job is ready to schedule, and what invoice still needs payment.
            </p>
          </div>

          <div className="app-preview-board" aria-label="TieGui app preview">
            <div className="app-preview-board__main">
              <div className="app-preview-board__top">
                <div>
                  <p className="tg-eyebrow">Today&apos;s Work</p>
                  <h3>Owner command center</h3>
                </div>
                <span>Live workspace</span>
              </div>

              <div className="attention-grid">
                {[
                  ["Needs Reply", "3", "Missed calls and open texts"],
                  ["Estimates Waiting", "2", "Sent quotes needing follow-up"],
                  ["Ready to Schedule", "5", "Approved work waiting for calendar"],
                  ["Open Invoices", "$3,240", "Unpaid balances to chase"],
                ].map(([label, value, detail]) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <p>{detail}</p>
                  </article>
                ))}
              </div>

              <div className="preview-table">
                <div className="preview-table__row preview-table__row--head">
                  <span>Customer</span>
                  <span>Status</span>
                  <span>Next step</span>
                </div>
                {[
                  ["M. Torres", "Estimate sent", "Follow up today"],
                  ["Greenview HOA", "Approved", "Schedule crew"],
                  ["R. Johnson", "Invoice unpaid", "Send reminder"],
                ].map(([customer, status, next]) => (
                  <div className="preview-table__row" key={customer}>
                    <span>{customer}</span>
                    <strong>{status}</strong>
                    <span>{next}</span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="app-preview-side">
              <h3>What the customer can see</h3>
              <div>
                <span>Estimate approval</span>
                <strong>View, approve, or decline from a clean link</strong>
              </div>
              <div>
                <span>Job updates</span>
                <strong>Scheduled, on the way, completed</strong>
              </div>
              <div>
                <span>Invoice link</span>
                <strong className="warning-text">Unpaid · $860</strong>
              </div>

              <h3>Recent customer message</h3>
              <p>“Can you send over the cleanup estimate again? We want to get on the schedule.”</p>
              <div>
                <span>Job photos / notes</span>
                <strong>6 photos attached</strong>
              </div>
            </aside>
          </div>
        </Section>

        <Section id="process" variant="muted">
          <div className="section-head">
            <h2 className="tg-title">{home.process.title}</h2>
          </div>
          <div className="steps-grid">
            {home.process.steps.map((step, index) => (
              <Card key={step.title}>
                <p className="step-index">0{index + 1}</p>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="offer" variant="muted">
          <div className="section-head">
            <h2 className="tg-title">{home.offer.title}</h2>
            <p className="tg-muted">{home.offer.subtitle}</p>
          </div>
          <div className="offer-grid">
            <Card>
              <p className="tg-eyebrow">{home.offer.setup.label}</p>
              <p className="offer-price">{home.offer.setup.price}</p>
              <ul>
                {home.offer.setup.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </Card>
            <Card>
              <p className="tg-eyebrow">{home.offer.monthly.label}</p>
              <p className="offer-price">{home.offer.monthly.price}</p>
              <ul>
                {home.offer.monthly.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </Card>
          </div>
          <p className="tg-note">{home.offer.note}</p>
        </Section>

        <Section variant="borderTop" className="final-cta">
          <div className="final-cta__content">
            <h2 className="tg-title">{home.finalCta.title}</h2>
            <p className="tg-muted">{home.finalCta.subtitle}</p>
            <div className="hero-actions">
              <ButtonLink href={home.finalCta.primaryCta.href} label={home.finalCta.primaryCta.label} variant="primary" />
              <ButtonLink href={home.finalCta.secondaryCta.href} label={home.finalCta.secondaryCta.label} variant="secondary" />
            </div>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
