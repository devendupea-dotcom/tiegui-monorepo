import SiteHeader from "../_components/SiteHeader";
import Image from "next/image";

export default function CaseStudiesPage() {
  return (
    <div className="page">
      <SiteHeader />
      <section className="section example-section alt">
        <div className="container">
          <div className="section-head">
            <h1>Case Studies</h1>
            <p className="muted">Real examples of the system in action.</p>
          </div>
          <div className="example-card single">
            <div className="example-media">
              <div className="example-device example-desktop">
                <Image
                  src="/logo/PNW-demo.jpeg"
                  alt="PNW Landscaping desktop preview"
                  width={2166}
                  height={1182}
                  sizes="(max-width: 980px) 100vw, 60vw"
                />
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
}
