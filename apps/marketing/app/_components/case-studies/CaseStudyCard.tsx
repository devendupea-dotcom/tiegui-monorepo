import Image from "next/image";
import Link from "next/link";
import type { CaseStudy } from "../../../content/caseStudies";

type CaseStudyCardProps = {
  study: CaseStudy;
};

export default function CaseStudyCard({ study }: CaseStudyCardProps) {
  const before = study.beforeImages[0];
  const after = study.afterImages[0];

  return (
    <article className="case-card">
      <Link href={`/case-studies/${study.slug}`} className="case-card__media-link" aria-label={`Open case study: ${study.title}`}>
        <div className="case-card__media">
          <div className="case-card__media-item">
            <span className="case-card__media-label">Before</span>
            <Image src={before.src} alt={before.alt} width={before.width} height={before.height} sizes="(max-width: 980px) 100vw, 33vw" />
          </div>
          <div className="case-card__media-item">
            <span className="case-card__media-label">After</span>
            <Image src={after.src} alt={after.alt} width={after.width} height={after.height} sizes="(max-width: 980px) 100vw, 33vw" />
          </div>
        </div>
      </Link>

      <div className="case-card__body">
        <p className="case-card__meta">{study.industry} | {study.location}</p>
        <h3 className="case-card__title">
          <Link href={`/case-studies/${study.slug}`}>{study.title}</Link>
        </h3>
        <p className="case-card__summary">{study.summary}</p>
        <ul className="case-card__outcomes">
          {study.outcomes.slice(0, 3).map((outcome) => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}
