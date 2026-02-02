import SiteHeader from "../_components/SiteHeader";
import ContactForm from "../_components/ContactForm";

export default function ContactPage() {
  return (
    <div className="page">
      <SiteHeader />
      <section className="section contact-section alt" id="contact">
        <div className="container">
          <div className="section-head">
            <h1>Get More Calls</h1>
            <p className="muted">Tell us a bit about your business and we’ll recommend the best setup — no pressure.</p>
            <p className="muted contact-next">What happens next: we’ll review and follow up with a quick recommendation.</p>
          </div>
          <ContactForm />
        </div>
      </section>
    </div>
  );
}
