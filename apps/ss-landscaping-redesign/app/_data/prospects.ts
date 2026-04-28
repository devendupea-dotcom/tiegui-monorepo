export type Prospect = {
  slug: string;
  company: string;
  location: string;
  segment: string;
  currentSite: string;
  contactEmail: string;
  phone?: string;
  offerEyebrow: string;
  heroTitle: string;
  heroBody: string;
  auditSummary: string;
  currentIssues: string[];
  services: Array<{
    eyebrow: string;
    title: string;
    body: string;
  }>;
  proof: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  adFixes: string[];
  crmStack: Array<{
    title: string;
    body: string;
  }>;
  gallery: Array<{
    src: string;
    alt: string;
  }>;
  logo?: string;
  theme: {
    accent: string;
    accentStrong: string;
    accentSoft: string;
    surface: string;
    background: string;
    ink: string;
  };
};

export const prospects: Prospect[] = [
  {
    slug: "ss-landscaping-services",
    company: "SS Landscaping Services",
    location: "Tacoma, Bremerton, and greater Puget Sound",
    segment: "Commercial landscape construction and maintenance",
    currentSite: "http://www.sslandinc.com/",
    contactEmail: "info@sslandinc.com",
    phone: "(253) 535-2922",
    offerEyebrow: "Commercial landscape construction and maintenance",
    heroTitle: "A clearer commercial landscape site for owners, developers, and property teams.",
    heroBody:
      "This concept brings SS Landscaping's decades of public, healthcare, and urban project work above the fold so the business looks as established online as it already is in the field.",
    auditSummary:
      "The underlying reputation is strong, but the current homepage hides the best proof, leaves inquiry intake passive, and feels older than the work itself.",
    currentIssues: [
      "There is no real estimate or project intake flow, so commercial buyers are pushed into a weak contact path.",
      "The site buries the strongest project proof instead of showing range and credibility right away.",
      "Tacoma headquarters, Peninsula coverage, and service lanes are not framed in a buyer-friendly way for GCs and property teams.",
    ],
    services: [
      {
        eyebrow: "Construction",
        title: "Commercial installation with cleaner scope framing",
        body:
          "Landscape construction, planting, irrigation, and finish work are packaged as one organized service instead of scattered copy blocks.",
      },
      {
        eyebrow: "Maintenance",
        title: "Ongoing property care with stronger operations language",
        body:
          "The recurring maintenance lane is rewritten for facility managers and operators who care about standards, response, and consistency.",
      },
      {
        eyebrow: "Coverage",
        title: "Tacoma and Peninsula reach that feels active",
        body:
          "Location, service area, and direct contact paths are presented as a credible operating footprint rather than hidden office details.",
      },
    ],
    proof: [
      {
        label: "Since",
        value: "1978",
        detail: "Long-running brand equity surfaced early instead of tucked into old copy.",
      },
      {
        label: "Primary buyer",
        value: "Commercial",
        detail: "The concept speaks to developers, architects, and property operators immediately.",
      },
      {
        label: "Lead path",
        value: "Faster",
        detail: "Call, estimate, and scope-first intake all show up in the first screen.",
      },
    ],
    adFixes: [
      "A commercial-service headline plus Tacoma coverage appears in the hero for ad traffic.",
      "Project proof is moved high enough to validate trust before a buyer bounces.",
      "The estimate path is structured around scope, site type, and timeline instead of a generic contact prompt.",
    ],
    crmStack: [
      {
        title: "Missed-call text back",
        body:
          "If a prospect calls from paid traffic and no one answers, Twilio can answer instantly with a text and start qualification.",
      },
      {
        title: "Lead routing and status",
        body:
          "Estimate requests can drop straight into a pipeline with tags for construction, maintenance, or public-sector work.",
      },
      {
        title: "Follow-up automation",
        body:
          "Quotes, reminders, review requests, and dormant-lead follow-up can all run from the same CRM instead of relying on memory.",
      },
    ],
    gallery: [
      {
        src: "https://images.squarespace-cdn.com/content/v1/5552bb14e4b0c250d11bcaed/98710086-b503-4191-8bd9-1204fa75b7f8/222+5th+Sept+2024-21.jpg",
        alt: "SS Landscaping rooftop project photography.",
      },
      {
        src: "https://images.squarespace-cdn.com/content/v1/5552bb14e4b0c250d11bcaed/1585262755341-U4CCLKRQ8ZE8S5YWJ0OB/SS+Landscaping+-124.jpg?format=1000w",
        alt: "Commercial courtyard landscape installed by SS Landscaping.",
      },
      {
        src: "https://images.squarespace-cdn.com/content/v1/5552bb14e4b0c250d11bcaed/1624992219092-N7I8BBOUOZLWGLHUM5A8/SSLandscaping2019-12.jpg?format=1000w",
        alt: "Public-facing memorial landscape by SS Landscaping.",
      },
    ],
    logo: "https://images.squarespace-cdn.com/content/v1/5552bb14e4b0c250d11bcaed/1571329796565-6Q4E7WI6S1YP4NPMTC5M/SS+Landscaping+Services+SINCE+78+LOGO+-+Transparent+%28PNG%29.png?format=1000w",
    theme: {
      accent: "#c06f45",
      accentStrong: "#234536",
      accentSoft: "#f1dfc6",
      surface: "rgba(255, 248, 241, 0.86)",
      background: "#efe1d0",
      ink: "#162117",
    },
  },
  {
    slug: "tacoma-landscaping-co",
    company: "Tacoma Landscaping Co",
    location: "Tacoma and Federal Way",
    segment: "Residential landscaping, pavers, walls, and lawn installs",
    currentSite: "https://www.gpaklandscapingtacoma.com/",
    contactEmail: "mohlermichael@yahoo.com",
    phone: "(206) 854-2775",
    offerEyebrow: "Residential landscaping and outdoor upgrades",
    heroTitle: "A Tacoma landscaping homepage that feels current, trustworthy, and easy to hire.",
    heroBody:
      "This concept replaces dated graphics and thin lead-gen formatting with a tighter service offer, cleaner local proof, and a stronger estimate path for homeowners landing from Google Ads.",
    auditSummary:
      "The current site looks like an old local directory page, which undermines trust before a prospect even reads the services.",
    currentIssues: [
      "The homepage title literally includes a spelling error, which hurts perceived quality and search trust.",
      "The design relies on dated graphics and long blocks of text instead of proof, hierarchy, and quick actions.",
      "Service pages do not feel like focused landing pages for pavers, walls, or new lawns coming from ads.",
    ],
    services: [
      {
        eyebrow: "Hardscape",
        title: "Pavers and retaining walls sold with stronger structure",
        body:
          "Instead of a generic list of jobs, the concept groups patio, wall, and access work into a cleaner hardscape offer homeowners can understand fast.",
      },
      {
        eyebrow: "Lawns",
        title: "New lawn installs that look like a finished result",
        body:
          "Sod, grading, cleanup, and yard refreshes are framed around curb appeal and usable space rather than random service bullets.",
      },
      {
        eyebrow: "Maintenance",
        title: "A better path for recurring outdoor upkeep",
        body:
          "Pruning, cleanup, and ongoing yard work get their own structured CTA instead of being buried in a busy homepage.",
      },
    ],
    proof: [
      {
        label: "Primary focus",
        value: "Homeowners",
        detail: "The rewrite speaks directly to people comparing three local contractors from search.",
      },
      {
        label: "Above fold",
        value: "Estimate CTA",
        detail: "A clear call path and estimate button appear immediately for mobile traffic.",
      },
      {
        label: "Ad readiness",
        value: "Higher",
        detail: "Each service block reads like a real landing page instead of a directory listing.",
      },
    ],
    adFixes: [
      "The hero immediately ties Tacoma service intent to the exact work being advertised.",
      "The page uses stronger visual hierarchy so paid traffic can scan and act instead of parsing clutter.",
      "The estimate CTA is repeated with proof nearby, which reduces the trust gap old local sites create.",
    ],
    crmStack: [
      {
        title: "Instant response automation",
        body:
          "TieGui can send immediate text follow-up after a form fill so Google Ads leads do not cool off.",
      },
      {
        title: "Source tracking",
        body:
          "Calls and form submissions can be tagged by campaign, service, and area so ad spend stops feeling blind.",
      },
      {
        title: "Quote follow-up",
        body:
          "A pipeline can remind the team who needs a bid, who was sent an estimate, and who needs a second touch.",
      },
    ],
    gallery: [
      {
        src: "https://www.gpaklandscapingtacoma.com/images/FWLC-drop-shadow.jpg",
        alt: "Tacoma Landscaping Co header image.",
      },
      {
        src: "https://www.gpaklandscapingtacoma.com/images/Paver-Contractor.gif",
        alt: "Paver project image from Tacoma Landscaping Co.",
      },
      {
        src: "https://www.gpaklandscapingtacoma.com/images/Rock-Walls.gif",
        alt: "Rock wall service image from Tacoma Landscaping Co.",
      },
    ],
    theme: {
      accent: "#a45f3c",
      accentStrong: "#24384c",
      accentSoft: "#efdfd0",
      surface: "rgba(249, 245, 240, 0.87)",
      background: "#ece5dc",
      ink: "#182028",
    },
  },
  {
    slug: "g-and-l-landscaping",
    company: "G&L Landscaping",
    location: "Tacoma area",
    segment: "Landscape services, cleanup, and yard improvements",
    currentSite: "https://halcon240624.wixsite.com/mysite",
    contactEmail: "halcon240624@gmail.com",
    offerEyebrow: "Landscape services and yard improvements",
    heroTitle: "A real local landscaping site instead of a starter-template homepage.",
    heroBody:
      "This concept turns a raw Wix presence into a clearer local brand with faster trust-building, better service framing, and a stronger reason to request an estimate.",
    auditSummary:
      "The current experience feels unfinished. It does not look like an established business, and it gives homeowners too little confidence to choose it over the next listing.",
    currentIssues: [
      "The homepage reads like a starter template, which creates a trust problem before any service copy lands.",
      "There is no estimate flow or structured conversion path for people comparing landscapers on mobile.",
      "Branding, location authority, and proof are all too weak for Google Ads traffic or higher-ticket work.",
    ],
    services: [
      {
        eyebrow: "Cleanup",
        title: "Seasonal refreshes and property cleanup",
        body:
          "The concept gives cleanup work a stronger residential framing so it feels like a real homeowner solution, not a casual side-service.",
      },
      {
        eyebrow: "Installs",
        title: "Small builds and yard upgrades",
        body:
          "Beds, edging, lawn improvements, and outdoor touch-ups are organized into a cleaner offer with clearer next steps.",
      },
      {
        eyebrow: "Maintenance",
        title: "Recurring care with a direct quote path",
        body:
          "Instead of generic template sections, ongoing mowing and upkeep now route prospects into a real estimate call-to-action.",
      },
    ],
    proof: [
      {
        label: "Template feel",
        value: "Removed",
        detail: "The concept replaces starter-site signals with a sharper local contractor presence.",
      },
      {
        label: "Buyer clarity",
        value: "Higher",
        detail: "Service lanes and CTA language are specific enough to convert colder traffic.",
      },
      {
        label: "Mobile action",
        value: "Faster",
        detail: "The page is built around phone and estimate taps, not browsing friction.",
      },
    ],
    adFixes: [
      "A stronger first screen answers what the company does, where it works, and why someone should trust it.",
      "Quote intent is moved above the fold so ad traffic has an obvious next action.",
      "Service categories are simplified so the page reads clearly on mobile instead of like a template demo.",
    ],
    crmStack: [
      {
        title: "Simple quote capture",
        body:
          "TieGui can turn estimate requests into a proper pipeline even if the business is starting from just phone and email.",
      },
      {
        title: "Automated follow-up texts",
        body:
          "Homeowners can receive confirmation, scheduling, and reminder texts without manual chasing.",
      },
      {
        title: "Review request flow",
        body:
          "Finished jobs can trigger automated review requests, which helps local search credibility over time.",
      },
    ],
    gallery: [
      {
        src: "https://static.wixstatic.com/media/2de425_9bcd8834e040485399621373bf47bc37~mv2.jpg/v1/fill/w_900,h_700,al_c,q_85,enc_avif,quality_auto/2de425_9bcd8834e040485399621373bf47bc37~mv2.jpg",
        alt: "Landscape work image from G&L Landscaping.",
      },
      {
        src: "https://static.wixstatic.com/media/2de425_b4e6fa5acd044ea4b9989e41f507509a~mv2.jpg/v1/fill/w_900,h_700,al_c,q_85,enc_avif,quality_auto/2de425_b4e6fa5acd044ea4b9989e41f507509a~mv2.jpg",
        alt: "Another project image from G&L Landscaping.",
      },
      {
        src: "https://static.wixstatic.com/media/2de425_b6e9bc556b324f0da608bcdd4792186f~mv2.jpg/v1/fill/w_900,h_700,al_c,q_85,enc_avif,quality_auto/2de425_b6e9bc556b324f0da608bcdd4792186f~mv2.jpg",
        alt: "Yard and landscape imagery from G&L Landscaping.",
      },
    ],
    theme: {
      accent: "#8f6a3f",
      accentStrong: "#20382f",
      accentSoft: "#efe5d1",
      surface: "rgba(252, 249, 243, 0.88)",
      background: "#e8e0d0",
      ink: "#172219",
    },
  },
  {
    slug: "nasim-landscape",
    company: "Nasim Landscape",
    location: "Tacoma and surrounding commercial markets",
    segment: "Commercial landscaping and maintenance",
    currentSite: "https://www.nasimlandscape.com/",
    contactEmail: "info@nasimlandscape.com",
    offerEyebrow: "Commercial landscaping since 1998",
    heroTitle: "A sharper conversion path for a company that already looks credible offline.",
    heroBody:
      "Nasim has a more modern site than some of the others here, but this concept tightens the hero, proof, and conversion flow so commercial traffic gets to the right message faster.",
    auditSummary:
      "The existing site is not broken, but it still reads broader and softer than a high-converting commercial landscape homepage should.",
    currentIssues: [
      "The offer is not compressed tightly enough for ad traffic or first-time commercial buyers.",
      "Project proof and commercial trust signals could be surfaced earlier and in a more decisive layout.",
      "The current conversion path feels generic instead of shaped around bids, site walks, and ongoing maintenance opportunities.",
    ],
    services: [
      {
        eyebrow: "Maintenance",
        title: "Recurring commercial programs with clearer buyer language",
        body:
          "Facility teams and HOA decision-makers need a page that speaks to standards, reporting, and appearance instead of broad landscaping copy.",
      },
      {
        eyebrow: "Install",
        title: "Enhancement and project work framed like a bid-ready offer",
        body:
          "The concept makes improvements and install work feel more structured for developers and property groups.",
      },
      {
        eyebrow: "Response",
        title: "Faster estimate routing for commercial leads",
        body:
          "The CTA path is rebuilt around quote requests and operational response rather than a generic contact moment.",
      },
    ],
    proof: [
      {
        label: "Since",
        value: "1998",
        detail: "Experience becomes a real proof chip instead of background copy.",
      },
      {
        label: "Fit",
        value: "Commercial",
        detail: "The rewrite is tuned for buyers managing properties and vendor relationships.",
      },
      {
        label: "Lead quality",
        value: "Higher",
        detail: "The intake path asks for the context commercial jobs actually need.",
      },
    ],
    adFixes: [
      "The hero gets more specific so commercial search traffic sees the right scope immediately.",
      "The page would support service-specific landing routes for maintenance, enhancement, and install campaigns.",
      "Proof and CTA hierarchy are tightened to reduce wasted clicks from colder traffic.",
    ],
    crmStack: [
      {
        title: "Commercial intake routing",
        body:
          "Lead forms can route by property type, service type, and urgency so the right estimator gets the request quickly.",
      },
      {
        title: "Proposal follow-up",
        body:
          "Twilio workflows can handle reminders, follow-up, and no-response nudges without manual chase work.",
      },
      {
        title: "Account reactivation",
        body:
          "Past clients can be re-engaged automatically for enhancements, seasonal work, and renewals.",
      },
    ],
    gallery: [
      {
        src: "https://cdn.prod.website-files.com/654e6d0b09b918c2b7b45a4f/691966d1656c77b057838ef5_Frame%201707481995.png",
        alt: "Nasim Landscape project collage.",
      },
      {
        src: "https://cdn.prod.website-files.com/654e6d0b09b918c2b7b45a4f/691958280da08a800548850d_01-NASIM-LOGO-COLOR.png",
        alt: "Nasim Landscape logo.",
      },
    ],
    logo: "https://cdn.prod.website-files.com/654e6d0b09b918c2b7b45a4f/691958280da08a800548850d_01-NASIM-LOGO-COLOR.png",
    theme: {
      accent: "#5f8363",
      accentStrong: "#173b2c",
      accentSoft: "#dce8dc",
      surface: "rgba(245, 250, 244, 0.87)",
      background: "#e3ece3",
      ink: "#102118",
    },
  },
  {
    slug: "alvins-landscaping",
    company: "Alvin's Landscaping",
    location: "Tacoma area",
    segment: "Residential landscaping and outdoor improvements",
    currentSite: "https://alvinslandscaping.com/",
    contactEmail: "alvin@alvinslandscaping.com",
    offerEyebrow: "Residential landscaping and property upgrades",
    heroTitle: "A cleaner local contractor site built to convert homeowners faster.",
    heroBody:
      "This concept gives Alvin's Landscaping a stronger first impression, a better project story, and a more modern estimate flow without losing the local, owner-led feel.",
    auditSummary:
      "The current site has real services and images, but the layout is loose, the conversion path is weak, and the business does not look as polished as it could.",
    currentIssues: [
      "There is no real estimate form or structured path for a homeowner ready to ask for pricing.",
      "The page feels pieced together rather than intentionally designed around trust and lead flow.",
      "Project imagery exists, but it is not used to create stronger before-after proof or service clarity.",
    ],
    services: [
      {
        eyebrow: "Renovation",
        title: "Landscape refreshes sold around the finished result",
        body:
          "The service story is reframed around cleaner yards, stronger curb appeal, and a more usable outdoor layout.",
      },
      {
        eyebrow: "Installs",
        title: "Hardscape and yard upgrades that look more premium",
        body:
          "Pavers, edging, and plantings are positioned as finished outdoor improvements instead of isolated tasks.",
      },
      {
        eyebrow: "Quote path",
        title: "A better first step for mobile homeowners",
        body:
          "Calls, forms, and quick estimate actions are moved higher so the page behaves like a contractor site, not just an online brochure.",
      },
    ],
    proof: [
      {
        label: "Visual proof",
        value: "Stronger",
        detail: "Gallery sections do more work to validate the business quickly.",
      },
      {
        label: "Mobile CTA",
        value: "Clearer",
        detail: "The concept is built for people tapping from search results and map listings.",
      },
      {
        label: "Trust gap",
        value: "Smaller",
        detail: "Cleaner layout and hierarchy reduce the old-site feel that causes drop-off.",
      },
    ],
    adFixes: [
      "The hero speaks directly to homeowners instead of making them hunt for the main offer.",
      "A stronger layout reduces the weak-template feel that hurts paid traffic conversion.",
      "The estimate path is visible early enough to support local service ads and mobile clicks.",
    ],
    crmStack: [
      {
        title: "Estimate request pipeline",
        body:
          "Every form fill can move into a clear pipeline with job notes, photos, and follow-up status.",
      },
      {
        title: "Reminder sequences",
        body:
          "Twilio can automate appointment reminders and quote follow-up so fewer homeowner leads fade out.",
      },
      {
        title: "Review growth",
        body:
          "Finished projects can trigger review requests automatically to keep local trust compounding.",
      },
    ],
    gallery: [
      {
        src: "https://alvinslandscaping.com/wp-content/uploads/2023/02/Untitled-design-99-1-1024x576.png",
        alt: "Landscape project by Alvin's Landscaping.",
      },
      {
        src: "https://alvinslandscaping.com/wp-content/uploads/2023/03/Untitled-design-2023-03-23T094011.742-1024x576.png",
        alt: "Additional project photography from Alvin's Landscaping.",
      },
      {
        src: "https://alvinslandscaping.com/wp-content/uploads/2023/03/Untitled-design-2023-03-23T094841.555-1024x576.png",
        alt: "Residential outdoor improvement by Alvin's Landscaping.",
      },
    ],
    theme: {
      accent: "#826040",
      accentStrong: "#203742",
      accentSoft: "#eadfce",
      surface: "rgba(249, 246, 241, 0.88)",
      background: "#ebe2d7",
      ink: "#172026",
    },
  },
  {
    slug: "best-northwestern-landscape-co",
    company: "Best Northwestern Landscape CO",
    location: "Lakewood and Tacoma market",
    segment: "Landscaping, lawn care, and outdoor service",
    currentSite: "https://bestnorthwesternlandscapeco.com/",
    contactEmail: "info@bestnorthwesternlandscapeco.com",
    phone: "(253) 590-3800",
    offerEyebrow: "Landscaping and outdoor property service",
    heroTitle: "A more premium site for a company currently buried in generic template copy.",
    heroBody:
      "This concept keeps the broad service offer but gives it a more credible local presence, cleaner messaging, and a stronger estimate experience for homeowners comparing multiple bids.",
    auditSummary:
      "The current site is functional, but it looks like a generic contractor template. That makes differentiation and price confidence harder than it needs to be.",
    currentIssues: [
      "The homepage depends on stock-template structure and broad claims instead of local proof and a sharper offer.",
      "The copy is generic enough that the business can blend into dozens of similar contractor sites.",
      "There is little above-the-fold urgency or clarity for a homeowner who clicked with high intent.",
    ],
    services: [
      {
        eyebrow: "Design",
        title: "Landscape upgrades framed around outcome",
        body:
          "The concept emphasizes cleaner yards, better function, and visible property improvement instead of vague all-purpose language.",
      },
      {
        eyebrow: "Service",
        title: "Maintenance and recurring work with simpler entry points",
        body:
          "Service inquiries are streamlined so homeowners can tell the team what they need without hunting through a template page.",
      },
      {
        eyebrow: "Trust",
        title: "A stronger local presence for Google Ads",
        body:
          "The site puts area, service, and proof together fast so colder traffic gets enough confidence to convert.",
      },
    ],
    proof: [
      {
        label: "Current feel",
        value: "Generic",
        detail: "This concept replaces commodity-template signals with stronger brand polish.",
      },
      {
        label: "Offer clarity",
        value: "Higher",
        detail: "A homeowner can see what the company does in seconds, not after a scroll.",
      },
      {
        label: "Lead path",
        value: "Cleaner",
        detail: "The estimate flow is more direct and less dependent on template sections.",
      },
    ],
    adFixes: [
      "The hero is specific enough to support service and location ad groups without feeling generic.",
      "Proof and imagery are moved closer to the first CTA so cold traffic sees credibility faster.",
      "The page drops vague contractor language in favor of a clearer promise and next step.",
    ],
    crmStack: [
      {
        title: "Campaign-aware intake",
        body:
          "Forms can capture which service a lead wants and push that into a pipeline automatically.",
      },
      {
        title: "Automated follow-up",
        body:
          "Text and email sequences can handle quote reminders, no-response nudges, and review requests.",
      },
      {
        title: "Operational visibility",
        body:
          "A CRM view gives the business one place to track incoming opportunities instead of relying on inbox chaos.",
      },
    ],
    gallery: [
      {
        src: "https://firebasestorage.googleapis.com/v0/b/clientesimages.appspot.com/o/Paginas%2F65f88fc2a746f61ae0bb0a37%2Fgallery%2FBest%20Northwestern%20Landscape%20CO-2024-04-02T20%3A10%3A34.940Z-2.jpg?alt=media&token=1ccb4b76-279d-4e14-bb15-e9aab9101589",
        alt: "Landscape project for Best Northwestern Landscape CO.",
      },
      {
        src: "https://firebasestorage.googleapis.com/v0/b/clientesimages.appspot.com/o/Paginas%2F65f88fc2a746f61ae0bb0a37%2Fgallery%2FBest%20Northwestern%20Landscape%20CO-2024-09-04T16%3A40%3A35.143Z-8.jpg?alt=media&token=200879e4-5493-43c5-9db9-c937d6454668",
        alt: "Outdoor service image for Best Northwestern Landscape CO.",
      },
    ],
    logo: "https://firebasestorage.googleapis.com/v0/b/clientesimages.appspot.com/o/Paginas%2F65f88fc2a746f61ae0bb0a37%2FiconAndLogo%2FBest%20Northwestern%20Landscape%20CO%20-%20WH.png?alt=media&token=fc18ca97-5cdd-4961-97c2-1379c93ba157",
    theme: {
      accent: "#4b7a69",
      accentStrong: "#183228",
      accentSoft: "#d5e7df",
      surface: "rgba(244, 249, 247, 0.87)",
      background: "#deebe6",
      ink: "#102019",
    },
  },
  {
    slug: "dominguez-landscaping-service",
    company: "Dominguez Landscaping Service",
    location: "Tacoma and Pierce County",
    segment: "Residential landscaping and outdoor transformation",
    currentSite: "https://dominguezlandscapingservice.com/",
    contactEmail: "dominguezlandscapingservice@outlook.com",
    phone: "(253) 592-1805",
    offerEyebrow: "Residential landscaping and outdoor transformation",
    heroTitle: "A cleaner, more premium site for a company with stronger visual work than its homepage shows.",
    heroBody:
      "This concept gives Dominguez a more decisive hero, better project framing, and a stronger homeowner estimate path while keeping the warmth of the current brand.",
    auditSummary:
      "The existing site has some real project material, but the presentation is mixed and the homepage does not feel as premium as the underlying work could support.",
    currentIssues: [
      "The hero and visual language feel inconsistent, which weakens trust for higher-ticket outdoor projects.",
      "The estimate flow is too soft for homeowners who are ready to compare contractors now.",
      "The best imagery and awards are not organized into a clear case for why the company should be hired.",
    ],
    services: [
      {
        eyebrow: "Yards",
        title: "Full outdoor refreshes with stronger before-after storytelling",
        body:
          "The concept turns scattered visuals into a cleaner project story that sells the finished result instead of just listing services.",
      },
      {
        eyebrow: "Detail work",
        title: "Planting, cleanup, and enhancement work that feels more premium",
        body:
          "The service presentation uses better hierarchy so even smaller jobs look professional and intentional.",
      },
      {
        eyebrow: "Awards",
        title: "Recognition used as trust instead of decoration",
        body:
          "Award badges and local proof are integrated into the sales story so they actually influence conversion.",
      },
    ],
    proof: [
      {
        label: "Visual quality",
        value: "Upgraded",
        detail: "The concept lets the work lead instead of relying on mixed stock and project imagery.",
      },
      {
        label: "Homeowner trust",
        value: "Higher",
        detail: "The page feels more like a premium contractor and less like a general brochure site.",
      },
      {
        label: "Quote flow",
        value: "Stronger",
        detail: "The next step is obvious without feeling aggressive or messy.",
      },
    ],
    adFixes: [
      "Service + geography + proof are tightened into the first screen for better cold-traffic performance.",
      "Recognition and project visuals are given real hierarchy so they help conversion instead of sitting passively.",
      "The CTA structure is simplified for better mobile response from paid clicks.",
    ],
    crmStack: [
      {
        title: "Lead capture that feels organized",
        body:
          "TieGui can turn estimates into a consistent intake flow with photos, scope notes, and follow-up ownership.",
      },
      {
        title: "Text-first follow-up",
        body:
          "Homeowners often answer text faster than email, so the Twilio layer keeps the conversation moving.",
      },
      {
        title: "Review and referral workflows",
        body:
          "Completed projects can automatically trigger review requests and referral follow-up while the work is still fresh.",
      },
    ],
    gallery: [
      {
        src: "https://impro.usercontent.one/appid/oneComWsb/domain/dominguezlandscapingservice.com/media/dominguezlandscapingservice.com/onewebmedia/IMG_4770.jpg?etag=%224cf71a-682bbe53%22&sourceContentType=image%2Fjpeg&ignoreAspectRatio&resize=1200%2B900&quality=85",
        alt: "Dominguez Landscaping project image.",
      },
      {
        src: "https://impro.usercontent.one/appid/oneComWsb/domain/dominguezlandscapingservice.com/media/dominguezlandscapingservice.com/onewebmedia/IMG_1303.jpg?etag=%2246bb5a-5bc2bd73%22&sourceContentType=image%2Fjpeg&ignoreAspectRatio&resize=1200%2B900&quality=85",
        alt: "Additional Dominguez Landscaping project photo.",
      },
      {
        src: "https://impro.usercontent.one/appid/oneComWsb/domain/dominguezlandscapingservice.com/media/dominguezlandscapingservice.com/onewebmedia/2024BOPC_BronzeWinnerv1.webp?etag=%22afa8-670ecc57%22&sourceContentType=image%2Fwebp&ignoreAspectRatio&resize=1200%2B900",
        alt: "Award asset from Dominguez Landscaping Service.",
      },
    ],
    theme: {
      accent: "#bf704f",
      accentStrong: "#2b3146",
      accentSoft: "#f1ddd3",
      surface: "rgba(251, 246, 244, 0.88)",
      background: "#eee1dc",
      ink: "#1b1e2a",
    },
  },
  {
    slug: "eco-landscaping-llc",
    company: "ECO Landscaping LLC",
    location: "Pierce County and King County",
    segment: "Lawn care, maintenance, and outdoor service",
    currentSite: "https://www.ecolandscapingllc.org/",
    contactEmail: "ecolandscaping253@gmail.com",
    phone: "(253) 267-4611",
    offerEyebrow: "Lawn care and maintenance across Pierce and King County",
    heroTitle: "A better maintenance-focused homepage for repeat-service leads.",
    heroBody:
      "This concept takes ECO Landscaping beyond a basic Wix presence and turns it into a cleaner maintenance brand that looks more reliable for recurring homeowner and business work.",
    auditSummary:
      "The current site has decent service intent, but it still feels template-driven and leaves too much trust-building and quote capture on the table.",
    currentIssues: [
      "The Wix presentation makes the business look lighter-weight than it should for recurring service work.",
      "There is no strong estimate flow or service-specific conversion path for ads traffic.",
      "The service story is broad and the best work is not framed in a way that quickly builds trust.",
    ],
    services: [
      {
        eyebrow: "Maintenance",
        title: "Recurring lawn care with a clearer retention story",
        body:
          "The concept emphasizes dependable upkeep, cleaner properties, and easier scheduling for recurring clients.",
      },
      {
        eyebrow: "Enhancements",
        title: "Extra services positioned as natural add-ons",
        body:
          "Seasonal cleanups, pruning, and small improvements are packaged as logical next services, not random extras.",
      },
      {
        eyebrow: "Coverage",
        title: "A larger service area that still feels local",
        body:
          "Pierce and King County coverage is framed in a way that feels organized instead of generic.",
      },
    ],
    proof: [
      {
        label: "Site feel",
        value: "Cleaner",
        detail: "The concept moves past the template feel and looks more like a service business that can scale.",
      },
      {
        label: "Repeat business",
        value: "Supported",
        detail: "Recurring maintenance is positioned as the core revenue stream, not a side note.",
      },
      {
        label: "Ad conversion",
        value: "Higher",
        detail: "The page gives paid traffic a faster path to call or request a quote.",
      },
    ],
    adFixes: [
      "The hero is rewritten around lawn care and recurring service rather than a vague general homepage.",
      "Service sections are simpler and more readable for mobile ad traffic.",
      "The CTA path is moved higher with enough trust nearby to reduce bounce risk.",
    ],
    crmStack: [
      {
        title: "Recurring-customer automation",
        body:
          "Twilio can handle confirmations, reminders, seasonal upsell campaigns, and renewal prompts.",
      },
      {
        title: "Missed-call recovery",
        body:
          "Calls from local search can trigger automatic text-back so new leads do not vanish after hours.",
      },
      {
        title: "Review growth",
        body:
          "TieGui can automate review requests after completed service visits to help maps performance over time.",
      },
    ],
    gallery: [
      {
        src: "https://static.wixstatic.com/media/3f9bde9e2eea4f978a20edfb389e5e9d.jpg/v1/fill/w_1200,h_900,al_c,q_85,enc_avif,quality_auto/3f9bde9e2eea4f978a20edfb389e5e9d.jpg",
        alt: "Landscape image from ECO Landscaping LLC.",
      },
      {
        src: "https://static.wixstatic.com/media/6be71d8c4cfb4546a8e36de5eda4e5ad.jpg/v1/fill/w_1200,h_900,al_c,q_85,enc_avif,quality_auto/6be71d8c4cfb4546a8e36de5eda4e5ad.jpg",
        alt: "Service imagery from ECO Landscaping LLC.",
      },
      {
        src: "https://static.wixstatic.com/media/ea66f0de45ec4109b5eb190bed2244d1.jpg/v1/fill/w_1200,h_900,al_c,q_85,enc_avif,quality_auto/ea66f0de45ec4109b5eb190bed2244d1.jpg",
        alt: "Outdoor maintenance image from ECO Landscaping LLC.",
      },
    ],
    theme: {
      accent: "#61895d",
      accentStrong: "#173925",
      accentSoft: "#d7e6d4",
      surface: "rgba(244, 250, 243, 0.88)",
      background: "#dfebdd",
      ink: "#122018",
    },
  },
  {
    slug: "oscars-lawn-service-etc",
    company: "Oscar's Lawn Service Etc.",
    location: "Tacoma, WA",
    segment: "Landscaping and yard maintenance",
    currentSite: "https://www.oscarslawnserviceetc.com/",
    contactEmail: "oscarslawnserviceetc@gmail.com",
    phone: "(253) 752-2419",
    offerEyebrow: "Yard maintenance and landscaping in Tacoma",
    heroTitle: "A modern Tacoma lawn and landscaping site that no longer feels stuck in 2016.",
    heroBody:
      "This concept updates Oscar's online presence with stronger typography, clearer services, and a lead path that works better for mobile homeowners and local search traffic.",
    auditSummary:
      "The current site looks dated enough that a prospect can easily assume the company is less active or less premium than the work may deserve.",
    currentIssues: [
      "The design and layout feel old, which hurts confidence before a visitor even reaches the service details.",
      "The estimate path is not modern enough for mobile-first local search behavior.",
      "The strongest Tacoma positioning and yard-maintenance offer are not made clear fast enough.",
    ],
    services: [
      {
        eyebrow: "Maintenance",
        title: "Yard maintenance framed as a dependable service plan",
        body:
          "Instead of a dated brochure layout, the concept presents recurring care as a reliable, structured solution for busy homeowners.",
      },
      {
        eyebrow: "Landscaping",
        title: "Upgrade work that feels more polished and premium",
        body:
          "Planting, cleanup, and yard improvement services are grouped into a stronger visual story with more trust cues.",
      },
      {
        eyebrow: "Local trust",
        title: "Tacoma credibility surfaced earlier",
        body:
          "The page makes service area and experience feel real right away, which matters when a homeowner is comparing three nearby options.",
      },
    ],
    proof: [
      {
        label: "Visual age",
        value: "Reduced",
        detail: "The concept removes the dated feel that can quietly depress conversion.",
      },
      {
        label: "CTA clarity",
        value: "Improved",
        detail: "The path to request service is much easier to see and act on.",
      },
      {
        label: "Mobile fit",
        value: "Better",
        detail: "Buttons, hierarchy, and layout are built for search-result taps and quick decisions.",
      },
    ],
    adFixes: [
      "The hero gives Tacoma homeowners a clearer reason to stay instead of bouncing to another contractor.",
      "The site looks more current, which directly affects trust from paid and local search traffic.",
      "Estimate CTA placement is upgraded so the page performs more like a real landing page.",
    ],
    crmStack: [
      {
        title: "Lead response automation",
        body:
          "TieGui can answer missed calls with a text, collect basic project details, and keep homeowners engaged.",
      },
      {
        title: "Scheduling reminders",
        body:
          "Twilio can handle appointment reminders and follow-up after service so communication feels more organized.",
      },
      {
        title: "Review request sequence",
        body:
          "Positive customers can be prompted automatically for reviews, which helps future conversions.",
      },
    ],
    gallery: [
      {
        src: "https://www.oscarslawnserviceetc.com/wp-content/uploads/sites/93/2016/04/img_002.jpg",
        alt: "Oscar's Lawn Service project image.",
      },
      {
        src: "https://www.oscarslawnserviceetc.com/wp-content/uploads/sites/93/2016/04/home_img2_new.png",
        alt: "Additional Oscar's Lawn Service image.",
      },
      {
        src: "https://www.oscarslawnserviceetc.com/wp-content/uploads/sites/93/2016/05/Logo-2.png",
        alt: "Oscar's Lawn Service logo.",
      },
    ],
    logo: "https://www.oscarslawnserviceetc.com/wp-content/uploads/sites/93/2016/05/Logo-2.png",
    theme: {
      accent: "#ca7c44",
      accentStrong: "#213642",
      accentSoft: "#f3e1cf",
      surface: "rgba(251, 248, 243, 0.88)",
      background: "#efe3d5",
      ink: "#17212a",
    },
  },
  {
    slug: "nw-lawn-care-landscape",
    company: "NW Lawn Care & Landscape",
    location: "Tacoma area",
    segment: "Veteran-owned landscaping and lawn care",
    currentSite: "https://nwlawnandlandscape.com/",
    contactEmail: "mike@nwlcl.com",
    phone: "(253) 820-5647",
    offerEyebrow: "Veteran-owned landscaping and lawn care",
    heroTitle: "A stronger veteran-owned landscaping brand for Tacoma homeowners.",
    heroBody:
      "This concept keeps the veteran-owned positioning but tightens the layout, service hierarchy, and estimate path so the company feels more current and more conversion-focused.",
    auditSummary:
      "The business has useful positioning, but the current site looks older than it should and does not use its veteran-owned story to full advantage.",
    currentIssues: [
      "The current site feels dated and not especially optimized for modern local-search behavior.",
      "There is no strong form or estimate intake flow to catch higher-intent traffic.",
      "The veteran-owned angle is present, but it is not turned into a stronger trust and differentiation story.",
    ],
    services: [
      {
        eyebrow: "Maintenance",
        title: "Lawn care presented with more clarity and consistency",
        body:
          "Recurring service work is made easier to understand and easier to request from the first screen.",
      },
      {
        eyebrow: "Projects",
        title: "Landscape upgrades that look more premium",
        body:
          "Install and enhancement services are packaged in a way that raises perceived value without overcomplicating the offer.",
      },
      {
        eyebrow: "Trust",
        title: "Veteran-owned positioning used as a stronger conversion asset",
        body:
          "The new layout gives ownership, workmanship, and local trust signals more weight in the decision process.",
      },
    ],
    proof: [
      {
        label: "Differentiation",
        value: "Sharper",
        detail: "Veteran-owned branding becomes part of the actual sales story, not a throwaway line.",
      },
      {
        label: "Lead flow",
        value: "Better",
        detail: "Calls and estimate requests are easier to trigger from the first visit.",
      },
      {
        label: "Overall fit",
        value: "More modern",
        detail: "The site feels more aligned with how homeowners judge contractors today.",
      },
    ],
    adFixes: [
      "The hero is rebuilt so Tacoma homeowners understand the offer without digging through the page.",
      "The veteran-owned angle becomes a trust reason that supports ads and local SEO.",
      "The CTA path is moved higher and simplified for faster mobile conversion.",
    ],
    crmStack: [
      {
        title: "Quote pipeline",
        body:
          "TieGui can track every estimate, follow-up step, and won job in one place instead of splitting the process across inboxes and memory.",
      },
      {
        title: "Automated texts and reminders",
        body:
          "Twilio workflows can keep prospects warm between first contact, walkthrough, and quote delivery.",
      },
      {
        title: "Reactivation campaigns",
        body:
          "Past lawn-care and landscape clients can be reactivated with seasonal offers and maintenance reminders.",
      },
    ],
    gallery: [
      {
        src: "https://nwlawnandlandscape.com/wp-content/uploads/2023/07/lawn-mainten-icon-image-200x312.jpg",
        alt: "NW Lawn Care maintenance image.",
      },
      {
        src: "https://nwlawnandlandscape.com/wp-content/uploads/2023/07/river-rock_dry-creek-bed_thumbnail-200x312.jpg",
        alt: "NW Lawn Care project image.",
      },
      {
        src: "https://nwlawnandlandscape.com/wp-content/uploads/2023/07/additional-services-image-200x310.jpg",
        alt: "NW Lawn Care additional services image.",
      },
    ],
    logo: "https://nwlawnandlandscape.com/wp-content/uploads/2023/07/nwlcl-logo_main-header-200x86.png",
    theme: {
      accent: "#58785a",
      accentStrong: "#1e3041",
      accentSoft: "#dbe7da",
      surface: "rgba(245, 248, 244, 0.88)",
      background: "#e1e8e1",
      ink: "#14202a",
    },
  },
];

export function getProspect(slug: string) {
  return prospects.find((prospect) => prospect.slug === slug);
}
