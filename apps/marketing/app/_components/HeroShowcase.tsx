"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRIMARY_CTA_LABEL, SECONDARY_CTA_LABEL } from "../_content";

type HeroSlide = {
  id: string;
  label: string;
  urlLabel: string;
  content: React.ReactNode;
};

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function usePortalSlides() {
  return useMemo<HeroSlide[]>(
    () => [
      {
        id: "dashboard",
        label: "Today",
        urlLabel: "app.tieguisolutions.com/dashboard",
        content: <PortalPreviewDashboard />,
      },
      {
        id: "leads",
        label: "New Calls",
        urlLabel: "app.tieguisolutions.com/new-calls",
        content: <PortalPreviewLeads />,
      },
      {
        id: "scheduling",
        label: "Calendar + Jobs",
        urlLabel: "app.tieguisolutions.com/calendar",
        content: <PortalPreviewSchedulingJobs />,
      },
      {
        id: "performance",
        label: "Performance",
        urlLabel: "app.tieguisolutions.com/performance",
        content: <PortalPreviewPerformance />,
      },
    ],
    [],
  );
}

function ScreenWindow({
  urlLabel,
  children,
}: {
  urlLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hero-screen">
      <div className="hero-screen-bar">
        <span className="hero-screen-dot" />
        <span className="hero-screen-dot" />
        <span className="hero-screen-dot" />
        <div className="hero-screen-url">{urlLabel}</div>
      </div>
      <div className="hero-screen-body">{children}</div>
    </div>
  );
}

function PortalPreviewShell({
  active,
  children,
}: {
  active: "dashboard" | "leads" | "calendar" | "projects" | "performance";
  children: React.ReactNode;
}) {
  return (
    <div className="portal-shot">
      <aside className="portal-shot-side" aria-hidden="true">
        <div className="portal-shot-brand">
          <Image
            src="/logo/tiegui-tiger.png"
            alt=""
            width={1536}
            height={1024}
            className="portal-shot-mark"
          />
          <div className="portal-shot-brand-copy">
            <div className="portal-shot-name">TieGui</div>
            <div className="portal-shot-sub">Calls &amp; Jobs</div>
          </div>
        </div>
        <nav className="portal-shot-nav">
          <div className={`portal-shot-nav-item${active === "dashboard" ? " active" : ""}`}>
            Dashboard
          </div>
          <div className={`portal-shot-nav-item${active === "leads" ? " active" : ""}`}>
            New Calls
          </div>
          <div className={`portal-shot-nav-item${active === "calendar" ? " active" : ""}`}>
            Calendar
          </div>
          <div className={`portal-shot-nav-item${active === "projects" ? " active" : ""}`}>
            Projects
          </div>
          <div className={`portal-shot-nav-item${active === "performance" ? " active" : ""}`}>
            Performance
          </div>
          <div className="portal-shot-nav-item">Settings</div>
        </nav>
      </aside>
      <section className="portal-shot-main">{children}</section>
    </div>
  );
}

function PortalPreviewDashboard() {
  return (
    <PortalPreviewShell active="dashboard">
      <div className="portal-shot-top">
        <div>
          <div className="portal-shot-kicker">Dispatcher</div>
          <div className="portal-shot-title">Today</div>
          <div className="portal-shot-meta">TieGui Demo · America/Los_Angeles</div>
        </div>
        <div className="portal-shot-pill">Ad Scorecard</div>
      </div>
      <div className="portal-shot-grid">
        <div className="portal-shot-card">
          <div className="portal-shot-card-label">Unscheduled Calls</div>
          <div className="portal-shot-card-value">3</div>
          <div className="portal-shot-card-sub">Calls not yet booked.</div>
        </div>
        <div className="portal-shot-card">
          <div className="portal-shot-card-label">Today’s Schedule</div>
          <div className="portal-shot-card-value">5</div>
          <div className="portal-shot-card-sub">Jobs scheduled today.</div>
        </div>
        <div className="portal-shot-score">
          <div className="portal-shot-score-row">
            <div className="portal-shot-score-label">Ad Spend</div>
            <div className="portal-shot-score-value">$900</div>
          </div>
          <div className="portal-shot-score-row">
            <div className="portal-shot-score-label">Revenue</div>
            <div className="portal-shot-score-value">$2,450</div>
          </div>
          <div className="portal-shot-score-row">
            <div className="portal-shot-score-label">ROI</div>
            <div className="portal-shot-score-value">2.7×</div>
          </div>
          <div className="portal-shot-score-foot">Last updated moments ago</div>
        </div>
      </div>
      <div className="portal-shot-note">
        Next actions: call 2 leads • schedule 1 estimate • complete 1 job
      </div>
    </PortalPreviewShell>
  );
}

