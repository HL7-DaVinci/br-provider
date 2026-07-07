import type { NetworkLogEntry } from "@/lib/network-log-store";

/** Server-to-server exchange recorded by the provider server's DevActivityController. */
export interface ServerActivityEvent {
  id: string;
  timestamp: number;
  direction: "inbound" | "outbound";
  method: string;
  url: string;
  status: number;
  operationName: string;
  category: string;
  requestBody: unknown;
  responseBody: unknown;
}

export const SERVER_ACTIVITY_URL = "/api/dev/activity";

export function serverActivityToLogEntry(
  event: ServerActivityEvent,
): NetworkLogEntry {
  return {
    id: `server-${event.id}`,
    timestamp: event.timestamp,
    method: event.method,
    url: event.url,
    serverUrl: "",
    serverName:
      event.direction === "inbound" ? "Payer → Provider" : "Provider → Payer",
    resourceType: null,
    status: event.status,
    duration: 0,
    responseBody: event.responseBody,
    requestBody: event.requestBody,
    error: event.status >= 400,
    operationName: event.operationName,
    source: "server",
  };
}
