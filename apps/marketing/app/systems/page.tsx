import type { Metadata } from "next";
import { siteCopy } from "../../content/siteCopy";
import SiteFooter from "../_components/SiteFooter";
import SiteHeader from "../_components/SiteHeader";
import Card from "../_components/ui/Card";
import Hero from "../_components/ui/Hero";
import Section from "../_components/ui/Section";

const { systems } = siteCopy;

export const metadata: Metadata = {
  title: "Systems",
  description:
    "Website, automation, CRM pipeline, and tracking/reporting delivered as a connected infrastructure system with clear scope boundaries.",
};

export default function SystemsPage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <Hero
            eyebrow={systems.hero.eyebrow}
            title={systems.hero.title}
            subtitle={systems.hero.subtitle}
            primaryCta={systems.hero.primaryCta}
          />
        </Section>

        <Section id="pillars" variant="muted">
          <div className="section-head">
            <h2 className="tg-title">{systems.pillarsTitle}</h2>
            <p className="tg-muted">{systems.pillarsSubtitle}</p>
          </div>

          <div className="pillars-grid">
            {systems.pillars.map((pillar) => (
              <Card key={pillar.title}>
                <h3>{pillar.title}</h3>
                <p>{pillar.description}</p>
                <div className="pillar-columns">
                  <div>
                    <p className="pillar-heading">Included</p>
                    <ul>
                      {pillar.included.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="pillar-heading">Boundaries</p>
                    <ul>
                      {pillar.boundaries.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="offer">
          <div className="section-head">
            <h2 className="tg-title">{systems.offer.title}</h2>
            <p className="tg-muted">{systems.offer.subtitle}</p>
          </div>
          <div className="offer-grid">
            <Card>
              <p className="tg-eyebrow">{systems.offer.setup.label}</p>
              <p className="offer-price">{systems.offer.setup.price}</p>
              <ul>
                {systems.offer.setup.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
            <Card>
              <p className="tg-eyebrow">{systems.offer.monthly.label}</p>
              <p className="offer-price">{systems.offer.monthly.price}</p>
              <ul>
                {systems.offer.monthly.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
