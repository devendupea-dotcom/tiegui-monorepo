export const TIEGUI_PRICING = {
  betaNotice: {
    title: "Beta Pricing Notice",
    description:
      "We are working with our first 5 Tacoma contractors at these 2026 beta rates. " +
      "Once these spots fill, pricing will increase. Beta spots are limited — reserve yours today.",
    spotsEnvKey: "BETA_SPOTS_REMAINING",
  },
  packages: [
    {
      name: "Foundation",
      oneTime: 1200,
      monthly: 0,
      recommendedAdSpend: null,
      features: [
        "Custom 5–7 page contractor website",
        "Mobile optimized + fast loading",
        "Lead capture forms + click-to-call",
        "SEO-ready structure",
        "1 round of consolidated revisions (submit all changes together)",
        "7–10 business day delivery",
      ],
      targetingLimit: null,
      commissionOption: null,
    },
    {
      name: "Growth",
      oneTime: 1500,
      monthly: 600,
      recommendedAdSpend: [500, 1000],
      features: [
        "Everything in Foundation",
        "Google Ads setup + ongoing management",
        "Conversion tracking installed",
        "Monthly performance reporting",
        "Targeting up to 3–5 zip codes or 25-mile radius",
        "60-Day Performance Commitment",
      ],
      targetingLimit: "3–5 primary zip codes or 25-mile radius",
      commissionOption: {
        monthly: 450,
        commissionRate: 0.05,
        rules:
          "Commission applies to booked jobs tracked in the TieGui portal " +
          "with lead source tagged TieGui – Ads and call/lead record present.",
      },
    },
    {
      name: "Command Center",
      oneTime: 2000,
      monthly: 900,
      recommendedAdSpend: [500, 1000],
      features: [
        "Everything in Growth",
        "Missed-call text-back system",
        "Contractor portal (lead tracking, dashboard, scorecard)",
        "Advanced automation + follow-up sequences",
        "Priority support",
      ],
      targetingLimit: "3–5 primary zip codes or 25-mile radius",
      commissionOption: {
        monthly: 650,
        commissionRate: 0.07,
        rules:
          "Commission applies to booked jobs tracked in the TieGui portal " +
          "with lead source tagged TieGui – Ads or TieGui – Missed-Call and " +
          "call/lead record present.",
      },
    },
  ],
  performanceCommitment: {
    title: "60-Day Performance Commitment",
    description:
      "If we don’t generate qualified leads by day 60, we will adjust the strategy " +
      "at no additional charge or you may cancel. Month-to-month after initial setup. No penalties.",
  },
};

export const PRICING_FAQ = [
  {
    q: "Do I need to sign a long-term contract?",
    a: "No long-term contracts. Month-to-month after initial setup.",
  },
  {
    q: "What if I already tried Google Ads and they didn’t work?",
    a: "Most fail due to lack of conversion tracking or inefficient bidding. We fix both + site conversion.",
  },
  {
    q: "How does the commission model work?",
    a: "Commission applies only to booked jobs that are logged and tracked in the TieGui portal with the correct lead source tag and call/lead record.",
  },
  {
    q: "What do I need to provide?",
    a: "Business info, 6–10 photos of work, services list, and a kickoff call. We handle the rest.",
  },
  {
    q: "How fast can we launch?",
    a: "Websites go live in 7–10 business days. Ads launch within 1–2 weeks after.",
  },
  {
    q: "What happens if I want to cancel?",
    a: "Let us know. No penalties. We will transfer your website to you.",
  },
];

export type TieGuiPricing = typeof TIEGUI_PRICING;
export type TieGuiPricingPackage = TieGuiPricing["packages"][number];
