"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_CTA_LABEL, NAV_LINKS } from "../_content";

export default function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    document.body.classList.toggle("modal-open", mobileMenuOpen);
    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    // Close the mobile drawer on route change to avoid "blank screens" caused by a lingering overlay.
    setMobileMenuOpen(false);
    document.body.classList.remove("modal-open");
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [mobileMenuOpen]);

  return (
    <header className="nav navbar">
      <div className="container nav-inner">
        <Link className="brand" href="/" aria-label="TieGui Home">
          <Image src="/logo/tiegui-tiger.png" alt="" className="brand-logo" width={1536} height={1024} priority />
          <span className="brand-name">TieGui Solutions</span>
        </Link>
        <nav className="links" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>
        <div className="nav-actions">
          <Link className="nav-cta" href="/contact">
            {NAV_CTA_LABEL}
          </Link>
          <button
            className="nav-toggle"
            type="button"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      <button
        className={`drawer-backdrop${mobileMenuOpen ? " open" : ""}`}
        type="button"
        aria-label="Close menu"
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside className={`mobile-drawer${mobileMenuOpen ? " open" : ""}`} aria-hidden={!mobileMenuOpen}>
        <div className="drawer-header">
          <div className="drawer-title">Menu</div>
          <button className="drawer-close" type="button" onClick={() => setMobileMenuOpen(false)}>
            ×
          </button>
        </div>
        <nav className="drawer-links">
          <Link href="/" onClick={() => setMobileMenuOpen(false)}>
            Home
          </Link>
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <Link className="cta-button drawer-cta" href="/contact" onClick={() => setMobileMenuOpen(false)}>
          {NAV_CTA_LABEL}
        </Link>
      </aside>
    </header>
  );
}
