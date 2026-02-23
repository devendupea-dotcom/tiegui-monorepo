import type { Metadata } from "next";
import { siteCopy } from "../../content/siteCopy";
import ContactForm from "../_components/ContactForm";
import SiteFooter from "../_components/SiteFooter";
import SiteHeader from "../_components/SiteHeader";
import ButtonLink from "../_components/ui/ButtonLink";
import Card from "../_components/ui/Card";
import Section from "../_components/ui/Section";

const { contact } = siteCopy;

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Book a strategy call with TieGui Solutions. Share your current systems bottlenecks and get a clear next-step recommendation.",
};

export default function ContactPage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <div className="section-head">
            <p className="tg-eyebrow">{contact.hero.eyebrow}</p>
            <h1 className="tg-display">{contact.hero.title}</h1>
            <p className="tg-lead">{contact.hero.subtitle}</p>
          </div>
        </Section>

        <Section variant="muted">
          <div className="contact-layout">
            <div className="contact-content">
              <Card>
                <h2>Who this is for</h2>
                <ul>
                  {contact.whoItsFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Card>

              <Card>
                <h2>What happens next</h2>
                <ol>
                  {contact.nextSteps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </Card>

              <Card>
                <h2>{contact.scheduling.label}</h2>
                <p>{contact.scheduling.note}</p>
                <ButtonLink href={contact.scheduling.href} label="Open Scheduling Placeholder" variant="secondary" />
              </Card>
            </div>

            <Card as="div" className="contact-form-card">
              <h2>Request a strategy call</h2>
              <ContactForm />
            </Card>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
