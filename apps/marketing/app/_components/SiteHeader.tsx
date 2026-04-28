"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { siteCopy } from "../../content/siteCopy";
import ButtonLink from "./ui/ButtonLink";
import PageShell from "./ui/PageShell";

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEsc);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEsc);
    };
  }, [menuOpen]);

  return (
    <header className="site-header">
      <PageShell className="site-header__shell">
        <div className="site-header__inner">
          <Link href="/" className="site-brand" aria-label="TieGui Solutions home">
            <Image
              src="/logo/tiegui-mark.png"
              alt={siteCopy.brand.markAlt}
              width={120}
              height={120}
              className="site-brand__mark"
              priority
            />
            <span className="site-brand__text">{siteCopy.brand.name}</span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            {siteCopy.nav.links.map((link) => (
              <Link key={link.href} href={link.href} className="site-nav__link">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="site-header__actions">
            <ButtonLink href={siteCopy.nav.primaryCta.href} label={siteCopy.nav.primaryCta.label} className="site-header__cta" />
            <button
              type="button"
              className="site-header__menu-toggle"
              onClick={() => setMenuOpen((current) => !current)}
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </PageShell>

      <button
        type="button"
        className={`site-mobile-backdrop${menuOpen ? " is-open" : ""}`}
        aria-label="Close navigation menu"
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`site-mobile-nav${menuOpen ? " is-open" : ""}`} aria-hidden={!menuOpen}>
        <div className="site-mobile-nav__top">
          <p className="site-mobile-nav__title">Navigation</p>
          <button type="button" className="site-mobile-nav__close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            X
          </button>
        </div>
        <nav className="site-mobile-nav__links" aria-label="Mobile primary">
          {siteCopy.nav.links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <ButtonLink
          href={siteCopy.nav.primaryCta.href}
          label={siteCopy.nav.primaryCta.label}
          className="site-mobile-nav__cta"
        />
      </aside>
    </header>
  );
}
