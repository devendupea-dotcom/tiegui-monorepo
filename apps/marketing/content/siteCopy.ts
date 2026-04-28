export type CopyVariant = "contractorFirst" | "founderPremium";

type LinkItem = {
  label: string;
  href: string;
};

type CtaItem = LinkItem;

type FaqItem = {
  question: string;
  answer: string;
};

type BuildCard = {
  title: string;
  description: string;
  bullets: string[];
};

type ProcessStep = {
  title: string;
  description: string;
};

type SystemPillar = {
  title: string;
  description: string;
  included: string[];
  boundaries: string[];
};

export type SiteCopy = {
  seo: {
    siteName: string;
    defaultTitle: string;
    titleTemplate: string;
    description: string;
    openGraphDescription: string;
  };
  brand: {
    name: string;
    markAlt: string;
    tagline: string;
    location: string;
  };
  nav: {
    links: LinkItem[];
    primaryCta: CtaItem;
  };
  home: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
      primaryCta: CtaItem;
      secondaryCta: CtaItem;
    };
    proofRow: {
      title: string;
      bullets: string[];
    };
    problem: {
      title: string;
      statement: string;
      details: string[];
    };
    build: {
      title: string;
      subtitle: string;
      cards: BuildCard[];
    };
    process: {
      title: string;
      steps: ProcessStep[];
    };
    caseStudyPreview: {
      title: string;
      subtitle: string;
      cta: CtaItem;
    };
    offer: {
      title: string;
      subtitle: string;
      setup: {
        label: string;
        price: string;
        bullets: string[];
      };
      monthly: {
        label: string;
        price: string;
        bullets: string[];
      };
      note: string;
    };
    faq: {
      title: string;
      items: FaqItem[];
    };
    finalCta: {
      title: string;
      subtitle: string;
      primaryCta: CtaItem;
      secondaryCta: CtaItem;
    };
  };
  about: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
      primaryCta: CtaItem;
    };
    standards: {
      title: string;
      bullets: string[];
    };
    principles: {
      title: string;
      items: Array<{
        title: string;
        description: string;
      }>;
    };
  };
  systems: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
      primaryCta: CtaItem;
    };
    pillarsTitle: string;
    pillarsSubtitle: string;
    pillars: SystemPillar[];
    offer: {
      title: string;
      subtitle: string;
      setup: {
        label: string;
        price: string;
        bullets: string[];
      };
      monthly: {
        label: string;
        price: string;
        bullets: string[];
      };
    };
  };
  caseStudies: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
    };
    finalCta: {
      title: string;
      subtitle: string;
      cta: CtaItem;
    };
  };
  contact: {
    hero: {
      eyebrow: string;
      title: string;
      subtitle: string;
    };
    whoItsFor: string[];
    nextSteps: string[];
    scheduling: {
      label: string;
      href: string;
      note: string;
    };
    form: {
      nameLabel: string;
      emailLabel: string;
      phoneLabel: string;
      companyLabel: string;
      challengeLabel: string;
      submitLabel: string;
      successMessage: string;
    };
  };
  footer: {
    tagline: string;
    links: LinkItem[];
    copyright: string;
  };
};

