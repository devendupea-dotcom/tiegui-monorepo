"use client";

import { useEffect } from "react";
import { replayOfflineOutbox } from "./app/_lib/offline-outbox";

const REPLAY_INTERVAL_MS = 30_000;

export default function OfflineSyncBootstrap() {
  useEffect(() => {
    let disposed = false;

    async function runReplay() {
      if (disposed) return;
      await replayOfflineOutbox();
    }

    void runReplay();

    const interval = window.setInterval(() => {
      void runReplay();
    }, REPLAY_INTERVAL_MS);

    const onOnline = () => {
      void runReplay();
    };

    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
