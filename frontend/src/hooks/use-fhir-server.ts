import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { applyCustomHeaders } from "@/lib/api";
import {
  type CustomHeader,
  FHIR_SERVERS,
  type FhirServer,
  getServerByUrl,
  getStoredServerUrl,
  setStoredServerUrl,
} from "@/lib/fhir-config";

export interface UseFhirServerResult {
  serverUrl: string;
  server: FhirServer | undefined;
  presetServers: FhirServer[];
  setServerUrl: (url: string) => Promise<void>;
  isCustomServer: boolean;
}

async function pushActiveServer(url: string): Promise<void> {
  const res = await fetch("/auth/active-server", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(`active-server sync failed: ${res.status}`);
  }
}

// Tracks the in-flight (or completed) boot-time push of the stored server URL
// to the BFF session. Lazily initialized on first awaitActiveServerSync() or
// on first useFhirServer() mount, so fhirFetch can gate its first request on
// the BFF allowlist being in sync with the SPA's localStorage selection.
let bootSyncPromise: Promise<void> | null = null;

function ensureBootSync(): Promise<void> {
  if (bootSyncPromise !== null) return bootSyncPromise;
  const stored = getStoredServerUrl();
  bootSyncPromise = stored
    ? pushActiveServer(stored).catch((err) => {
        console.error("active-server boot sync failed", err);
      })
    : Promise.resolve();
  return bootSyncPromise;
}

export function awaitActiveServerSync(): Promise<void> {
  return ensureBootSync();
}

const serverUrlStore = {
  listeners: new Set<() => void>(),

  getSnapshot(): string {
    return getStoredServerUrl();
  },

  getServerSnapshot(): string {
    return FHIR_SERVERS[0]?.url ?? "";
  },

  subscribe(listener: () => void): () => void {
    serverUrlStore.listeners.add(listener);
    return () => serverUrlStore.listeners.delete(listener);
  },

  emit(): void {
    for (const listener of serverUrlStore.listeners) {
      listener();
    }
  },

  async setServerUrl(url: string): Promise<void> {
    await pushActiveServer(url);
    setStoredServerUrl(url);
    serverUrlStore.emit();
  },
};

export function useFhirServer(): UseFhirServerResult {
  const serverUrl = useSyncExternalStore(
    serverUrlStore.subscribe,
    serverUrlStore.getSnapshot,
    serverUrlStore.getServerSnapshot,
  );

  // Push the localStorage URL into the BFF session once per page load. Covers
  // the case where the session expired (timeout, server restart, cleared
  // cookies) but localStorage still remembers the user's last selection.
  // The actual fetch is fired by ensureBootSync(); fhirFetch awaits the same
  // promise via awaitActiveServerSync() so the first request doesn't race.
  useEffect(() => {
    ensureBootSync();
  }, []);

  const setServerUrl = useCallback(
    (url: string) => serverUrlStore.setServerUrl(url),
    [],
  );

  const server = getServerByUrl(serverUrl);
  const isCustomServer = !server;

  return {
    serverUrl,
    server,
    presetServers: FHIR_SERVERS,
    setServerUrl,
    isCustomServer,
  };
}

export interface UseServerSelectionResult {
  customUrl: string;
  setCustomUrl: (url: string) => void;
  showCustomInput: boolean;
  isEditing: boolean;
  handleServerChange: (value: string) => void;
  handleCustomUrlSubmit: () => void;
}

export function useServerSelection(
  setServerUrl: (url: string) => Promise<void>,
  isCustomServer: boolean,
  currentServerUrl: string,
): UseServerSelectionResult {
  const [customUrl, setCustomUrl] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const startEditing = useCallback(() => {
    if (isCustomServer && !isEditing) {
      setCustomUrl(currentServerUrl);
      setIsEditing(true);
    }
  }, [isCustomServer, isEditing, currentServerUrl]);

  const handleServerChange = useCallback(
    (value: string) => {
      if (value === "custom") {
        setShowCustomInput(true);
        setCustomUrl("");
        setIsEditing(false);
      } else {
        setShowCustomInput(false);
        setIsEditing(false);
        setServerUrl(value).catch((err) => {
          console.error("server change failed", err);
        });
      }
    },
    [setServerUrl],
  );

  const handleCustomUrlSubmit = useCallback(() => {
    if (customUrl.trim()) {
      setServerUrl(customUrl.trim().replace(/\/+$/, "")).catch((err) => {
        console.error("custom server submit failed", err);
      });
      setShowCustomInput(false);
      setIsEditing(false);
      setCustomUrl("");
    }
  }, [customUrl, setServerUrl]);

  const showInput = showCustomInput || isCustomServer;

  return {
    customUrl: isCustomServer && !isEditing ? currentServerUrl : customUrl,
    setCustomUrl: (url: string) => {
      startEditing();
      setCustomUrl(url);
    },
    showCustomInput: showInput,
    isEditing: isEditing || showCustomInput,
    handleServerChange,
    handleCustomUrlSubmit,
  };
}

interface ServerDiscoveryResult {
  fhirServer?: boolean;
  error?: string;
  udapEnabled: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  registered?: boolean;
  tieredOauthSupported?: boolean;
}

/**
 * Probes a custom server for UDAP support.
 * Only runs when the selected server is not in the configured server list.
 */
export function useServerDiscovery(
  serverUrl: string,
  isCustomServer: boolean,
  headers: CustomHeader[] = [],
) {
  return useQuery({
    queryKey: ["server-discovery", serverUrl, headers],
    queryFn: async (): Promise<ServerDiscoveryResult> => {
      const response = await fetch(
        `/api/servers/discover?${new URLSearchParams({ url: serverUrl })}`,
        applyCustomHeaders({ credentials: "include" }, headers, true),
      );
      if (!response.ok) return { udapEnabled: false };
      return response.json();
    },
    enabled: isCustomServer && !!serverUrl,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
}