function PortalPreviewLeads() {
  return (
    <PortalPreviewShell active="leads">
      <div className="portal-shot-top">
        <div>
          <div className="portal-shot-kicker">Job Flow</div>
          <div className="portal-shot-title">New Calls</div>
          <div className="portal-shot-meta">Proof view + timeline + one-tap actions</div>
        </div>
        <div className="portal-shot-pill">Schedule</div>
      </div>
      <div className="portal-shot-list">
        {[
          { name: "Sam Contractor", status: "New", source: "Organic", time: "11:23 AM" },
          { name: "Jamie Homeowner", status: "Contacted", source: "Google Ads", time: "10:02 AM" },
          { name: "Mike Fence Repair", status: "Scheduled", source: "Referral", time: "Yesterday" },
        ].map((item) => (
          <div key={item.name} className="portal-shot-lead">
            <div className="portal-shot-lead-head">
              <div className="portal-shot-lead-name">{item.name}</div>
              <div className={`portal-shot-badge badge-${item.status.toLowerCase()}`}>{item.status}</div>
            </div>
            <div className="portal-shot-lead-sub">
              <span>{item.time}</span>
              <span className="portal-shot-source">{item.source}</span>
            </div>
            <div className="portal-shot-lead-actions">
              <div className="portal-shot-mini-btn solid">Call</div>
              <div className="portal-shot-mini-btn outline">Text</div>
              <div className="portal-shot-mini-btn ghost">Proof</div>
            </div>
          </div>
        ))}
      </div>
      <div className="portal-shot-note">Source + UTM are locked after creation for commission proof.</div>
    </PortalPreviewShell>
  );
}

function PortalPreviewPerformance() {
  return (
    <PortalPreviewShell active="performance">
      <div className="portal-shot-top">
        <div>
          <div className="portal-shot-kicker">Reports</div>
          <div className="portal-shot-title">Performance</div>
          <div className="portal-shot-meta">Leads • booked • revenue • ROI</div>
        </div>
        <div className="portal-shot-pill">Export</div>
      </div>
      <div className="portal-shot-grid perf">
        <div className="portal-shot-card">
          <div className="portal-shot-card-label">Leads</div>
          <div className="portal-shot-card-value">42</div>
          <div className="portal-shot-card-sub">Last 30 days</div>
        </div>
        <div className="portal-shot-card">
          <div className="portal-shot-card-label">Won</div>
          <div className="portal-shot-card-value">$18,900</div>
          <div className="portal-shot-card-sub">Revenue (won)</div>
        </div>
        <div className="portal-shot-card">
          <div className="portal-shot-card-label">ROI</div>
          <div className="portal-shot-card-value">3.2×</div>
          <div className="portal-shot-card-sub">Ad spend vs revenue</div>
        </div>
      </div>
      <div className="portal-shot-bars" aria-hidden="true">
        <div className="portal-shot-bar">
          <div className="portal-shot-bar-label">Google Ads</div>
          <div className="portal-shot-bar-track">
            <div className="portal-shot-bar-fill blue" style={{ width: "72%" }} />
          </div>
          <div className="portal-shot-bar-value">29</div>
        </div>
        <div className="portal-shot-bar">
          <div className="portal-shot-bar-label">Organic</div>
          <div className="portal-shot-bar-track">
            <div className="portal-shot-bar-fill green" style={{ width: "48%" }} />
          </div>
          <div className="portal-shot-bar-value">19</div>
        </div>
        <div className="portal-shot-bar">
          <div className="portal-shot-bar-label">Referral</div>
          <div className="portal-shot-bar-track">
            <div className="portal-shot-bar-fill purple" style={{ width: "28%" }} />
          </div>
          <div className="portal-shot-bar-value">11</div>
        </div>
      </div>
      <div className="portal-shot-note">Manual ad spend + job revenue = credible ROAS without API bloat.</div>
    </PortalPreviewShell>
  );
}

