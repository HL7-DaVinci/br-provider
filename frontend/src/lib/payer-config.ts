import { normalizeServerUrl, type PayerServer } from "./fhir-config";

const DEFAULT_PAYER_SERVERS: PayerServer[] = [
  {
    name: "Local Payer Server",
    cdsUrl: "http://localhost:8081/cds-services",
    fhirUrl: "http://localhost:8081/fhir",
    requiresAuth: false,
  },
];

const PAYER_STORAGE_KEY = "payer-server";

function isValidPayerServer(server: unknown): server is PayerServer {
  return (
    typeof server === "object" &&
    server !== null &&
    typeof (server as PayerServer).name === "string" &&
    typeof (server as PayerServer).cdsUrl === "string" &&
    typeof (server as PayerServer).fhirUrl === "string"
  );
}

export function getPayerServers(): PayerServer[] {
  if (
    window?.APP_CONFIG?.payerServers &&
    Array.isArray(window.APP_CONFIG.payerServers)
  ) {
    const servers = window.APP_CONFIG.payerServers.filter(isValidPayerServer);
    if (servers.length > 0) {
      return servers;
    }
  }
  return DEFAULT_PAYER_SERVERS;
}

export function getStoredPayerServer(): PayerServer {
  if (typeof window === "undefined") {
    return getPayerServers()[0];
  }

  const stored = localStorage.getItem(PAYER_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (isValidPayerServer(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to default
    }
  }

  return getPayerServers()[0];
}

export function getPayerByUrl(url: string): PayerServer | undefined {
  const normalized = normalizeServerUrl(url);
  const matches = (s: PayerServer) =>
    normalizeServerUrl(s.fhirUrl) === normalized ||
    normalizeServerUrl(s.cdsUrl) === normalized;

  // The stored payer carries user-set flags (bypassPayorCheck) that the static
  // preset list does not, so it wins when both match.
  const stored = getStoredPayerServer();
  if (matches(stored)) {
    return stored;
  }
  return getPayerServers().find(matches);
}

export function setStoredPayerServer(server: PayerServer): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(
      PAYER_STORAGE_KEY,
      JSON.stringify({
        name: server.name,
        cdsUrl: normalizeServerUrl(server.cdsUrl),
        fhirUrl: normalizeServerUrl(server.fhirUrl),
        ...(server.requiresAuth !== undefined
          ? { requiresAuth: server.requiresAuth }
          : {}),
        ...(server.bypassPayorCheck ? { bypassPayorCheck: true } : {}),
      }),
    );
  }
}
