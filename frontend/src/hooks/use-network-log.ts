import { useMemo, useSyncExternalStore } from "react";
import { type NetworkLogEntry, networkLogStore } from "@/lib/network-log-store";

const emptyEntries: NetworkLogEntry[] = [];

export function useNetworkLog(serverFilter?: string) {
  const allEntries = useSyncExternalStore(
    networkLogStore.subscribe,
    networkLogStore.getSnapshot,
    () => emptyEntries,
  );

  const entries = useMemo(() => {
    if (!serverFilter) return allEntries;
    return allEntries.filter((e) => e.serverUrl === serverFilter);
  }, [allEntries, serverFilter]);

  return {
    entries,
    clear: networkLogStore.clear,
    entryCount: allEntries.length,
  };
}
