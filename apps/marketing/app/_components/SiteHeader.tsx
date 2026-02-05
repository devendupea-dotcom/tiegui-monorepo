"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CTA_LABEL, NAV_LINKS } from "../_content";

export default function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("modal-open", mobileMenuOpen);
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
          <Image src="/logo/tiegui-mark.png" alt="" className="brand-logo" width={1521} height={1023} priority />
          <span className="brand-name">TieGui</span>
        </Link>
        <nav className="links" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>
        <div className="nav-actions">
          <Link className="btn primary nav-cta" href="/contact">
            {CTA_LABEL}
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
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <Link className="btn primary drawer-cta" href="/contact">
          {CTA_LABEL}
        </Link>
      </aside>
    </header>
  );
}
