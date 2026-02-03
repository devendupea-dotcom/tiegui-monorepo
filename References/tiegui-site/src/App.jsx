import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import PortalLogin from "./portal/PortalLogin.jsx";
import ClientPortalHome from "./portal/ClientPortalHome.jsx";
import ClientPortalView from "./portal/ClientPortalView.jsx";
import RequestAccess from "./portal/RequestAccess.jsx";
import ProtectedRoute from "./portal/ProtectedRoute.jsx";
import StaffRoute from "./portal/StaffRoute.jsx";
import AdminClients from "./portal/AdminClients.jsx";
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdU1uKG29pgU_zTR6JNxaLcE9yTBKw1emKfNpU349zy9RkEGQ/viewform";

const TRUST_POINTS = [
  "Conversion-first website build",
  "Local-intent Google Ads setup",
  "Call tracking installed",
  "Missed-call capture",
  "Lead routing",
  "Simple weekly reporting",
];

const HOW_IT_WORKS = [
  {
    title: "Build the Conversion Engine",
    desc: "Website + tracking + forms + call flow.",
  },
  {
    title: "Drive High-Intent Traffic",
    desc: "Google Ads + local targeting.",
  },
  {
    title: "Capture & Follow Up Automatically",
    desc: "Missed calls → text + lead routing.",
  },
];

const SYSTEM_STEPS = [
  {
    title: "Conversion Website",
    desc: "Call-focused layout and mobile-first structure that drives inquiries.",
  },
  {
    title: "Google Intent Traffic",
    desc: "Google Ads built around local intent and high‑value searches.",
  },
  {
    title: "Call & Lead Tracking",
    desc: "Tracking numbers and attribution so you know which calls convert.",
  },
  {
    title: "Missed-Call Capture",
    desc: "Automatic text follow-up so missed calls become booked jobs.",
  },
  {
    title: "Lead Routing",
    desc: "Routes each lead to the right person for a fast response.",
  },
  {
    title: "Weekly Reporting",
    desc: "Simple weekly updates on calls, sources, and performance.",
  },
];

const SMS_EXAMPLE = {
  trigger: "Triggered by missed call",
  title: "See the SMS Agent in Action",
  subtitle:
    "When a lead calls and you miss it, the agent texts back in seconds, asks the right questions, and books the estimate — automatically.",
  messages: [
    { from: "agent", text: "Hey — this is TieGui’s assistant for {BusinessName}. Sorry we missed your call. What project are you looking to get done?" },
    { from: "customer", text: "Need a quote. My fence is leaning and a section is broken." },
    { from: "agent", text: "Got it. What city are you in — and can you text a quick photo of the damage?" },
    { from: "customer", text: "Tacoma. [photo]" },
    { from: "agent", text: "Thanks. About how many feet is the damaged section, and is it wood or chain link?" },
    { from: "customer", text: "Wood. Maybe 10–12 feet." },
    { from: "agent", text: "Perfect. We can get you on the schedule. What works better: Tomorrow 3–5pm or Wednesday 10am–12pm?" },
    { from: "customer", text: "Tomorrow 3–5." },
    { from: "agent", text: "Locked in ✅ What’s the best name and the address for the estimate?" },
    { from: "customer", text: "Mike. 1234 S Pine St, Tacoma." },
    { from: "agent", text: "Awesome — you’re confirmed for tomorrow 3–5pm. If anything changes, reply here and we’ll adjust." },
  ],
  notification: {
    title: "New Lead Booked ✅",
    details: [
      "Fence repair • Tacoma • 10–12 ft wood fence • Photo received",
      "Scheduled: Tomorrow 3–5pm • Mike • 1234 S Pine St",
    ],
  },
  trustLine: "No spam. No robo-scripts. Just fast follow-up that turns missed calls into booked jobs.",
};

