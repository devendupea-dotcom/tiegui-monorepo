import ButtonLink from "./ButtonLink";

type HeroProps = {
  eyebrow?: string;
  title: string;
  highlight?: string;
  subtitle: string;
  supportLine?: string;
  chips?: string[];
  showcase?: {
    eyebrow: string;
    title: string;
    subtitle: string;
    stack: Array<{
      title: string;
      detail: string;
    }>;
    stats: Array<{
      value: string;
      label: string;
    }>;
    note: string;
  };
  primaryCta: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
};

export default function Hero({
  eyebrow,
  title,
  highlight,
  subtitle,
  supportLine,
  chips,
  showcase,
  primaryCta,
  secondaryCta,
}: HeroProps) {
  return (
    <div className="hero-layout">
      <div className="hero-block">
        {eyebrow ? <p className="tg-eyebrow">{eyebrow}</p> : null}
        <h1 className="tg-display">
          {title} {highlight ? <span>{highlight}</span> : null}
        </h1>
        <p className="tg-lead">{subtitle}</p>
        {supportLine ? <p className="hero-support">{supportLine}</p> : null}
        <div className="hero-actions">
          <ButtonLink href={primaryCta.href} label={primaryCta.label} variant="primary" />
          {secondaryCta ? <ButtonLink href={secondaryCta.href} label={secondaryCta.label} variant="secondary" /> : null}
        </div>
        {chips?.length ? (
          <ul className="hero-chip-row" aria-label="TieGui workflow modules">
            {chips.map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {showcase ? (
        <aside className="hero-lead-card" aria-label="TieGui app preview">
          <div className="hero-lead-card__status">
            <span />
            {showcase.eyebrow}
          </div>

          <div className="hero-app-preview">
            <div className="hero-app-preview__top">
              <div>
                <p>{showcase.title}</p>
                <strong>PNW Landscaping</strong>
              </div>
              <span>Live</span>
            </div>
            <div className="hero-workflow-list">
              {showcase.stack.map((item) => (
                <article key={item.title}>
                  <span>{item.title}</span>
                  <strong>{item.detail}</strong>
                </article>
              ))}
            </div>

            <div className="hero-customer-view">
              <p>Customer sees</p>
              <div>
                <span>Estimate link</span>
                <span>Job updates</span>
                <span>Invoice link</span>
              </div>
            </div>
          </div>

          <div className="hero-stats" aria-label={showcase.subtitle}>
            {showcase.stats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>

          <p className="hero-lead-card__note">{showcase.note}</p>
        </aside>
      ) : null}
    </div>
  );
}
