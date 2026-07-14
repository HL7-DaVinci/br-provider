import { useEffect } from "react";
import { toast } from "sonner";
import { networkLogStore } from "@/lib/network-log-store";
import {
  SERVER_ACTIVITY_URL,
  type ServerActivityEvent,
  serverActivityToLogEntry,
} from "@/lib/server-activity";

// Module-scoped so remounts (HMR, StrictMode) never re-add the same events.
const seenIds = new Set<string>();

let onViewActivity: (() => void) | undefined;

function addEvent(event: ServerActivityEvent, notify: boolean): void {
  if (seenIds.has(event.id)) return;
  seenIds.add(event.id);
  networkLogStore.addEntry(serverActivityToLogEntry(event));
  if (notify && event.category === "pas-decision") {
    toast.info("Prior authorization decision received", {
      description:
        "The payer pushed a subscription notification to the provider server.",
      action: onViewActivity
        ? { label: "View", onClick: () => onViewActivity?.() }
        : undefined,
    });
  }
}

/**
 * Streams server-to-server exchanges (e.g. inbound PAS subscription notifications) from the
 * provider server into the dev-tools network log, and raises a toast when a payer decision
 * arrives. Mount once at the app root; onView opens the dev-tools drawer from the toast.
 */
export function useServerActivityFeed(onView?: () => void): void {
  useEffect(() => {
    onViewActivity = onView;
  }, [onView]);

  useEffect(() => {
    const seed = () =>
      fetch(SERVER_ACTIVITY_URL)
        .then((res) => (res.ok ? res.json() : []))
        .then((events: ServerActivityEvent[]) => {
          for (const event of events) addEvent(event, false);
        })
        .catch(() => {});

    const source = new EventSource(`${SERVER_ACTIVITY_URL}/stream`);
    // Seed on every open (initial and auto-reconnect) so events that occurred while the stream
    // was down are backfilled from the server's buffer instead of silently lost.
    source.onopen = () => void seed();
    seed();
    source.addEventListener("activity", (e) => {
      try {
        addEvent(JSON.parse(e.data), true);
      } catch {}
    });
    return () => source.close();
  }, []);
}
