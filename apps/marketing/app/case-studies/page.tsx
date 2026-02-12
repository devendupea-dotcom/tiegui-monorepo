import Image from "next/image";
import SiteHeader from "../_components/SiteHeader";
import SiteFooter from "../_components/SiteFooter";
import { BETA_CTA_LABEL } from "../_content";

export default function CaseStudiesPage() {
  return (
    <div className="page">
      <SiteHeader />

      <main>
        <section className="section example-section alt">
          <div className="container">
            <div className="section-head">
              <h1>Case Studies</h1>
              <p className="muted">
                Transparent portfolio examples. We show what is live, what is in beta, and what outcomes are still in
                progress.
              </p>
            </div>

            <article className="example-card single">
              <div className="example-media">
                <div className="example-device example-desktop">
                  <Image
                    src="/images/pnw-site-screenshot.png"
                    alt="PNW Landscaping and Construction website"
                    width={1600}
                    height={1000}
                    sizes="(max-width: 980px) 100vw, 60vw"
                  />
                </div>
                <p className="example-caption">Live portfolio: conversion-first service site built for local lead capture.</p>
              </div>
              <div className="example-body">
                <h2>PNW Landscaping &amp; Construction</h2>
                <p className="muted">Status: Live demo site and conversion architecture showcase.</p>
                <ul>
                  <li>Call-first page structure with clear mobile CTA hierarchy</li>
                  <li>Service-zone messaging tuned for local search intent</li>
                  <li>Built to connect with TieGui follow-up and scheduling workflows</li>
                </ul>
                <div className="example-actions">
                  <a className="cta-button gold" href="https://pnw-landscape-demo.web.app" target="_blank" rel="noreferrer">
                    View Live Site
                  </a>
                  <a className="cta-button-outline" href="/contact">
                    See If This Fits Your Business
                  </a>
                </div>
              </div>
            </article>

            <div className="example-flow beta-flow">
              <article className="flow-card">
                <h3>Beta case slot: Exterior contractor</h3>
                <p>Currently onboarding. Tracking baseline and offer positioning in progress.</p>
              </article>
              <article className="flow-card">
                <h3>Beta case slot: Home services operator</h3>
                <p>Website and follow-up flow being installed. Case notes will be published transparently.</p>
              </article>
              <article className="flow-card">
                <h3>Want to be a beta partner?</h3>
                <p>We reserve a limited number of builds each cycle for focused implementation.</p>
                <a className="cta-button-outline" href="/pricing">
                  {BETA_CTA_LABEL}
                </a>
              </article>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
