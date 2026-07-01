export interface FhirServer {
  name: string;
  url: string;
  /**
   * Whether requests to this server must carry auth, and therefore route through the BFF proxy
   * for token injection. Defaults to true. Set false for open servers so the SPA's conformant
   * requests are sent directly, bypassing the proxy.
   */
  requiresAuth?: boolean;
}

export interface CdsServer {
  name: string;
  url: string;
}

export interface CustomAuthTarget {
  serverUrl: string;
  idp?: string;
}

export interface PayerServer {
  name: string;
  cdsUrl: string;
  fhirUrl: string;
  /**
   * Whether requests to this payer must carry B2B auth, and therefore route through the BFF
   * proxy. Defaults to true. Set false for open payer servers so conformant requests are sent
   * directly, bypassing the proxy.
   */
  requiresAuth?: boolean;
}

interface AppConfig {
  fhirServers?: FhirServer[];
  cdsServers?: CdsServer[];
  payerServers?: PayerServer[];
  providerServerUrl?: string;
  /** Provider rest-hook URL the payer posts PAS notifications to; defaults to the provider origin. */
  pasNotificationUrl?: string;
  authEnabled?: boolean;
}

declare global {
  interface Window {
    APP_CONFIG?: AppConfig;
  }
}

const DEFAULT_FHIR_SERVERS: FhirServer[] = [
  {
    name: "Local Provider Server",
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
const CUSTOM_AUTH_TARGET_STORAGE_KEY = "fhir-custom-auth-target";

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function matchesRequestUrl(
  requestUrl: string,
  serverUrl: string,
): boolean {
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

export function getStoredCustomAuthTarget(): CustomAuthTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = localStorage.getItem(CUSTOM_AUTH_TARGET_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.serverUrl !== "string" ||
      parsed.serverUrl.length === 0
    ) {
      return null;
    }

    const serverUrl = normalizeServerUrl(parsed.serverUrl);
    const idp =
      typeof parsed.idp === "string" && parsed.idp.length > 0
        ? normalizeServerUrl(parsed.idp)
        : undefined;

    return {
      serverUrl,
      ...(idp ? { idp } : {}),
    };
  } catch {
    return null;
  }
}

export function setStoredCustomAuthTarget(
  serverUrl: string,
  idp?: string,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedIdp = idp ? normalizeServerUrl(idp) : undefined;
  localStorage.setItem(
    CUSTOM_AUTH_TARGET_STORAGE_KEY,
    JSON.stringify({
      serverUrl: normalizeServerUrl(serverUrl),
      ...(normalizedIdp ? { idp: normalizedIdp } : {}),
    }),
  );
}

export function clearStoredCustomAuthTarget(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(CUSTOM_AUTH_TARGET_STORAGE_KEY);
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

export function getProviderFhirBaseUrl(): string | null {
  const providerServerUrl = getAppConfig().providerServerUrl;
  if (!providerServerUrl) {
    return null;
  }

  return normalizeServerUrl(`${providerServerUrl}/fhir`);
}

export function isProviderFhirRequestUrl(requestUrl: string): boolean {
  const providerFhirBaseUrl = getProviderFhirBaseUrl();
  if (!providerFhirBaseUrl) {
    return false;
  }

  return matchesRequestUrl(requestUrl, providerFhirBaseUrl);
}

export function getAppConfig(): AppConfig {
  return window?.APP_CONFIG ?? {};
}

/**
 * Provider rest-hook URL the payer posts PAS notifications to: the `pasNotificationUrl` config if
 * set, otherwise derived from the active provider FHIR base.
 */
export function getPasNotificationUrl(providerFhirBaseUrl: string): string {
  const configured = getAppConfig().pasNotificationUrl;
  if (configured) {
    return normalizeServerUrl(configured);
  }
  const origin = normalizeServerUrl(providerFhirBaseUrl).replace(/\/fhir$/, "");
  return `${origin}/api/pas/notification`;
}
