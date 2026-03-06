export interface FhirServer {
  name: string;
  url: string;
}

export interface CdsServer {
  name: string;
  url: string;
}

interface AppConfig {
  fhirServers?: FhirServer[];
  cdsServers?: CdsServer[];
}

declare global {
  interface Window {
    APP_CONFIG?: AppConfig;
  }
}

const DEFAULT_FHIR_SERVERS: FhirServer[] = [
  {
    name: "Local Server",
    url: "http://localhost:8080/fhir",
  },
];
const CUSTOM_SERVER_NAME = "Custom Server";

function isValidFhirServer(server: unknown): server is FhirServer {
  return (
    typeof server === "object" &&
    server !== null &&
    typeof (server as FhirServer).name === "string" &&
    typeof (server as FhirServer).url === "string"
  );
}

function parseFhirServers(): FhirServer[] {
  if (
    window?.APP_CONFIG?.fhirServers &&
    Array.isArray(window.APP_CONFIG.fhirServers)
  ) {
    const servers = window.APP_CONFIG.fhirServers.filter(isValidFhirServer);
    if (servers.length > 0) {
      return servers;
    }
  }

  const envServers = import.meta.env.VITE_FHIR_SERVERS;
  if (envServers) {
    try {
      const parsed = JSON.parse(envServers);
      if (Array.isArray(parsed)) {
        const servers = parsed.filter(isValidFhirServer);
        if (servers.length > 0) {
          return servers;
        }
      }
    } catch {
      console.warn("Failed to parse VITE_FHIR_SERVERS, using defaults");
    }
  }

  return DEFAULT_FHIR_SERVERS;
}

export const FHIR_SERVERS: FhirServer[] = parseFhirServers();

const STORAGE_KEY = "fhir-server-url";

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function matchesRequestUrl(requestUrl: string, serverUrl: string): boolean {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  if (!requestUrl.startsWith(normalizedServerUrl)) {
    return false;
  }

  const boundary = requestUrl.charAt(normalizedServerUrl.length);
  return !boundary || boundary === "/" || boundary === "?" || boundary === "#";
}

export function getStoredServerUrl(): string {
  if (typeof window === "undefined") {
    return normalizeServerUrl(FHIR_SERVERS[0].url);
  }

  return normalizeServerUrl(
    localStorage.getItem(STORAGE_KEY) || FHIR_SERVERS[0].url,
  );
}

export function setStoredServerUrl(url: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, normalizeServerUrl(url));
  }
}

export function getServerByUrl(url: string): FhirServer | undefined {
  const normalizedUrl = normalizeServerUrl(url);
  return FHIR_SERVERS.find(
    (server) => normalizeServerUrl(server.url) === normalizedUrl,
  );
}

export function getServerByRequestUrl(
  requestUrl: string,
): FhirServer | undefined {
  const presetServer = FHIR_SERVERS.find((server) =>
    matchesRequestUrl(requestUrl, server.url),
  );
  if (presetServer) {
    return presetServer;
  }

  const currentServerUrl = getStoredServerUrl();
  if (!matchesRequestUrl(requestUrl, currentServerUrl)) {
    return undefined;
  }

  return (
    getServerByUrl(currentServerUrl) ?? {
      name: CUSTOM_SERVER_NAME,
      url: currentServerUrl,
    }
  );
}
