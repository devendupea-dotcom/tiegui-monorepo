import type { Metadata } from "next";
import SiteFooter from "../_components/SiteFooter";
import SiteHeader from "../_components/SiteHeader";
import Section from "../_components/ui/Section";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for TieGui Solutions websites, CRM, scheduling, SMS, and automation services.",
};

export default function TermsPage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <div className="legal-page">
            <p className="tg-eyebrow">Last updated April 28, 2026</p>
            <h1 className="tg-display">Terms of Service</h1>
            <p className="tg-lead">
              These terms describe the baseline rules for using TieGui Solutions services. Customer
              contracts or statements of work may add more specific terms.
            </p>

            <section>
              <h2>Services</h2>
              <p>
                TieGui Solutions provides websites, CRM, lead intake, scheduling, messaging, workflow,
                reporting, and related implementation services for businesses.
              </p>
            </section>

            <section>
              <h2>Customer Responsibilities</h2>
              <p>
                Customers are responsible for giving accurate business information, maintaining lawful
                customer relationships, reviewing generated content before use where appropriate, and using
                the service only for lawful business purposes.
              </p>
            </section>

            <section>
              <h2>SMS And Messaging</h2>
              <p>
                Customers must obtain and keep proper consent before sending text messages. Consent must
                identify the sender, explain the type of messages, include message frequency, disclose that
                message and data rates may apply, and explain STOP and HELP options.
              </p>
              <p>
                Customers authorize TieGui Solutions to submit required texting registration information
                to Twilio, telecommunications carriers, The Campaign Registry, and related providers when
                they ask us to help enable business texting.
              </p>
              <p>
                Customers may not use TieGui services for spam, purchased lead lists, unlawful content,
                deceptive messages, harassment, evasion of carrier filtering, or messages sent after a
                recipient has opted out.
              </p>
              <p>
                TieGui&apos;s default SMS setup is for customer service, estimate scheduling, appointment
                reminders, job updates, and requested follow-up. Promotional campaigns require separate
                opt-in language and approval before use.
              </p>
            </section>

            <section>
              <h2>Third-Party Services</h2>
              <p>
                The service may rely on third-party providers such as Twilio, payment processors, email
                providers, hosting providers, analytics tools, or calendar providers. Those services may
                have their own terms, fees, approval processes, and retention rules.
              </p>
            </section>

            <section>
              <h2>Data Deletion</h2>
              <p>
                We provide ways to delete certain saved information we control. Some records may be kept
                when needed for legal compliance, security, dispute resolution, billing, backups, fraud
                prevention, or third-party carrier requirements.
              </p>
            </section>

            <section>
              <h2>Compliance Responsibility</h2>
              <p>
                TieGui Solutions provides compliance-minded defaults, consent records, opt-out handling,
                and carrier registration support. Customers remain responsible for using the service lawfully
                and truthfully for their business.
              </p>
            </section>

            <section>
              <h2>Contact</h2>
              <p>
                Questions about these terms can be sent through the contact form on this site or to the
                TieGui Solutions account contact you work with.
              </p>
            </section>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