const FAQS = [
  {
    q: "How fast can we launch?",
    a: "Typical launches happen in weeks, not months.",
  },
  {
    q: "Do you run the ads too?",
    a: "Yes. Google Ads is built into the system.",
  },
  {
    q: "Can I keep my phone number?",
    a: "Yes. We route calls without changing your number.",
  },
  {
    q: "What if I already have a website?",
    a: "We can rebuild or optimize depending on performance.",
  },
  {
    q: "Do you work in my city/state?",
    a: "We work with contractors across the U.S.",
  },
  {
    q: "What does a “lead system” mean?",
    a: "Website + ads + tracking that turns interest into calls.",
  },
];

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "Examples", href: "/examples" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
];

const CTA_LABEL = "Get More Calls";

const SiteHeader = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("modal-open", mobileMenuOpen);
    if (!mobileMenuOpen) return undefined;
    const handleKeydown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [mobileMenuOpen]);

  return (
    <header className="nav hero-nav navbar">
      <div className="container nav-inner">
        <div className="brand">
          <img
            src="/logo/tiegui-mark.png"
            alt="TieGui Solutions"
            className="brand-logo"
          />
          <span className="brand-name">TieGui</span>
        </div>
        <div className="brand-center">TieGui</div>
        <nav className="links">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>{link.label}</a>
          ))}
        </nav>
        <a className="btn primary nav-cta" href="/contact">
          {CTA_LABEL}
        </a>
        <button
          className="nav-toggle"
          type="button"
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((prev) => !prev)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <button
        className={`drawer-backdrop${mobileMenuOpen ? " open" : ""}`}
        type="button"
        aria-label="Close menu"
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside className={`mobile-drawer${mobileMenuOpen ? " open" : ""}`} aria-hidden={!mobileMenuOpen}>
        <div className="drawer-header">
          <div className="drawer-title">Menu</div>
          <button className="drawer-close" type="button" onClick={() => setMobileMenuOpen(false)}>
            ×
          </button>
        </div>
        <nav className="drawer-links">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className="btn primary drawer-cta" href="/contact">
          {CTA_LABEL}
        </a>
      </aside>
    </header>
  );
};

const ContactForm = ({ onSubmit }) => (
  <form className="contact-form" onSubmit={onSubmit}>
    <label>
      Name
      <input type="text" name="name" placeholder="Your name" required />
    </label>
    <label>
      Phone number
      <input type="tel" name="phone" placeholder="(555) 555-5555" required />
    </label>
    <label>
      Business type
      <select name="type">
        <option value="">Select</option>
        <option>Contractor</option>
        <option>Landscaping</option>
        <option>Other local service</option>
      </select>
    </label>
    <label className="field-message">
      Message (optional)
      <textarea name="message" rows="3" placeholder="Tell us a bit about your goals" />
    </label>
    <button className="btn primary" type="submit">
      {CTA_LABEL}
    </button>
    <p className="cta-note">We’ll reach out quickly.</p>
    <p className="form-status" aria-live="polite"></p>
  </form>
);

