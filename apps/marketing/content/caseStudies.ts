export type CaseStudyImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export type CaseStudyTestimonial = {
  quote: string;
  name: string;
  role: string;
};

export type CaseStudy = {
  slug: string;
  title: string;
  industry: string;
  location: string;
  summary: string;
  beforeImages: CaseStudyImage[];
  afterImages: CaseStudyImage[];
  whatChanged: string[];
  systemsInstalled: string[];
  outcomes: string[];
  stack: string[];
  testimonial?: CaseStudyTestimonial;
};

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "pnw-landscaping-revenue-infrastructure",
    title: "PNW Landscaping: from brochure site to revenue infrastructure",
    industry: "Landscaping",
    location: "Tacoma, WA",
    summary:
      "Rebuilt site architecture, installed missed-call follow-up, and structured pipeline tracking to tighten lead handling.",
    beforeImages: [
      {
        src: "/images/case-studies/pnw-before.svg",
        alt: "Before implementation: outdated landscaping website and disconnected lead flow",
        width: 1440,
        height: 960,
      },
    ],
    afterImages: [
      {
        src: "/images/case-studies/pnw-after.svg",
        alt: "After implementation: conversion-focused layout and connected infrastructure",
        width: 1440,
        height: 960,
      },
    ],
    whatChanged: [
      "Reframed offer and service pages around booking intent",
      "Connected missed-call SMS capture and lead qualification",
      "Implemented pipeline visibility from inquiry to scheduled work",
      "Introduced source tracking and operator-ready reporting",
    ],
    systemsInstalled: [
      "Conversion website framework",
      "SMS follow-up automation",
      "CRM pipeline model",
      "Attribution and reporting scorecard",
    ],
    outcomes: [
      "Faster first-response workflow for inbound leads",
      "Clearer visibility of lead stage and ownership",
      "Improved confidence in source-to-revenue decisions",
    ],
    stack: ["Next.js", "Twilio", "Pipeline CRM", "GA4 events", "UTM routing"],
    testimonial: {
      quote:
        "TieGui gave us operating clarity. We stopped guessing where leads were getting lost and started running a tighter system.",
      name: "PNW Owner",
      role: "Founder",
    },
  },
];

export function getCaseStudyBySlug(slug: string): CaseStudy | undefined {
  return CASE_STUDIES.find((study) => study.slug === slug);
}

export function getFeaturedCaseStudies(limit = 3): CaseStudy[] {
  return CASE_STUDIES.slice(0, limit);
}