const founderPremiumCopy: SiteCopy = {
  seo: {
    siteName: "TieGui Solutions",
    defaultTitle: "TieGui Solutions | Revenue Infrastructure for Home Service Businesses",
    titleTemplate: "%s | TieGui Solutions",
    description:
      "Revenue Infrastructure for Home Service Businesses: website, automation, CRM pipeline, tracking, and reporting for predictable booked jobs.",
    openGraphDescription:
      "TieGui builds connected revenue infrastructure for serious home service operators. Clear systems, tight execution, measurable booked jobs.",
  },
  brand: {
    name: "TieGui Solutions",
    markAlt: "TieGui Solutions mark",
    tagline: "Revenue Infrastructure for Home Service Businesses",
    location: "Tacoma, WA",
  },
  nav: {
    links: [
      { label: "About", href: "/about" },
      { label: "Systems", href: "/systems" },
      { label: "Case Studies", href: "/case-studies" },
      { label: "Contact", href: "/contact" },
    ],
    primaryCta: { label: "Book Strategy Call", href: "/contact" },
  },
  home: {
    hero: {
      eyebrow: "Revenue Infrastructure",
      title: "Predictable booked jobs start with connected systems.",
      subtitle:
        "TieGui installs the full stack: conversion website, missed-call automation, CRM pipeline, and reporting tied to revenue. Built for serious home service operators.",
      primaryCta: { label: "Book Strategy Call", href: "/contact" },
      secondaryCta: { label: "View Systems", href: "/systems" },
    },
    proofRow: {
      title: "Operational proof",
      bullets: [
        "Fast-response workflows for inbound leads",
        "Missed-call capture with instant SMS follow-up",
        "Pipeline visibility from first call to closed job",
        "Attribution mapped to booked revenue, not vanity metrics",
        "Founder-led implementation with clear scope",
      ],
    },
    problem: {
      title: "Contractors do not have a lead problem. They have a systems problem.",
      statement:
        "Most businesses already have demand. Revenue leaks happen between first contact and follow-up, between scheduling and handoff, and between spend and reporting.",
      details: [
        "Slow response windows kill intent.",
        "Disconnected tools create handoff failure.",
        "No source-to-revenue visibility makes spend decisions weak.",
      ],
    },
    build: {
      title: "What We Build",
      subtitle: "A connected revenue infrastructure stack, engineered to run in the real world.",
      cards: [
        {
          title: "Conversion Website",
          description: "A high-trust front end designed to drive qualified calls and form submissions.",
          bullets: ["Mobile-first UX", "Offer clarity", "Service-area architecture"],
        },
        {
          title: "Automation + SMS",
          description: "Immediate follow-up infrastructure for missed calls and inbound leads.",
          bullets: ["Missed-call text back", "Lead qualification prompts", "Handoff alerts"],
        },
        {
          title: "CRM + Pipeline",
          description: "A practical pipeline view so sales and operations can move without chaos.",
          bullets: ["Lead stages", "Ownership clarity", "Job-status discipline"],
        },
        {
          title: "Tracking + Reporting",
          description: "Source-level tracking and scorecards tied to booked revenue outcomes.",
          bullets: ["Channel attribution", "Booked-job reporting", "Weekly operator view"],
        },
      ],
    },
    process: {
      title: "How It Works",
      steps: [
        {
          title: "Audit",
          description: "Map your current lead flow, bottlenecks, and reporting blind spots.",
        },
        {
          title: "Build",
          description: "Install website, automation, CRM structure, and tracking with clear scope boundaries.",
        },
        {
          title: "Optimize",
          description: "Refine around conversion speed, lead quality, and revenue outcomes.",
        },
      ],
    },
    caseStudyPreview: {
      title: "Case Study Preview",
      subtitle: "Before and after transformations from live implementation work.",
      cta: { label: "View All Case Studies", href: "/case-studies" },
    },
    offer: {
      title: "Offer Structure",
      subtitle: "Infrastructure engagement, not a marketing package.",
      setup: {
        label: "Setup",
        price: "Starting at $3,500",
        bullets: [
          "System architecture + implementation",
          "Website build and conversion routing",
          "Automation, pipeline, and tracking deployment",
        ],
      },
      monthly: {
        label: "Monthly System Management",
        price: "Starting at $1,250/mo",
        bullets: [
          "Operational optimization",
          "Reporting and decision support",
          "Iteration on funnel and follow-up performance",
        ],
      },
      note: "Final scope and pricing are set after strategy audit based on complexity and service footprint.",
    },
    faq: {
      title: "FAQ",
      items: [
        {
          question: "How much does this cost?",
          answer: "Most operators start with setup plus monthly system management. Final pricing depends on scope and complexity.",
        },
        {
          question: "How long does implementation take?",
          answer: "Typical deployment is 3 to 6 weeks depending on asset readiness and workflow complexity.",
        },
        {
          question: "Do you need access to my ad accounts and tools?",
          answer: "Yes. Access is required to connect tracking, automation, and reporting with clean ownership controls.",
        },
        {
          question: "Who owns the assets after launch?",
          answer: "You own your domains, ad accounts, and operational data. TieGui manages implementation and optimization.",
        },
        {
          question: "What happens after launch?",
          answer: "We move into monthly system management: reporting, optimization, and continuous infrastructure tuning.",
        },
      ],
    },
    finalCta: {
      title: "Build revenue infrastructure that scales with your operation.",
      subtitle: "If you are ready for clear systems and measurable outcomes, book a strategy call.",
      primaryCta: { label: "Book Strategy Call", href: "/contact" },
      secondaryCta: { label: "View Systems", href: "/systems" },
    },
  },
  about: {
    hero: {
      eyebrow: "Founder-Led",
      title: "Builder standards. Operator execution.",
      subtitle:
        "TieGui is led by Deven Dupea. The focus is disciplined infrastructure for home service businesses that need real operating leverage, not agency theater.",
      primaryCta: { label: "Book Strategy Call", href: "/contact" },
    },
    standards: {
      title: "Operating standards",
      bullets: [
        "Every deliverable is tied to a defined business outcome.",
        "Scope boundaries are explicit before build begins.",
        "Data ownership and account control remain with the client.",
        "Reporting is revenue-aligned and reviewed on cadence.",
      ],
    },
    principles: {
      title: "How we execute",
      items: [
        {
          title: "Systems over hacks",
          description: "Short-term wins matter, but the architecture must hold as volume scales.",
        },
        {
          title: "Clarity over noise",
          description: "Simple, enforceable workflows beat bloated tooling every time.",
        },
        {
          title: "Accountability by data",
          description: "Decisions are made from source-to-revenue visibility, not assumptions.",
        },
      ],
    },
  },
  systems: {
    hero: {
      eyebrow: "Systems",
      title: "Connected deliverables with clear boundaries.",
      subtitle:
        "TieGui installs and manages the critical infrastructure blocks that drive predictable booked jobs.",
      primaryCta: { label: "Book Strategy Call", href: "/contact" },
    },
    pillarsTitle: "System Breakdown",
    pillarsSubtitle: "What is included and where scope boundaries stay firm.",
    pillars: [
      {
        title: "Website",
        description: "Conversion architecture for trust, speed, and qualified action.",
        included: ["Core pages and offer framework", "Lead capture routing", "Performance and mobile optimization"],
        boundaries: ["No open-ended content publishing", "No unmanaged plugin bloat"],
      },
      {
        title: "Automation / SMS",
        description: "Response-time infrastructure for inbound lead continuity.",
        included: ["Missed-call text-back flow", "Qualification prompts", "Notification and escalation rules"],
        boundaries: ["No unmanaged outbound spam workflows", "No unapproved messaging templates"],
      },
      {
        title: "CRM / Pipeline",
        description: "Lead and job pipeline structure with operational accountability.",
        included: ["Pipeline stage model", "Ownership and status conventions", "Core dashboard views"],
        boundaries: ["No bespoke ERP replacements", "No undefined custom-object sprawl"],
      },
      {
        title: "Tracking / Reporting",
        description: "Attribution and reporting mapped to revenue outcomes.",
        included: ["Source tracking implementation", "Booked-revenue reporting", "Monthly optimization review"],
        boundaries: ["No vanity dashboard projects", "No hidden black-box reporting"],
      },
    ],
    offer: {
      title: "Engagement Model",
      subtitle: "Setup + Monthly System Management / Optimization",
      setup: {
        label: "Setup",
        price: "Starting at $3,500",
        bullets: ["Architecture", "Implementation", "Launch hardening"],
      },
      monthly: {
        label: "Monthly Management / Optimization",
        price: "Starting at $1,250/mo",
        bullets: ["Monitoring", "Reporting", "Iteration"],
      },
    },
  },
  caseStudies: {
    hero: {
      eyebrow: "Case Studies",
      title: "Transformation work with operational outcomes.",
      subtitle: "Each study documents what changed, what was installed, and what improved.",
    },
    finalCta: {
      title: "Want this level of systems execution in your operation?",
      subtitle: "Book a strategy call and we will map your infrastructure priorities.",
      cta: { label: "Book Strategy Call", href: "/contact" },
    },
  },
  contact: {
    hero: {
      eyebrow: "Contact",
      title: "Book a strategy call.",
      subtitle: "For owners ready to install revenue infrastructure and run a tighter operation.",
    },
    whoItsFor: [
      "Home service businesses with active demand and fulfillment capacity",
      "Operators who need structure across website, follow-up, and pipeline",
      "Teams that want direct visibility from source to booked revenue",
    ],
    nextSteps: [
      "You submit the intake form",
      "TieGui reviews fit, scope complexity, and constraints",
      "You get a response with next-step recommendation",
    ],
    scheduling: {
      label: "Scheduling link (placeholder)",
      href: "#",
      note: "Replace with your live calendar URL.",
    },
    form: {
      nameLabel: "Name",
      emailLabel: "Email",
      phoneLabel: "Phone",
      companyLabel: "Company",
      challengeLabel: "What is the biggest systems bottleneck right now?",
      submitLabel: "Submit Request",
      successMessage: "Request received. You will get a follow-up soon.",
    },
  },
  footer: {
    tagline: "Revenue Infrastructure for Home Service Businesses",
    links: [
      { label: "About", href: "/about" },
      { label: "Systems", href: "/systems" },
      { label: "Case Studies", href: "/case-studies" },
      { label: "Contact", href: "/contact" },
    ],
    copyright: "TieGui Solutions",
  },
};

