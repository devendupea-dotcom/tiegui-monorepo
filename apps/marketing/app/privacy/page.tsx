import type { Metadata } from "next";
import SiteFooter from "../_components/SiteFooter";
import SiteHeader from "../_components/SiteHeader";
import Section from "../_components/ui/Section";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for TieGui Solutions, including SMS registration and customer communication data handling.",
};

export default function PrivacyPage() {
  return (
    <div className="tg-site">
      <SiteHeader />

      <main className="tg-main">
        <Section>
          <div className="legal-page">
            <p className="tg-eyebrow">Last updated April 28, 2026</p>
            <h1 className="tg-display">Privacy Policy</h1>
            <p className="tg-lead">
              TieGui Solutions collects only the information needed to provide websites, CRM, scheduling,
              messaging, and automation services for our customers.
            </p>

            <section>
              <h2>Information We Collect</h2>
              <p>
                We may collect business contact details, account information, lead and customer records,
                website form submissions, SMS consent records, communication history, billing records,
                support messages, and technical data needed to operate and secure the service.
              </p>
              <p>
                For SMS registration, we may collect business identity details, business address, authorized
                representative contact information, website links, opt-in descriptions, sample messages, and
                related approval information. We do not ask for Social Security numbers, EINs, or tax ID
                numbers in the TieGui app. If Twilio requires a tax ID, we handle that through Twilio&apos;s
                secure setup process or a direct setup call.
              </p>
            </section>

            <section>
              <h2>How We Use Information</h2>
              <p>
                We use information to run the TieGui platform, create and manage customer workspaces,
                route leads, send requested communications, support customer accounts, secure the service,
                troubleshoot delivery, meet legal and carrier requirements, and improve our systems.
              </p>
            </section>

            <section>
              <h2>SMS And Carrier Registration</h2>
              <p>
                If a customer asks us to help enable business texting, we may share required registration
                information with Twilio, telecommunications carriers, The Campaign Registry, and related
                vendors only as needed for SMS approval, delivery, compliance, and support.
              </p>
              <p>
                We do not sell mobile phone numbers or share mobile opt-in information with third parties
                for their marketing or promotional purposes.
              </p>
            </section>

            <section>
              <h2>Consent And Opt-Out Records</h2>
              <p>
                We may store proof that a person agreed to receive texts, including the consent language,
                page or form source, timestamp, lead record, and opt-out history. Replying STOP opts a
                recipient out of further SMS messages where supported.
              </p>
            </section>

            <section>
              <h2>Deletion Requests</h2>
              <p>
                Customers may ask us to delete personal information we control, subject to legal, security,
                billing, fraud prevention, backup, and carrier compliance retention needs. SMS registration
                data already submitted to Twilio, carriers, or The Campaign Registry may also be subject to
                their retention rules.
              </p>
            </section>

            <section>
              <h2>Security</h2>
              <p>
                We use access controls, encrypted secrets where appropriate, scoped credentials, audit
                practices, and operational safeguards to protect information. No system can be guaranteed
                completely secure, so we limit what we collect and retain where practical.
              </p>
            </section>

            <section>
              <h2>Contact</h2>
              <p>
                Privacy questions or deletion requests can be sent through the contact form on this site or
                to the TieGui Solutions account contact you work with.
              </p>
            </section>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
