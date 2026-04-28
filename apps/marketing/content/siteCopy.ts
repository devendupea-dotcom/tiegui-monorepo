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

type HeroStackItem = {
  title: string;
  detail: string;
};

type HeroShowcase = {
  eyebrow: string;
  title: string;
  subtitle: string;
  stack: HeroStackItem[];
  stats: Array<{
    value: string;
    label: string;
  }>;
  note: string;
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
      highlight?: string;
      subtitle: string;
      supportLine?: string;
      chips?: string[];
      showcase?: HeroShowcase;
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
    defaultTitle: "TieGui Solutions | Call-to-Cash Contractor OS",
    titleTemplate: "%s | TieGui Solutions",
    description:
      "TieGui Solutions helps contractors capture leads, reply fast, send estimates, schedule jobs, dispatch crews, and track invoices in one workspace.",
    openGraphDescription:
      "Stop losing jobs after the phone rings. TieGui keeps leads, estimates, scheduling, dispatch, invoices, and follow-up in one contractor workspace.",
  },
  brand: {
    name: "TieGui Solutions",
    markAlt: "TieGui Solutions mark",
    tagline: "Call-to-Cash Contractor OS",
    location: "Tacoma, WA",
  },
  nav: {
    links: [
      { label: "About", href: "/about" },
      { label: "Systems", href: "/systems" },
      { label: "Case Studies", href: "/case-studies" },
      { label: "Contact", href: "/contact" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
    primaryCta: { label: "Free Lead Audit", href: "/contact" },
  },
  home: {
    hero: {
      eyebrow: "Call-to-Cash Contractor OS",
      title: "Turn missed calls into estimates, jobs, and paid invoices.",
      highlight: "",
      subtitle:
        "TieGui is the contractor workspace that keeps every job moving from first call to final payment.",
      supportLine:
        "It catches leads, sends customer-facing estimates, schedules work, sends job updates, and tracks invoices so owners stop losing money in the follow-up.",
      chips: ["Missed Calls", "Estimates", "Scheduling", "Invoices"],
      showcase: {
        eyebrow: "Today in TieGui",
        title: "Lead to payment preview",
        subtitle: "What needs attention",
        stack: [
          {
            title: "New Lead",
            detail: "Cleanup quote",
          },
          {
            title: "Estimate",
            detail: "Sent",
          },
          {
            title: "Schedule",
            detail: "Ready to book",
          },
          {
            title: "Invoice",
            detail: "Unpaid",
          },
        ],
        stats: [
          { value: "4", label: "new leads" },
          { value: "2", label: "estimates waiting" },
          { value: "$3,240", label: "open invoices" },
        ],
        note: "See who called, who needs an estimate, what is ready to schedule, and who still owes money.",
      },
      primaryCta: { label: "Get My Free Audit", href: "/contact" },
      secondaryCta: { label: "How It Works", href: "#process" },
    },
    proofRow: {
      title: "From first call to final payment",
      bullets: [
        "Catch missed calls before they become lost jobs",
        "Send estimates without losing customer context",
        "Move approved work into scheduling",
        "Update customers and crews from the same job record",
        "Track unpaid invoices until the money is collected",
      ],
    },
    problem: {
      title: "You are not just losing leads. You are losing follow-through.",
      statement:
        "Most contractors already have demand. The leak happens after the phone rings. A customer calls while you are working. An estimate gets sent but never followed up. A job gets finished but the invoice still needs chasing. TieGui keeps every money step visible.",
      details: [
        "Missed calls become lost jobs when customers call the next company.",
        "Estimates disappear after they are sent when nobody owns the next follow-up.",
        "Invoices turn into cleanup work when payments live in memory, texts, and spreadsheets.",
      ],
    },
    build: {
      title: "One workspace from lead to payment.",
      subtitle: "TieGui keeps the money-making parts of your business in one place.",
      cards: [
        {
          title: "Catch the lead",
          description: "Calls, texts, forms, referrals, and manual leads stay organized in one place.",
          bullets: ["Missed-call text-back", "Lead intake", "Next step"],
        },
        {
          title: "Send the estimate",
          description: "Build and send customer-facing estimates while keeping the conversation attached.",
          bullets: ["Share link", "Approval tracking", "Follow-up"],
        },
        {
          title: "Schedule the work",
          description: "Move approved jobs onto the calendar and keep crews and customer updates connected.",
          bullets: ["Calendar", "Dispatch texts", "Tracking updates"],
        },
        {
          title: "Track the money",
          description: "Send customer-facing invoices, see open balances, and know who still needs follow-up.",
          bullets: ["Invoice links", "Unpaid balances", "Payment status"],
        },
      ],
    },
    process: {
      title: "The workflow is simple.",
      steps: [
        {
          title: "A lead comes in",
          description: "From a call, text, form, referral, or manual entry.",
        },
        {
          title: "TieGui keeps it moving",
          description: "Reply, estimate, schedule, dispatch, and follow up from one place.",
        },
        {
          title: "You get paid cleaner",
          description: "Invoices and unpaid balances stay visible until the job is closed.",
        },
      ],
    },
    caseStudyPreview: {
      title: "Case Study Preview",
      subtitle: "Before and after transformations from live implementation work.",
      cta: { label: "View All Case Studies", href: "/case-studies" },
    },
    offer: {
      title: "We set it up with you.",
      subtitle: "No complicated software handoff. TieGui Solutions helps install the workflow around your real business.",
      setup: {
        label: "Setup",
        price: "Launch the system",
        bullets: [
          "Set up your workspace",
          "Connect your lead follow-up",
          "Map estimates, scheduling, and invoices",
        ],
      },
      monthly: {
        label: "Monthly",
        price: "Keep it working",
        bullets: [
          "Review leads and follow-up",
          "Improve the workflow",
          "Keep reporting simple",
        ],
      },
      note: "The goal is simple: more calls turn into quotes, more quotes turn into jobs, and more jobs turn into paid invoices.",
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
      title: "Before you buy more leads, fix the ones you already get.",
      subtitle: "Book a free TieGui lead audit. We will show where calls, estimates, scheduling, or invoices are slipping, and what the system would fix first.",
      primaryCta: { label: "Get My Free Audit", href: "/contact" },
      secondaryCta: { label: "How It Works", href: "#process" },
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
      title: "Book a lead leak audit.",
      subtitle: "For contractors who want to see where calls, estimates, scheduling, or invoices are slipping.",
    },
    whoItsFor: [
      "Home service businesses with active demand and fulfillment capacity",
      "Operators who miss calls or rely on memory for follow-up",
      "Teams that want one workflow from first call to paid invoice",
    ],
    nextSteps: [
      "You submit the intake form",
      "TieGui reviews your current lead-to-payment path",
      "You get a clear recommendation on what to fix first",
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
      challengeLabel: "Where are leads, estimates, scheduling, or invoices slipping right now?",
      submitLabel: "Submit Request",
      successMessage: "Request received. You will get a follow-up soon.",
    },
  },
  footer: {
    tagline: "Call-to-Cash Contractor OS",
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
