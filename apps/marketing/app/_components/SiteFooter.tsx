import Link from "next/link";
import { siteCopy } from "../../content/siteCopy";
import PageShell from "./ui/PageShell";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <PageShell className="site-footer__inner">
        <p className="site-footer__tagline">{siteCopy.footer.tagline}</p>
        <nav className="site-footer__nav" aria-label="Footer">
          {siteCopy.footer.links.map((link) => (
            <Link key={link.href} href={link.href} className="site-footer__link">
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="site-footer__copyright">
          {new Date().getFullYear()} {siteCopy.footer.copyright}. {siteCopy.brand.location}
        </p>
      </PageShell>
    </footer>
  );
}