const AboutPage = () => {
  return (
    <div className="page">
      <SiteHeader />

      <main>
      <section className="section about-hero">
        <div className="container">
          <p className="about-eyebrow">Websites + Google Ads for local service businesses</p>
          <h1>Built by operators focused on real leads — not vanity metrics.</h1>
          <p className="about-subhead">
            Founded by longtime friends and former college roommates, TieGui Solutions was built to solve a problem we
            saw everywhere: local businesses paying for websites and ads that didn’t produce calls. Our solution
            combines conversion-focused websites with Google Ads that generate real inquiries.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>How TieGui started</h2>
          <div className="origin-grid">
            <div className="about-text">
              <p>
                TieGui started after we had each spent nearly a decade in the real world, watching friends, family,
                and local business owners spend money on websites and advertising that looked good on the surface
                — but didn’t produce consistent calls or quote requests.
              </p>
              <p>We began building and testing our own sites, focusing on what actually matters:</p>
              <ul className="about-bullets">
                <li>Fast load times</li>
                <li>Clear service messaging</li>
                <li>Mobile-first layouts</li>
                <li>Simple paths to call or request a quote</li>
              </ul>
              <p>
                As we refined the websites, one thing became obvious: A strong website performs best when paired
                with well-structured Google Ads.
              </p>
              <p>That combination became the foundation of TieGui Solutions.</p>
            </div>
            <div className="origin-media">
              <img
                src="https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80"
                alt="Workspace with laptop and planning notes"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Two founders. One focus: more calls.</h2>
          <div className="founder-grid">
            <article className="founder-card">
              <div className="founder-head">
                <div className="founder-avatar">D</div>
              </div>
              <h3>Deven Dupea</h3>
              <p className="founder-title">Co-Founder • Web Systems &amp; Optimization</p>
              <p>
                Builds conversion-focused websites and AI agent workflows that help local service teams respond faster
                and stay organized. Oversees structure, UX, performance, and tracking so every visit has a clear next
                step.
              </p>
              <ul className="about-bullets">
                <li>AI-assisted lead follow-up</li>
                <li>Conversion-focused UX</li>
                <li>Performance + tracking</li>
              </ul>
            </article>
            <article className="founder-card">
              <div className="founder-head">
                <div className="founder-avatar">MJ</div>
              </div>
              <h3>Marcus Johnson</h3>
              <div className="founder-certs">
                <img
                  src="/logo/google-ads-certified.png"
                  alt="Google Ads Search Certified"
                  className="founder-cert"
                />
                <img
                  src="/logo/google-analytics-certified.png"
                  alt="Google Analytics Certified"
                  className="founder-cert"
                />
              </div>
              <p className="founder-title">Co-Founder • Google Ads Strategy</p>
              <p className="founder-meta">Google Ads Certified • Google Analytics Certified • Former College Athlete</p>
              <p>
                Leads Google Ads strategy and campaign optimization for local service businesses. Focuses on high-intent
                search, call-first structure, and disciplined testing to improve results.
              </p>
              <ul className="about-bullets">
                <li>High-intent local search campaigns</li>
                <li>Call-focused ad structures</li>
                <li>Budget efficiency and continuous optimization</li>
              </ul>
              <p className="founder-note">We treat ad spend like it’s our own.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>What we help businesses with</h2>
          <div className="about-grid">
            <div className="about-card">
              <div className="about-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 5h16v10H4zM7 19h10" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <h3>Conversion-Focused Websites</h3>
              <p>Fast, mobile-first websites designed to turn visitors into calls, quote requests, and booked jobs.</p>
            </div>
            <div className="about-card">
              <div className="about-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M3 12h18M12 3l3 3-3 3-3-3 3-3z" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <h3>Google Ads Setup &amp; Management</h3>
              <p>Certified Google Ads management focused on high-intent local keywords, call extensions, and clear tracking.</p>
            </div>
            <div className="about-card">
              <div className="about-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 7h16v10H4zM7 11h4M7 15h8" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <h3>Lead Capture &amp; Tracking</h3>
              <p>Forms, call tracking, and reporting so you know exactly what’s working.</p>
            </div>
            <div className="about-card">
              <div className="about-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 12a8 8 0 1 0 8-8M4 12h6V6" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <h3>Ongoing Optimization</h3>
              <p>Continuous testing and refinement based on real data — not guesswork.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div>
            <h2>Why websites + Google Ads together</h2>
            <p>
              A website alone doesn’t guarantee traffic. Ads alone don’t work if the site doesn’t convert.
              We focus on both so you get consistent calls instead of wasted spend.
            </p>
          </div>
          <div>
            <div className="ads-diagram">
              <div className="diagram-box">Google Ads</div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-box">Conversion Website</div>
              <div className="diagram-caption">More calls &amp; quote requests</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Who we work best with</h2>
          <div className="fit-grid">
            <div className="fit-card">
              <h3>We’re a great fit if you:</h3>
              <ul className="about-bullets">
                <li>Run a local service business (landscaping, construction, trades, home services)</li>
                <li>Want more phone calls and quote requests</li>
                <li>Care about performance over buzzwords</li>
                <li>Value honest communication</li>
              </ul>
            </div>
            <div className="fit-card">
              <h3>We may not be the best fit if:</h3>
              <ul className="about-bullets">
                <li>You’re only looking for the cheapest option</li>
                <li>You want instant results without testing</li>
                <li>You don’t plan to follow up on leads</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section about-cta">
        <div className="container">
          <h2>Want to see if this makes sense for your business?</h2>
          <p className="about-text">
            We offer a free, no-pressure consultation where we’ll review your current website or Google Ads and
            show you what we’d improve first. Even if we don’t work together, you’ll leave with clarity.
          </p>
          <p className="cta-note">15-minute call • No obligation • Honest feedback</p>
        </div>
      </section>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-trust">Websites & lead systems for local service businesses.</div>
          <div>(c) {new Date().getFullYear()} Tiegui Solutions</div>
        </div>
            </footer>
    </main>
  </div>
  );
};

