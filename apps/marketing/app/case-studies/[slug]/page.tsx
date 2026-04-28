import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CASE_STUDIES, getCaseStudyBySlug } from "../../../content/caseStudies";
import { siteCopy } from "../../../content/siteCopy";
import BeforeAfterComparison from "../../_components/case-studies/BeforeAfterComparison";
import SiteFooter from "../../_components/SiteFooter";
import SiteHeader from "../../_components/SiteHeader";
import ButtonLink from "../../_components/ui/ButtonLink";
import Card from "../../_components/ui/Card";
import Section from "../../_components/ui/Section";

type CaseStudyPageProps = {
  params: {
    slug: string;
  };
};

export function generateStaticParams() {
  return CASE_STUDIES.map((study) => ({ slug: study.slug }));
}

export function generateMetadata({ params }: CaseStudyPageProps): Metadata {
  const study = getCaseStudyBySlug(params.slug);

  if (!study) {
    return {
      title: "Case Study Not Found",
    };
  }

  const title = `${study.title} | Case Study`;

  return {
    title,
    description: study.summary,
    openGraph: {
      title,
      description: study.summary,
      type: "article",
      url: `/case-studies/${study.slug}`,
      images: [
        {
          url: study.afterImages[0].src,
          width: study.afterImages[0].width,
          height: study.afterImages[0].height,
          alt: study.afterImages[0].alt,
        },
      ],
    },
  };
}

export default function CaseStudyPage({ params }: CaseStudyPageProps) {
  const study = getCaseStudyBySlug(params.slug);

  if (!study) {
    notFound();
  }

  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <Link href="/case-studies" className="back-link">
            Back to case studies
          </Link>
          <div className="section-head">
            <p className="tg-eyebrow">{study.industry} | {study.location}</p>
            <h1 className="tg-display">{study.title}</h1>
            <p className="tg-lead">{study.summary}</p>
          </div>
        </Section>

        <Section variant="muted">
          <BeforeAfterComparison beforeImages={study.beforeImages} afterImages={study.afterImages} />
        </Section>

        <Section>
          <div className="study-grid">
            <Card>
              <h2>What Changed</h2>
              <ul>
                {study.whatChanged.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2>Systems Installed</h2>
              <ul>
                {study.systemsInstalled.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2>Outcomes</h2>
              <ul>
                {study.outcomes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2>Stack</h2>
              <div className="chip-row">
                {study.stack.map((item) => (
                  <span key={item} className="chip">
                    {item}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          {study.testimonial ? (
            <Card className="study-testimonial" as="div">
              <p className="study-testimonial__quote">
                &ldquo;{study.testimonial.quote}&rdquo;
              </p>
              <p className="study-testimonial__meta">
                {study.testimonial.name}, {study.testimonial.role}
              </p>
            </Card>
          ) : null}
        </Section>

        <Section variant="borderTop" className="final-cta">
          <div className="final-cta__content">
            <h2 className="tg-title">{siteCopy.caseStudies.finalCta.title}</h2>
            <p className="tg-muted">{siteCopy.caseStudies.finalCta.subtitle}</p>
            <ButtonLink
              href={siteCopy.caseStudies.finalCta.cta.href}
              label={siteCopy.caseStudies.finalCta.cta.label}
              variant="primary"
            />
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
