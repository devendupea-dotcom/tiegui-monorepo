"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "tiegui-theme";

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(preference: ThemePreference) {
  const resolved = preference === "system" ? resolveSystemTheme() : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export default function ThemeToggle() {
  const t = useTranslations("themeToggle");
  const [preference, setPreference] = useState<ThemePreference>("system");
  const preferenceRef = useRef<ThemePreference>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const nextPreference: ThemePreference =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";

    preferenceRef.current = nextPreference;
    setPreference(nextPreference);
    applyTheme(nextPreference);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (preferenceRef.current === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemChange);
    };
  }, []);

  function updatePreference(next: ThemePreference) {
    preferenceRef.current = next;
    setPreference(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <div className="theme-toggle" role="group" aria-label={t("groupLabel")}>
      <button
        type="button"
        className={`theme-toggle-btn ${preference === "system" ? "active" : ""}`}
        onClick={() => updatePreference("system")}
      >
        {t("auto")}
      </button>
      <button
        type="button"
        className={`theme-toggle-btn ${preference === "light" ? "active" : ""}`}
        onClick={() => updatePreference("light")}
      >
        {t("light")}
      </button>
      <button
        type="button"
        className={`theme-toggle-btn ${preference === "dark" ? "active" : ""}`}
        onClick={() => updatePreference("dark")}
      >
        {t("dark")}
      </button>
    </div>
  );
}