function PortalPreviewSchedulingJobs() {
  const hours = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM"] as const;

  return (
    <PortalPreviewShell active="calendar">
      <div className="portal-shot-top">
        <div>
          <div className="portal-shot-kicker">Scheduling</div>
          <div className="portal-shot-title">Calendar</div>
          <div className="portal-shot-meta">Tap a job → open the project folder (notes, photos, measurements).</div>
        </div>
        <div className="portal-shot-pill">Open project</div>
      </div>

      <div className="portal-shot-workspace" aria-hidden="true">
        <div className="portal-shot-calendar">
          <div className="portal-shot-calendar-bar">
            <div className="portal-shot-calendar-day">Saturday, Feb 7</div>
            <div className="portal-shot-calendar-meta">Day • All Staff</div>
          </div>
          <div className="portal-shot-calendar-grid">
            {hours.map((hour, idx) => (
              <div key={hour} className="portal-shot-calendar-row">
                <div className="portal-shot-calendar-hour">{hour}</div>
                <div className="portal-shot-calendar-slot">
                  {idx === 1 ? (
                    <div className="portal-shot-calendar-event selected">
                      <div className="portal-shot-calendar-event-time">9:00 AM</div>
                      <div className="portal-shot-calendar-event-title">Front yard cleanup</div>
                      <div className="portal-shot-calendar-event-sub">Work · High</div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="portal-shot-project">
          <div className="portal-shot-project-head">
            <div>
              <div className="portal-shot-project-kicker">Project Folder</div>
              <div className="portal-shot-project-title">Front yard cleanup</div>
              <div className="portal-shot-project-meta">Everything for the job — in one place.</div>
            </div>
            <div className="portal-shot-badge badge-scheduled">Scheduled</div>
          </div>

          <div className="portal-shot-project-tabs">
            <div className="portal-shot-tab active">Overview</div>
            <div className="portal-shot-tab">Notes</div>
            <div className="portal-shot-tab">Photos</div>
            <div className="portal-shot-tab">Measurements</div>
          </div>

          <div className="portal-shot-project-sections">
            <div className="portal-shot-project-section">
              <div className="portal-shot-project-section-title">Notes</div>
              <div className="portal-shot-project-card">Gate code: 2187 • Watch for sprinkler heads</div>
              <div className="portal-shot-project-card">Mulch refresh + edge beds + haul debris</div>
            </div>

            <div className="portal-shot-project-section">
              <div className="portal-shot-project-section-title">Photos</div>
              <div className="portal-shot-photo-grid">
                {["Before", "Before", "After"].map((label, idx) => (
                  <div key={`${label}-${idx}`} className="portal-shot-photo">
                    <div className="portal-shot-photo-label">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="portal-shot-project-section">
              <div className="portal-shot-project-section-title">Measurements</div>
              <div className="portal-shot-measure-list">
                <div className="portal-shot-measure-row">
                  <div>Mulch bed</div>
                  <div className="portal-shot-measure-value">18 ft</div>
                </div>
                <div className="portal-shot-measure-row">
                  <div>Sod patch</div>
                  <div className="portal-shot-measure-value">120 sq ft</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="portal-shot-note">
        Every scheduled job becomes a project folder — no lost photos, notes, or PDFs.
      </div>
    </PortalPreviewShell>
  );
}

export default function HeroShowcase() {
  const slides = usePortalSlides();

  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const lastTouchX = useRef<number | null>(null);

  const safeIndex = clampIndex(activeIndex, slides.length);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => clampIndex(prev + 1, slides.length));
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  const goPrev = () => setActiveIndex((prev) => clampIndex(prev - 1, slides.length));
  const goNext = () => setActiveIndex((prev) => clampIndex(prev + 1, slides.length));
  const goTo = (index: number) => setActiveIndex(clampIndex(index, slides.length));

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    lastTouchX.current = touchStartX.current;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchX.current = event.touches[0]?.clientX ?? lastTouchX.current;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current == null || lastTouchX.current == null) return;
    const delta = lastTouchX.current - touchStartX.current;
    touchStartX.current = null;
    lastTouchX.current = null;

    if (Math.abs(delta) < 40) return;
    if (delta < 0) goNext();
    else goPrev();
  };

  return (
    <div className="container hero-showcase">
      <div className="hero-showcase-grid">
        <div className="hero-left">
          <div className="hero-kicker">TieGui for contractors</div>
          <h1 className="hero-title">
            Stop Losing Jobs Because You Responded <span className="gold">Too Slow.</span>
          </h1>
          <p className="hero-sub">
            Missed calls get auto-replied in 60 seconds with real appointment times. Jobs book themselves. Your crew stays
            synced. You see what actually makes money.
          </p>

          <div className="hero-controls">
            <Link className="hero-cta cta-button gold" href="/contact">
              {PRIMARY_CTA_LABEL}
            </Link>
            <a className="cta-button-outline" href="#demo-video">
              {SECONDARY_CTA_LABEL}
            </a>
          </div>

          <div className="hero-dots" aria-label="Hero carousel navigation">
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                type="button"
                className={`hero-dot${idx === safeIndex ? " active" : ""}`}
                aria-label={`Show ${slide.label}`}
                aria-current={idx === safeIndex ? "true" : undefined}
                onClick={() => goTo(idx)}
              />
            ))}
          </div>
        </div>

        <div
          className="hero-right"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div
            className="hero-carousel"
            role="region"
            aria-label="Product screenshots"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div
              className="hero-carousel-track"
              style={{ transform: `translateX(-${safeIndex * 100}%)` }}
            >
              {slides.map((slide) => (
                <div key={slide.id} className="hero-carousel-slide">
                  <ScreenWindow urlLabel={slide.urlLabel}>{slide.content}</ScreenWindow>
                </div>
              ))}
            </div>

            <div className="hero-carousel-arrows">
              <button type="button" className="hero-carousel-arrow" onClick={goPrev} aria-label="Previous slide">
                ‹
              </button>
              <button type="button" className="hero-carousel-arrow" onClick={goNext} aria-label="Next slide">
                ›
              </button>
            </div>
          </div>
          <div className="hero-carousel-hint">Swipe on mobile • Hover to pause</div>
        </div>
      </div>
    </div>
  );
}

export function PortalDemoCarousel() {
  const slides = usePortalSlides();
  const [activeIndex, setActiveIndex] = useState(1);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const lastTouchX = useRef<number | null>(null);

  const safeIndex = clampIndex(activeIndex, slides.length);
  const active = slides[safeIndex] ?? slides[0]!;

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => clampIndex(prev + 1, slides.length));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  const goPrev = () => setActiveIndex((prev) => clampIndex(prev - 1, slides.length));
  const goNext = () => setActiveIndex((prev) => clampIndex(prev + 1, slides.length));
  const goTo = (index: number) => setActiveIndex(clampIndex(index, slides.length));

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    lastTouchX.current = touchStartX.current;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchX.current = event.touches[0]?.clientX ?? lastTouchX.current;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current == null || lastTouchX.current == null) return;
    const delta = lastTouchX.current - touchStartX.current;
    touchStartX.current = null;
    lastTouchX.current = null;

    if (Math.abs(delta) < 40) return;
    if (delta < 0) goNext();
    else goPrev();
  };

  const caption = (() => {
    switch (active.id) {
      case "leads":
        return "New Calls: one-tap call/text, proof view, and fast follow-up so leads don’t go cold.";
      case "scheduling":
        return "Calendar + Jobs: schedule without chaos, keep crews aligned, and prevent double-booking.";
      case "performance":
        return "Performance: track ad spend → calls → booked revenue so ROI is clear and disputes disappear.";
      case "dashboard":
      default:
        return "Today: see next actions, unscheduled calls, and what matters most at a glance.";
    }
  })();

  return (
    <div className="portal-demo">
      <div className="portal-demo-tabs" role="tablist" aria-label="Portal demo steps">
        {slides.map((slide, idx) => (
          <button
            key={slide.id}
            type="button"
            className={`portal-demo-tab${idx === safeIndex ? " active" : ""}`}
            role="tab"
            aria-selected={idx === safeIndex}
            aria-controls="portal-demo-panel"
            onClick={() => goTo(idx)}
          >
            {slide.label}
          </button>
        ))}
      </div>

      <div
        className="hero-carousel portal-demo-carousel"
        role="region"
        aria-label="Portal demo preview"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="hero-carousel-track" style={{ transform: `translateX(-${safeIndex * 100}%)` }}>
          {slides.map((slide) => (
            <div key={slide.id} className="hero-carousel-slide">
              <ScreenWindow urlLabel={slide.urlLabel}>{slide.content}</ScreenWindow>
            </div>
          ))}
        </div>

        <div className="hero-carousel-arrows">
          <button type="button" className="hero-carousel-arrow" onClick={goPrev} aria-label="Previous demo step">
            ‹
          </button>
          <button type="button" className="hero-carousel-arrow" onClick={goNext} aria-label="Next demo step">
            ›
          </button>
        </div>
      </div>

      <p className="portal-demo-caption" id="portal-demo-panel" role="tabpanel" aria-live="polite">
        {caption}
      </p>
    </div>
  );
}
