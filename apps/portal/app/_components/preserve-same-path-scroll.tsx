"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tiegui-preserve-same-path-scroll";
const MAX_RESTORE_AGE_MS = 10_000;

type StoredScroll = {
  path: string;
  x: number;
  y: number;
  savedAt: number;
};

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function readStoredScroll(): StoredScroll | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null") as StoredScroll | null;
    if (!parsed || typeof parsed.path !== "string" || typeof parsed.y !== "number") {
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_RESTORE_AGE_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveScrollFor(url: URL) {
  if (url.origin !== window.location.origin) return;
  if (url.pathname !== window.location.pathname) return;
  if (url.hash) return;

  const nextPath = `${url.pathname}${url.search}`;
  if (nextPath === currentPath()) return;

  const payload: StoredScroll = {
    path: nextPath,
    x: window.scrollX,
    y: window.scrollY,
    savedAt: Date.now(),
  };

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    return;
  }
}

function restoreIfNeeded() {
  const stored = readStoredScroll();
  if (!stored || stored.path !== currentPath()) {
    return;
  }

  window.scrollTo(stored.x, stored.y);
  window.sessionStorage.removeItem(STORAGE_KEY);
}

function scheduleRestore() {
  for (const delay of [0, 50, 150, 300, 600]) {
    window.setTimeout(restoreIfNeeded, delay);
  }
}

function buildGetFormUrl(form: HTMLFormElement, submitter: HTMLElement | null): URL | null {
  const method = (form.getAttribute("method") || "get").toLowerCase();
  if (method !== "get") return null;

  const action = form.getAttribute("action") || window.location.href;
  const target = new URL(action, window.location.href);
  const params = new URLSearchParams();
  const formData = new FormData(form);

  if (
    submitter instanceof HTMLButtonElement ||
    submitter instanceof HTMLInputElement
  ) {
    if (submitter.name && !submitter.disabled) {
      formData.append(submitter.name, submitter.value);
    }
  }

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      params.append(key, value);
    }
  }

  target.search = params.toString();
  return target;
}

export default function PreserveSamePathScroll() {
  useEffect(() => {
    restoreIfNeeded();

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }

      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download") || link.closest("[data-scroll-top]")) {
        return;
      }

      saveScrollFor(new URL(link.href, window.location.href));
      scheduleRestore();
    }

    function handleSubmit(event: SubmitEvent) {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) {
        return;
      }
      if (event.target.closest("[data-scroll-top]")) {
        return;
      }

      const target = buildGetFormUrl(event.target, event.submitter);
      if (!target) {
        return;
      }

      saveScrollFor(target);
      scheduleRestore();
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, []);

  return null;
}
