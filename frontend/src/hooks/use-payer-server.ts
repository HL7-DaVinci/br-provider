import { useCallback, useSyncExternalStore } from "react";
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
  setPayerServer: (server: PayerServer) => void;
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

  setPayerServer(server: PayerServer): void {
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

  const setPayerServer = useCallback((server: PayerServer) => {
    payerServerStore.setPayerServer(server);
  }, []);

  return {
    payerServer,
    payerServers,
    cdsUrl: payerServer.cdsUrl,
    fhirUrl: payerServer.fhirUrl,
    setPayerServer,
  };
}
