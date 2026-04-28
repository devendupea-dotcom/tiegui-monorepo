import type { Metadata } from "next";
import { siteCopy } from "../../content/siteCopy";
import SiteFooter from "../_components/SiteFooter";
import SiteHeader from "../_components/SiteHeader";
import Card from "../_components/ui/Card";
import Hero from "../_components/ui/Hero";
import Section from "../_components/ui/Section";

const { about } = siteCopy;

export const metadata: Metadata = {
  title: "About",
  description:
    "Founder-led execution for home service revenue infrastructure. Systems-first implementation with clear standards and measurable outcomes.",
};

export default function AboutPage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <Hero
            eyebrow={about.hero.eyebrow}
            title={about.hero.title}
            subtitle={about.hero.subtitle}
            primaryCta={about.hero.primaryCta}
          />
        </Section>

        <Section variant="muted">
          <div className="section-head">
            <h2 className="tg-title">{about.standards.title}</h2>
          </div>
          <Card as="div">
            <ul className="about-standards-list">
              {about.standards.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </Card>
        </Section>

        <Section>
          <div className="section-head">
            <h2 className="tg-title">{about.principles.title}</h2>
          </div>
          <div className="principles-grid">
            {about.principles.items.map((item) => (
              <Card key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </Card>
            ))}
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
