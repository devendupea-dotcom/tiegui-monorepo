import ButtonLink from "./ButtonLink";

type HeroProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  primaryCta: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
};

export default function Hero({ eyebrow, title, subtitle, primaryCta, secondaryCta }: HeroProps) {
  return (
    <div className="hero-block">
      {eyebrow ? <p className="tg-eyebrow">{eyebrow}</p> : null}
      <h1 className="tg-display">{title}</h1>
      <p className="tg-lead">{subtitle}</p>
      <div className="hero-actions">
        <ButtonLink href={primaryCta.href} label={primaryCta.label} variant="primary" />
        {secondaryCta ? <ButtonLink href={secondaryCta.href} label={secondaryCta.label} variant="secondary" /> : null}
      </div>
    </div>
  );
}
