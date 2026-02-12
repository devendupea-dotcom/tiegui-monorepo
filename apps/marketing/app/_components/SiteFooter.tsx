import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/system", label: "System" },
  { href: "/pricing", label: "Pricing" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function SiteFooter() {
  return (
    <footer className="footer" id="site-footer">
      <div className="container footer-inner">
        <div className="footer-trust">Revenue engines, not brochure sites.</div>
        <div className="footer-meta">Based in Tacoma, WA</div>
        <nav className="footer-links" aria-label="Footer navigation">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="footer-link">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="footer-copy">(c) {new Date().getFullYear()} Tiegui Solutions</div>
      </div>
    </footer>
  );
}
