export const CTA_LABEL = "Get More Calls";

export const TRUST_POINTS = [
  "Conversion-first website build",
  "Local-intent Google Ads setup",
  "Call tracking installed",
  "Missed-call capture",
  "Lead routing",
  "Simple weekly reporting",
];

export const HOW_IT_WORKS = [
  {
    title: "Build the Conversion Engine",
    desc: "Website + tracking + forms + call flow.",
  },
  {
    title: "Drive High-Intent Traffic",
    desc: "Google Ads + local targeting.",
  },
  {
    title: "Capture & Follow Up Automatically",
    desc: "Missed calls → text + lead routing.",
  },
];

export const SYSTEM_STEPS = [
  {
    title: "Conversion Website",
    desc: "Call-focused layout and mobile-first structure that drives inquiries.",
  },
  {
    title: "Google Intent Traffic",
    desc: "Google Ads built around local intent and high‑value searches.",
  },
  {
    title: "Call & Lead Tracking",
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
    a: "Typical launches happen in weeks, not months.",
  },
  {
    q: "Do you run the ads too?",
    a: "Yes. Google Ads is built into the system.",
  },
  {
    q: "Can I keep my phone number?",
    a: "Yes. We route calls without changing your number.",
  },
  {
    q: "What if I already have a website?",
    a: "We can rebuild or optimize depending on performance.",
  },
  {
    q: "Do you work in my city/state?",
    a: "We work with contractors across the U.S.",
  },
  {
    q: "What does a “lead system” mean?",
    a: "Website + ads + tracking that turns interest into calls.",
  },
];

export const SMS_EXAMPLE = {
  trigger: "Triggered by missed call",
  title: "See the SMS Agent in Action",
  subtitle:
    "When a lead calls and you miss it, the agent texts back in seconds, asks the right questions, and books the estimate — automatically.",
  messages: [
    { from: "agent", text: "Hey — this is TieGui’s assistant for {BusinessName}. Sorry we missed your call. What project are you looking to get done?" },
    { from: "customer", text: "Need a quote. My fence is leaning and a section is broken." },
    { from: "agent", text: "Got it. What city are you in — and can you text a quick photo of the damage?" },
    { from: "customer", text: "Tacoma. [photo]" },
    { from: "agent", text: "Thanks. About how many feet is the damaged section, and is it wood or chain link?" },
    { from: "customer", text: "Wood. Maybe 10–12 feet." },
    { from: "agent", text: "Perfect. We can get you on the schedule. What works better: Tomorrow 3–5pm or Wednesday 10am–12pm?" },
    { from: "customer", text: "Tomorrow 3–5." },
    { from: "agent", text: "Locked in ✅ What’s the best name and the address for the estimate?" },
    { from: "customer", text: "Mike. 1234 S Pine St, Tacoma." },
    { from: "agent", text: "Awesome — you’re confirmed for tomorrow 3–5pm. If anything changes, reply here and we’ll adjust." },
  ],
  notification: {
    title: "New Lead Booked ✅",
    details: [
      "Fence repair • Tacoma • 10–12 ft wood fence • Photo received",
      "Scheduled: Tomorrow 3–5pm • Mike • 1234 S Pine St",
    ],
  },
  trustLine: "No spam. No robo-scripts. Just fast follow-up that turns missed calls into booked jobs.",
};

export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "Examples", href: "/examples" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
];
