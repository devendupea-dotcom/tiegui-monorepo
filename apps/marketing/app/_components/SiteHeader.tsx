"use client";

import { useEffect, useState } from "react";
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
    <header className="nav hero-nav navbar">
      <div className="container nav-inner">
        <div className="brand">
          <img src="/logo/tiegui-mark.png" alt="TieGui Solutions" className="brand-logo" />
          <span className="brand-name">TieGui</span>
        </div>
        <div className="brand-center">TieGui</div>
        <nav className="links">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>{link.label}</a>
          ))}
        </nav>
        <a className="btn primary nav-cta" href="/contact">
          {CTA_LABEL}
        </a>
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
            <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className="btn primary drawer-cta" href="/contact">
          {CTA_LABEL}
        </a>
      </aside>
    </header>
  );
}
