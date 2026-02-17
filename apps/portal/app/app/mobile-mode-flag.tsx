"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const STORAGE_KEY = "tiegui:portal:mobileMode";

function applyMobileMode(enabled: boolean) {
  const html = document.documentElement;
  if (enabled) {
    html.setAttribute("data-mobile-mode", "1");
  } else {
    html.removeAttribute("data-mobile-mode");
  }
}

export default function MobileModeFlag() {
  const searchParams = useSearchParams();
  const mobileParam = searchParams.get("mobile");

  useEffect(() => {
    if (mobileParam === "1") {
      sessionStorage.setItem(STORAGE_KEY, "1");
    }
    if (mobileParam === "0") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    const enabled = mobileParam === "1" || sessionStorage.getItem(STORAGE_KEY) === "1";
    applyMobileMode(enabled);
  }, [mobileParam]);

  useEffect(
    () => () => {
      applyMobileMode(false);
    },
    [],
  );

  return null;
}
