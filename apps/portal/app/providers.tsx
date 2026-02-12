"use client";

import { useMemo } from "react";
import { QueryClient } from "@tanstack/react-query";
import {
  PersistQueryClientProvider,
  type Persister,
  type PersistedClient,
} from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";
import { SessionProvider } from "next-auth/react";
import OfflineSyncBootstrap from "./offline-sync-bootstrap";

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 1000 * 60 * 60 * 24,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  const persister = useMemo<Persister>(() => {
    const store = createStore("tiegui-react-query-v1", "query-cache");
    const key = "react-query-cache";

    return {
      persistClient: async (client: PersistedClient) => {
        await set(key, client, store);
      },
      restoreClient: async () => {
        return get<PersistedClient>(key, store);
      },
      removeClient: async () => {
        await del(key, store);
      },
    };
  }, []);

  return (
    <SessionProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 1000 * 60 * 60 * 24,
          buster: "portal-v1",
        }}
      >
        <OfflineSyncBootstrap />
        {children}
      </PersistQueryClientProvider>
    </SessionProvider>
  );
}
