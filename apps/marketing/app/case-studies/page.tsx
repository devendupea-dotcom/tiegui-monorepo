import type { Metadata } from "next";
import { CASE_STUDIES } from "../../content/caseStudies";
import { siteCopy } from "../../content/siteCopy";
import CaseStudyCard from "../_components/case-studies/CaseStudyCard";
import SiteFooter from "../_components/SiteFooter";
import SiteHeader from "../_components/SiteHeader";
import ButtonLink from "../_components/ui/ButtonLink";
import Section from "../_components/ui/Section";

const { caseStudies } = siteCopy;

export const metadata: Metadata = {
  title: "Case Studies",
  description:
    "See TieGui revenue infrastructure transformations with before/after context, installed systems, and outcome summaries.",
};

export default function CaseStudiesPage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <div className="section-head">
            <p className="tg-eyebrow">{caseStudies.hero.eyebrow}</p>
            <h1 className="tg-display">{caseStudies.hero.title}</h1>
            <p className="tg-lead">{caseStudies.hero.subtitle}</p>
          </div>
        </Section>

        <Section variant="muted">
          <div className="case-grid">
            {CASE_STUDIES.map((study) => (
              <CaseStudyCard key={study.slug} study={study} />
            ))}
          </div>
        </Section>

        <Section className="final-cta" variant="borderTop">
          <div className="final-cta__content">
            <h2 className="tg-title">{caseStudies.finalCta.title}</h2>
            <p className="tg-muted">{caseStudies.finalCta.subtitle}</p>
            <ButtonLink href={caseStudies.finalCta.cta.href} label={caseStudies.finalCta.cta.label} variant="primary" />
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
