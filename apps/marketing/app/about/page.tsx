import SiteHeader from "../_components/SiteHeader";
import Image from "next/image";

export default function AboutPage() {
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
                  TieGui started after we had each spent nearly a decade in the real world, watching friends, family, and
                  local business owners spend money on websites and advertising that looked good on the surface — but
                  didn’t produce consistent calls or quote requests.
                </p>
                <p>We began building and testing our own sites, focusing on what actually matters:</p>
                <ul className="about-bullets">
                  <li>Fast load times</li>
                  <li>Clear service messaging</li>
                  <li>Mobile-first layouts</li>
                  <li>Simple paths to call or request a quote</li>
                </ul>
                <p>
                  As we refined the websites, one thing became obvious: A strong website performs best when paired with
                  well-structured Google Ads.
                </p>
                <p>That combination became the foundation of TieGui Solutions.</p>
              </div>
              <div className="origin-media">
                <Image
                  src="https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80"
                  alt="Workspace with laptop and planning notes"
                  width={1200}
                  height={800}
                  sizes="(max-width: 980px) 100vw, 40vw"
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
                  <Image
                    src="/logo/google-ads-certified.png"
                    alt="Google Ads Search Certified"
                    className="founder-cert"
                    width={400}
                    height={400}
                  />
                  <Image
                    src="/logo/google-analytics-certified.png"
                    alt="Google Analytics Certified"
                    className="founder-cert"
                    width={400}
                    height={400}
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
                    <path d="M4 4h16v16H4z" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 8h8v8H8z" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h3>Conversion-Focused Websites</h3>
                <p>Fast, mobile-first websites designed to turn visitors into calls and quote requests.</p>
              </div>
              <div className="about-card">
                <div className="about-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 12h16" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 4v16" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h3>Google Ads Setup &amp; Management</h3>
                <p>Certified Google Ads management focused on high-intent local keywords and clear tracking.</p>
              </div>
              <div className="about-card">
                <div className="about-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 7v6l4 2" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h3>Lead Capture &amp; Tracking</h3>
                <p>Forms, call tracking, and reporting so you know exactly what’s working.</p>
              </div>
              <div className="about-card">
                <div className="about-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h3>Ongoing Optimization</h3>
                <p>Continuous testing and refinement based on real data — not guesswork.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
