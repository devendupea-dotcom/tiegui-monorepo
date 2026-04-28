import Link from "next/link";
import { prospects } from "./_data/prospects";

export default function HomePage() {
  return (
    <main className="studio-shell">
      <div className="studio-glow studio-glow--one" aria-hidden="true" />
      <div className="studio-glow studio-glow--two" aria-hidden="true" />

      <section className="studio-hero">
        <div className="studio-hero__copy">
          <p className="section-kicker">Tacoma landscaping outreach buildout</p>
          <h1>10 weak landscaping websites rebuilt into stronger concept pages.</h1>
          <p>
            Each route below is a polished homepage concept built in Next.js to the same
            conversion standard you wanted from Velocity Landscapes: clearer offer, stronger proof,
            and a real TieGui plus Twilio CRM growth story.
          </p>
        </div>

        <div className="studio-stats">
          <article>
            <strong>10</strong>
            <span>Concept pages</span>
          </article>
          <article>
            <strong>Tacoma</strong>
            <span>Primary market</span>
          </article>
          <article>
            <strong>Next.js</strong>
            <span>Ready for Vercel</span>
          </article>
        </div>
      </section>

      <section className="studio-grid">
        {prospects.map((prospect) => (
          <article className="studio-card" key={prospect.slug}>
            <div className="studio-card__eyebrow">
              <span>{prospect.location}</span>
              <span>{prospect.segment}</span>
            </div>

            <h2>{prospect.company}</h2>
            <p>{prospect.auditSummary}</p>

            <ul className="studio-card__issues">
              {prospect.currentIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>

            <div className="studio-card__actions">
              <Link className="button button--primary button--small" href={`/${prospect.slug}`}>
                Open concept
              </Link>
              <a className="button button--secondary button--small" href={prospect.currentSite} rel="noreferrer" target="_blank">
                Current site
              </a>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