const HomePage = () => (
  <div className="page">
    <SiteHeader />
    <main className="hero" id="top">
      <div className="hero-watermark-glow"></div>
      <img className="hero-watermark" src="/logo/tiegui-tiger.png" alt="" />
      <div className="hero-content">
        <h1 className="hero-title">
          Make your website a <span className="gold">revenue engine.</span>
        </h1>
        <p className="hero-sub">We build websites that get contractors paid.</p>
        <a className="hero-cta" href="/contact">
          {CTA_LABEL}
        </a>
      </div>
    </main>

    <section className="trust-strip">
      <div className="container trust-inner">
        {TRUST_POINTS.map((item) => (
          <div key={item} className="trust-item">
            <span className="trust-dot" aria-hidden="true" />
            {item}
          </div>
        ))}
      </div>
    </section>

    <section className="section how-section alt">
      <div className="container">
        <div className="section-head">
          <h2>How we help contractors grow</h2>
          <p className="muted">A simple system that turns traffic into booked jobs.</p>
        </div>
        <div className="how-grid">
          {HOW_IT_WORKS.map((step) => (
            <div className="how-card" key={step.title}>
              <div className="how-title">{step.title}</div>
              <p className="how-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section className="section proof-section">
      <div className="container">
        <div className="section-head">
          <h2>Why contractors work with us</h2>
          <p className="muted">Focused on calls, not vanity metrics.</p>
        </div>
        <ul className="proof-list">
          <li>Operator-led systems built for local service businesses</li>
          <li>Clear tracking so you know which calls make you money</li>
          <li>Automation that saves time and keeps leads moving</li>
        </ul>
      </div>
    </section>

    <section className="section sms-section alt">
      <div className="container sms-grid">
        <div className="sms-copy">
          <div className="sms-chip">{SMS_EXAMPLE.trigger}</div>
          <h2>{SMS_EXAMPLE.title}</h2>
          <p className="muted">{SMS_EXAMPLE.subtitle}</p>
          <p className="sms-trust">{SMS_EXAMPLE.trustLine}</p>
          <a className="btn primary" href="/contact">See if this fits your business</a>
        </div>
        <div className="sms-chat">
          <div className="sms-card">
            {SMS_EXAMPLE.messages.map((msg, idx) => (
              <div key={idx} className={`sms-bubble ${msg.from}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="sms-notice">
            <div className="sms-notice-title">{SMS_EXAMPLE.notification.title}</div>
            {SMS_EXAMPLE.notification.details.map((line) => (
              <div key={line} className="sms-notice-line">{line}</div>
            ))}
          </div>
        </div>
      </div>
    </section>

    <section className="section final-cta">
      <div className="container">
        <h2>Ready to get more calls?</h2>
        <p className="muted">Book a quick call and we’ll map the right system for your business.</p>
        <a className="btn primary" href="/contact">{CTA_LABEL}</a>
      </div>
    </section>

    <section className="section faq-section" id="faq">
      <div className="container">
        <div className="section-head">
          <h2>FAQ</h2>
          <p className="muted">Quick answers before we talk.</p>
        </div>
        <div className="faq-grid">
          {FAQS.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>

    <footer className="footer" id="site-footer">
      <div className="container footer-inner">
        <div className="footer-trust">Websites &amp; lead systems for local service businesses.</div>
        <div>(c) {new Date().getFullYear()} Tiegui Solutions</div>
      </div>
    </footer>
  </div>
);

const HowItWorksPage = () => (
  <div className="page">
    <SiteHeader />
    <section className="section">
      <div className="container">
        <div className="section-head">
          <h1>How It Works</h1>
          <p className="muted">A step-by-step system installed to generate calls.</p>
        </div>
        <div className="engine-grid">
          {SYSTEM_STEPS.map((item) => (
            <div className="engine-card" key={item.title}>
              <div className="engine-title">{item.title}</div>
              <p className="engine-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
    <section className="section final-cta">
      <div className="container">
        <h2>Let’s see if we’re a fit</h2>
        <p className="muted">We’ll review your current setup and recommend next steps.</p>
        <a className="btn primary" href="/contact">{CTA_LABEL}</a>
      </div>
    </section>
  </div>
);

const ExamplesPage = () => (
  <div className="page">
    <SiteHeader />
    <section className="section example-section alt">
      <div className="container">
        <div className="section-head">
          <h1>Examples</h1>
          <p className="muted">Sample scenarios that show how the system works.</p>
        </div>
        <div className="example-card single">
          <div className="example-media">
            <div className="example-device example-desktop">
              <img src="/logo/PNW-demo.jpeg" alt="PNW Landscaping desktop preview" />
            </div>
            <p className="example-caption">System example: homepage + call-first layout.</p>
          </div>
          <div className="example-body">
            <h3>PNW Landscaping &amp; Construction</h3>
            <ul>
              <li>Built to generate calls</li>
              <li>Mobile-first conversion layout</li>
              <li>Tracking + missed-call capture</li>
              <li>Designed for local Google traffic</li>
            </ul>
            <div className="example-actions">
              <a className="btn primary small" href="https://pnw-landscape-demo.web.app/" target="_blank" rel="noreferrer">
                View Live Site
              </a>
            </div>
          </div>
        </div>
        <div className="example-flow">
          <div className="flow-card">Before: missed calls and untracked leads.</div>
          <div className="flow-card">After: calls tracked, follow-up automated, appointments booked.</div>
          <div className="flow-card">Result: higher-quality leads and better close rates.</div>
        </div>
      </div>
    </section>
  </div>
);

const FAQPage = () => (
  <div className="page">
    <SiteHeader />
    <section className="section faq-section">
      <div className="container">
        <div className="section-head">
          <h1>FAQ</h1>
          <p className="muted">Quick answers before we talk.</p>
        </div>
        <div className="faq-grid">
          {FAQS.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  </div>
);

const ContactPage = () => {
  const handleSubmit = (event) => {
    event.preventDefault();
    if (window.gtag) window.gtag("event", "form_submit", { form: "contact" });
    event.currentTarget.reset();
    const status = event.currentTarget.querySelector(".form-status");
    if (status) status.textContent = "Thanks — we’ll reach out shortly.";
  };

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
          <ContactForm onSubmit={handleSubmit} />
        </div>
      </section>
    </div>
  );
};
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/how-it-works" element={<HowItWorksPage />} />
      <Route path="/examples" element={<ExamplesPage />} />
      <Route path="/faq" element={<FAQPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/login" element={<PortalLogin />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/request-access" element={<RequestAccess />} />
      <Route
        path="/portal"
        element={(
          <ProtectedRoute>
            <ClientPortalHome />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/portal/:clientId"
        element={(
          <ProtectedRoute>
            <ClientPortalView />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin"
        element={(
          <StaffRoute>
            <AdminClients />
          </StaffRoute>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
