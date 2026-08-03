import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { PayerServer } from "@/lib/fhir-config";
import {
  getPayerServers,
  getStoredPayerServer,
  setStoredPayerServer,
} from "@/lib/payer-config";

export interface UsePayerServerResult {
  payerServer: PayerServer;
  payerServers: PayerServer[];
  cdsUrl: string;
  fhirUrl: string;
  setPayerServer: (server: PayerServer) => Promise<void>;
}

async function pushActivePayer(
  fhirUrl: string,
  clientId?: string,
): Promise<void> {
  const res = await fetch("/auth/active-payer", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fhirUrl, clientId }),
  });
  if (!res.ok) {
    throw new Error(`active-payer sync failed: ${res.status}`);
  }
}

// Mirrors the active-server boot sync in useFhirServer: pushes the stored
// payer fhirUrl to the BFF session once per page load so the proxy allowlist
// recognizes it. fhirFetch awaits this via awaitActivePayerSync() to avoid
// a race on the first request.
let bootSyncPromise: Promise<void> | null = null;

function ensureBootSync(): Promise<void> {
  if (bootSyncPromise !== null) return bootSyncPromise;
  const stored = getStoredPayerServer();
  bootSyncPromise = stored.fhirUrl
    ? pushActivePayer(stored.fhirUrl, stored.clientId).catch((err) => {
        console.error("active-payer boot sync failed", err);
      })
    : Promise.resolve();
  return bootSyncPromise;
}

export function awaitActivePayerSync(): Promise<void> {
  return ensureBootSync();
}

/**
 * Serializes a PayerServer to a stable JSON string so useSyncExternalStore
 * can detect changes via Object.is comparison on primitive values.
 */
function serializePayerServer(server: PayerServer): string {
  return JSON.stringify(server);
}

function deserializePayerServer(key: string): PayerServer {
  try {
    return JSON.parse(key) as PayerServer;
  } catch {
    return cachedPayerServers[0];
  }
}

const payerServerStore = {
  listeners: new Set<() => void>(),

  subscribe(listener: () => void): () => void {
    payerServerStore.listeners.add(listener);
    return () => payerServerStore.listeners.delete(listener);
  },

  emit(): void {
    for (const listener of payerServerStore.listeners) {
      listener();
    }
  },

  getSnapshot(): string {
    return serializePayerServer(getStoredPayerServer());
  },

  getServerSnapshot(): string {
    return serializePayerServer(getPayerServers()[0]);
  },

  async setPayerServer(server: PayerServer): Promise<void> {
    await pushActivePayer(server.fhirUrl, server.clientId);
    setStoredPayerServer(server);
    payerServerStore.emit();
  },
};

// Static list derived from APP_CONFIG (immutable after page load)
const cachedPayerServers = getPayerServers();

export function usePayerServer(): UsePayerServerResult {
  const snapshotKey = useSyncExternalStore(
    payerServerStore.subscribe,
    payerServerStore.getSnapshot,
    payerServerStore.getServerSnapshot,
  );

  const payerServer = deserializePayerServer(snapshotKey);
  const payerServers = cachedPayerServers;

  // Push the stored payer fhirUrl into the BFF session once per page load
  // so /api/fhir-proxy will trust it. The actual fetch is fired by
  // ensureBootSync(); fhirFetch awaits the same promise.
  useEffect(() => {
    ensureBootSync();
  }, []);

  const setPayerServer = useCallback(
    (server: PayerServer) => payerServerStore.setPayerServer(server),
    [],
  );

  return {
    payerServer,
    payerServers,
    cdsUrl: payerServer.cdsUrl,
    fhirUrl: payerServer.fhirUrl,
    setPayerServer,
  };
}
