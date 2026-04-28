import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Prospect } from "../_data/prospects";

const tieGuiHref = "https://www.tieguisolutions.com/";
const tieGuiEmail = "mailto:admin@tieguisolutions.com";

function makeMailto(company: string) {
  const subject = `Homepage concept for ${company}`;
  const body = [
    `Hi ${company},`,
    "",
    "I built a concept homepage to show how your site could look and convert with a stronger offer, cleaner proof, and a better lead path.",
    "",
    "If you want the full build plus Twilio CRM automation, reply here and I can walk you through it.",
    "",
    "TieGui",
  ].join("\n");

  return `${tieGuiEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ProspectConceptPage({ prospect }: { prospect: Prospect }) {
  const themeStyle = {
    "--accent": prospect.theme.accent,
    "--accent-strong": prospect.theme.accentStrong,
    "--accent-soft": prospect.theme.accentSoft,
    "--proposal-surface": prospect.theme.surface,
    "--proposal-bg": prospect.theme.background,
    "--proposal-ink": prospect.theme.ink,
  } as CSSProperties;

  return (
    <main className="proposal-shell" style={themeStyle}>
      <div className="proposal-glow proposal-glow--one" aria-hidden="true" />
      <div className="proposal-glow proposal-glow--two" aria-hidden="true" />

      <div className="proposal-banner">
        <p>
          Concept built by TieGui for <strong>{prospect.company}</strong> using publicly visible
          brand and website material.
        </p>
        <div className="proposal-banner__links">
          <a href={prospect.currentSite} rel="noreferrer" target="_blank">
            Current site
          </a>
          <a href={tieGuiHref} rel="noreferrer" target="_blank">
            TieGui
          </a>
        </div>
      </div>

      <header className="proposal-topbar">
        <div className="proposal-brand">
          {prospect.logo ? (
            <Image
              alt={`${prospect.company} logo`}
              className="proposal-brand__logo"
              height={56}
              src={prospect.logo}
              unoptimized
              width={84}
            />
          ) : null}
          <div>
            <p className="section-kicker">Homepage concept</p>
            <strong>{prospect.company}</strong>
          </div>
        </div>

        <nav className="proposal-nav" aria-label="Proposal sections">
          <a href="#audit">Audit</a>
          <a href="#services">Services</a>
          <a href="#stack">TieGui stack</a>
        </nav>

        <a className="button button--primary button--small" href={makeMailto(prospect.company)}>
          Reply to TieGui
        </a>
      </header>

      <section className="proposal-hero">
        <div className="proposal-copy">
          <p className="section-kicker">{prospect.offerEyebrow}</p>
          <h1>{prospect.heroTitle}</h1>
          <p className="proposal-copy__lead">{prospect.heroBody}</p>

          <div className="proposal-actions">
            <a className="button button--primary" href="#audit">
              See what was fixed
            </a>
            <a className="button button--secondary" href="#stack">
              See the CRM layer
            </a>
          </div>

          <div className="proposal-proof-grid">
            {prospect.proof.map((item) => (
              <article className="proposal-proof-card" key={item.label}>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
                <span>{item.detail}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="proposal-hero__side">
          <div className="proposal-media-card">
            {prospect.gallery[0] ? (
              <Image
                alt={prospect.gallery[0].alt}
                className="proposal-media-card__image"
                fill
                sizes="(max-width: 1080px) 100vw, 42vw"
                src={prospect.gallery[0].src}
                unoptimized
              />
            ) : null}
            <div className="proposal-media-card__overlay" />
            <div className="proposal-media-card__content">
              <p className="section-kicker">Built for {prospect.location}</p>
              <strong>{prospect.segment}</strong>
            </div>
          </div>

          <aside className="proposal-audit-snapshot">
            <p className="section-kicker">Why this concept would convert better</p>
            <ul>
              {prospect.currentIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="proposal-section" id="audit">
        <div className="proposal-section__heading">
          <div>
            <p className="section-kicker">Website audit</p>
            <h2>What is holding the current site back</h2>
          </div>
          <p>{prospect.auditSummary}</p>
        </div>

        <div className="proposal-issue-grid">
          {prospect.currentIssues.map((issue, index) => (
            <article className="proposal-issue-card" key={issue}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{issue}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="proposal-section" id="services">
        <div className="proposal-section__heading">
          <div>
            <p className="section-kicker">Service architecture</p>
            <h2>A more focused homepage offer</h2>
          </div>
          <p>
            The concept site sharpens the message for search traffic and groups services into a
            cleaner structure that feels more premium and easier to trust.
          </p>
        </div>

        <div className="proposal-service-grid">
          {prospect.services.map((service) => (
            <article className="proposal-service-card" key={service.title}>
              <p className="section-kicker">{service.eyebrow}</p>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="proposal-section">
        <div className="proposal-section__heading">
          <div>
            <p className="section-kicker">Visual direction</p>
            <h2>Existing imagery used with stronger hierarchy</h2>
          </div>
          <p>
            The goal is not just prettier design. It is clearer proof, faster scanning, and a
            site that feels worth calling after a single screen.
          </p>
        </div>

        <div className="proposal-gallery-grid">
          {prospect.gallery.map((image) => (
            <figure className="proposal-gallery-card" key={image.src}>
              <Image
                alt={image.alt}
                fill
                sizes="(max-width: 1080px) 100vw, 33vw"
                src={image.src}
                unoptimized
              />
            </figure>
          ))}
        </div>
      </section>

      <section className="proposal-section" id="stack">
        <div className="proposal-section__heading">
          <div>
            <p className="section-kicker">TieGui stack</p>
            <h2>Website, lead intake, and Twilio CRM working together</h2>
          </div>
          <p>
            A stronger homepage helps the click convert. The CRM layer helps the lead get worked,
            followed up, and turned into revenue instead of sitting in a missed call or an inbox.
          </p>
        </div>

        <div className="proposal-stack-grid">
          {prospect.crmStack.map((item) => (
            <article className="proposal-stack-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>

        <div className="proposal-ads-card">
          <div>
            <p className="section-kicker">Google Ads fit</p>
            <h3>What changes specifically help paid traffic</h3>
          </div>

          <ul>
            {prospect.adFixes.map((fix) => (
              <li key={fix}>{fix}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="proposal-cta">
        <div>
          <p className="section-kicker">Implementation path</p>
          <h2>Next.js on Vercel with a cleaner sales path and a real follow-up system.</h2>
          <p>
            TieGui can take this from concept to production with landing pages, call and form
            tracking, missed-call text-back, estimate workflows, and review automation.
          </p>
        </div>

        <div className="proposal-actions">
          <a className="button button--primary" href={makeMailto(prospect.company)}>
            Reply about this concept
          </a>
          <a className="button button--secondary" href={prospect.currentSite} rel="noreferrer" target="_blank">
            Compare with current site
          </a>
        </div>
      </section>

      <footer className="proposal-footer">
        <p>
          Built in Next.js for outreach and deployed by <a href={tieGuiHref}>TieGui</a>.
        </p>
        <div>
          <Link href="/">Back to all 10 concepts</Link>
        </div>
      </footer>
    </main>
  );
}