const contractorFirstCopy: SiteCopy = {
  ...founderPremiumCopy,
  home: {
    ...founderPremiumCopy.home,
    hero: {
      ...founderPremiumCopy.home.hero,
      eyebrow: "Built for Contractors",
      title: "Stop losing jobs between the first call and the follow-up.",
      subtitle:
        "TieGui installs the systems that keep leads moving: website, SMS automation, pipeline management, and reporting tied to booked work.",
    },
    finalCta: {
      ...founderPremiumCopy.home.finalCta,
      title: "Install systems that help you book more of the work you already earn.",
    },
  },
  about: {
    ...founderPremiumCopy.about,
    hero: {
      ...founderPremiumCopy.about.hero,
      title: "Built by an operator for operators.",
    },
  },
};

export const SITE_COPY_VARIANTS: Record<CopyVariant, SiteCopy> = {
  contractorFirst: contractorFirstCopy,
  founderPremium: founderPremiumCopy,
};

export const DEFAULT_COPY_VARIANT: CopyVariant = "founderPremium";

export function getSiteCopy(variant: CopyVariant = DEFAULT_COPY_VARIANT): SiteCopy {
  return SITE_COPY_VARIANTS[variant];
}

export const siteCopy = getSiteCopy(DEFAULT_COPY_VARIANT);
