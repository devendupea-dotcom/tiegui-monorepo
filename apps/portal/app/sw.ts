/// <reference lib="webworker" />
/// <reference types="@serwist/next/typings" />

import { ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface ServiceWorkerGlobalScope {
    __SW_MANIFEST: Array<string | { url: string; revision?: string | null }>;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.method === "GET" &&
        request.mode === "navigate" &&
        url.pathname.startsWith("/app") &&
        !url.pathname.startsWith("/app/inbox") &&
        !url.pathname.startsWith("/app/leads"),
      handler: new NetworkFirst({
        cacheName: "app-shell-v1",
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24,
          }),
        ],
      }),
    },
    {
      matcher: ({ request, url }) =>
        request.method === "GET" &&
        (url.pathname === "/api/calendar/events" ||
          url.pathname === "/api/availability" ||
          url.pathname === "/api/availability/next-open"),
      handler: new StaleWhileRevalidate({
        cacheName: "calendar-data-v1",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 80,
            maxAgeSeconds: 60 * 60 * 6,
          }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();
