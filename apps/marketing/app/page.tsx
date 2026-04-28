import type { Metadata } from "next";
import { getFeaturedCaseStudies } from "../content/caseStudies";
import { siteCopy } from "../content/siteCopy";
import CaseStudyCard from "./_components/case-studies/CaseStudyCard";
import SiteFooter from "./_components/SiteFooter";
import SiteHeader from "./_components/SiteHeader";
import Card from "./_components/ui/Card";
import Hero from "./_components/ui/Hero";
import Section from "./_components/ui/Section";
import ButtonLink from "./_components/ui/ButtonLink";

const featuredCaseStudies = getFeaturedCaseStudies(3);
const { home } = siteCopy;

export const metadata: Metadata = {
  title: "Revenue Infrastructure for Home Service Businesses",
  description:
    "TieGui installs connected systems for home service businesses: website, automation, CRM pipeline, and reporting tied to booked jobs.",
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
            subtitle={home.hero.subtitle}
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

        <Section id="case-study-preview">
          <div className="section-head section-head--split">
            <div>
              <h2 className="tg-title">{home.caseStudyPreview.title}</h2>
              <p className="tg-muted">{home.caseStudyPreview.subtitle}</p>
            </div>
            <ButtonLink href={home.caseStudyPreview.cta.href} label={home.caseStudyPreview.cta.label} variant="secondary" />
          </div>

          <div className="case-grid">
            {featuredCaseStudies.map((study) => (
              <CaseStudyCard key={study.slug} study={study} />
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

        <Section id="faq">
          <div className="section-head">
            <h2 className="tg-title">{home.faq.title}</h2>
          </div>
          <div className="faq-grid">
            {home.faq.items.map((item) => (
              <details className="faq-item" key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
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
