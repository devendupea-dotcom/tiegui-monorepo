export const PRIMARY_CTA_LABEL = "Get a Free Quote";
export const SECONDARY_CTA_LABEL = "See If This Fits Your Business";
export const BETA_CTA_LABEL = "Lock In Beta Pricing";
export const NAV_CTA_LABEL = "Let's Talk";

export const TRUST_POINTS = [
  "Conversion-first website build",
  "Local-intent Google Ads setup",
  "Call tracking installed",
  "Missed-call capture",
  "Lead routing",
  "Simple weekly reporting",
];

export const HOW_IT_WORKS_TIMELINE = [
  {
    step: "Step 01",
    title: "Audit and offer strategy",
    desc: "We map your market, your best jobs, and your fastest route to booked calls.",
  },
  {
    step: "Step 02",
    title: "Build your conversion engine",
    desc: "Website, call flow, forms, and tracking are installed with contractor-friendly workflows.",
  },
  {
    step: "Step 03",
    title: "Launch traffic and attribution",
    desc: "Google Ads are structured for local intent so you can see spend, calls, and outcomes clearly.",
  },
  {
    step: "Step 04",
    title: "Optimize from real calls",
    desc: "We refine around lead quality, scheduling speed, and close rates instead of vanity metrics.",
  },
];

export const SYSTEM_STEPS = [
  {
    title: "Conversion Website",
    desc: "Call-focused layout and mobile-first structure that drives inquiries.",
  },
  {
    title: "Google Intent Traffic",
    desc: "Google Ads built around local intent and high-value searches.",
  },
  {
    title: "Call and Lead Tracking",
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

export const FAQS = [
  {
    q: "How fast can we launch?",
    a: "Most contractor systems are live in 2-4 weeks depending on scope and content readiness.",
  },
  {
    q: "Do you run the ads too?",
    a: "Yes. We manage Google Ads and connect spend directly to lead and call outcomes.",
  },
  {
    q: "Can I keep my phone number?",
    a: "Yes. We can route through tracking numbers while preserving your normal number flow.",
  },
  {
    q: "What if I already have a website?",
    a: "We will either optimize what exists or rebuild where needed based on conversion gaps.",
  },
  {
    q: "Do you work outside Washington?",
    a: "Yes. TieGui supports local service businesses across the U.S.",
  },
  {
    q: "What does your 60-day guarantee actually mean?",
    a: "If we cannot show clear progress on lead quality and conversion tracking by day 60, we adjust strategy or part ways with no long-term lock-in.",
  },
  {
    q: "Are there long-term contracts?",
    a: "No long-term contracts. We keep terms straightforward with clear scope and pricing.",
  },
  {
    q: "Can we start small and scale later?",
    a: "Yes. Many teams start with a focused package and expand once the system proves itself.",
  },
];

export const PRICING_PREVIEW = [
  {
    name: "Foundation",
    price: "$1,200 setup",
    bullets: [
      "Conversion-focused website + tracking",
      "Consolidated revision policy to keep delivery on schedule",
      "Best for owner-operators getting organized",
    ],
  },
  {
    name: "Growth",
    price: "$1,500 setup + $600/mo",
    bullets: [
      "Google Ads management + local targeting limits",
      "Ad spend paid directly to Google ($500-$1,000/mo recommended)",
      "Best for crews ready to scale booked work",
    ],
  },
  {
    name: "Command Center",
    price: "$2,000 setup + $900/mo",
    bullets: [
      "Advanced workflow automation + reporting depth",
      "Standard and commission-based options available",
      "Best for teams prioritizing tight lead accountability",
    ],
  },
];

export const SMS_EXAMPLE = {
  trigger: "Triggered by missed call",
  title: "See the SMS Agent in Action",
  subtitle:
    "When a lead calls and you miss it, the agent texts back in seconds, asks the right questions, and books the estimate automatically.",
  messages: [
    { from: "agent", text: "Hey - this is TieGui's assistant for {BusinessName}. Sorry we missed your call. What project are you looking to get done?" },
    { from: "customer", text: "Need a quote. My fence is leaning and a section is broken." },
    { from: "agent", text: "Got it. What city are you in, and can you text a quick photo of the damage?" },
    { from: "customer", text: "Tacoma. [photo]" },
    { from: "agent", text: "Thanks. About how many feet is the damaged section, and is it wood or chain link?" },
    { from: "customer", text: "Wood. Maybe 10-12 feet." },
    { from: "agent", text: "Perfect. We can get you on the schedule. What works better: tomorrow 3-5pm or Wednesday 10am-12pm?" },
    { from: "customer", text: "Tomorrow 3-5." },
    { from: "agent", text: "Locked in. What's the best name and address for the estimate?" },
    { from: "customer", text: "Mike. 1234 S Pine St, Tacoma." },
    { from: "agent", text: "Awesome - you're confirmed for tomorrow 3-5pm. If anything changes, reply here and we'll adjust." },
  ],
  notification: {
    title: "New Lead Booked",
    details: [
      "Fence repair - Tacoma - 10-12 ft wood fence - Photo received",
      "Scheduled: Tomorrow 3-5pm - Mike - 1234 S Pine St",
    ],
  },
  trustLine: "No spam and no robotic scripts. Just fast follow-up that turns missed calls into booked jobs.",
};

export const NAV_LINKS = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Case Studies", href: "/case-studies" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];
