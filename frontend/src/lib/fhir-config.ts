export interface CustomHeader {
  name: string;
  value: string;
}

export type PayerAuthMode = "auto" | "open" | "udap-b2b" | "smart-backend";

const PAYER_AUTH_MODES: readonly PayerAuthMode[] = [
  "auto",
  "open",
  "udap-b2b",
  "smart-backend",
];

export const DISALLOWED_HEADER_NAMES = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-authenticate",
]);

/** RFC 7230 token rule: the character set `Headers.set()` accepts for a header name. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

export function isValidHeaderName(name: string): boolean {
  return HEADER_NAME_PATTERN.test(name);
}

/** `Headers.set()` rejects CR, LF, and NUL in a header value. */
export function hasInvalidHeaderValueChars(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

export function sanitizeCustomHeaders(
  value: unknown,
): CustomHeader[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  const headers: CustomHeader[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as CustomHeader).name;
    const headerValue = (entry as CustomHeader).value;
    if (typeof name !== "string" || typeof headerValue !== "string") continue;
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    if (!lower || DISALLOWED_HEADER_NAMES.has(lower) || seen.has(lower)) {
      continue;
    }
    if (
      !isValidHeaderName(trimmed) ||
      hasInvalidHeaderValueChars(headerValue)
    ) {
      continue;
    }
    seen.add(lower);
    headers.push({ name: trimmed, value: headerValue });
  }
  return headers.length > 0 ? headers : undefined;
}

export function sanitizePayerAuthMode(
  value: unknown,
): PayerAuthMode | undefined {
  return PAYER_AUTH_MODES.includes(value as PayerAuthMode)
    ? (value as PayerAuthMode)
    : undefined;
}

export interface FhirServer {
  name: string;
  url: string;
  /**
   * Whether requests to this server must carry auth, and therefore route through the BFF proxy
   * for token injection. Defaults to true. Set false for open servers so the SPA's conformant
   * requests are sent directly, bypassing the proxy.
   */
  requiresAuth?: boolean;
  /** Custom headers forwarded to this server on every request. */
  headers?: CustomHeader[];
}

export interface CdsServer {
  name: string;
  url: string;
}

export interface CustomAuthTarget {
  serverUrl: string;
  idp?: string;
  headers?: CustomHeader[];
  authMode?: "udap" | "smart";
  clientId?: string;
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
  /**
   * Sends the X-Bypass-Payor-Check test header on requests to this payer, asking it to skip
   * payor-handled enforcement for the EHR's Coverage payor (including identifier-less payors
   * and multiple-Coverage patients). Supported by the BR payer reference implementation; other
   * payers ignore or reject the header.
   */
  bypassPayorCheck?: boolean;
  /**
   * How outbound requests to this payer authenticate. "auto" tries tokenless
   * and falls back to B2B. "open" sends direct unauthenticated requests.
   * "udap-b2b" always injects a UDAP B2B token. "smart-backend" always
   * injects a SMART Backend Services token. Wins over requiresAuth.
   */
  authMode?: PayerAuthMode;
  /**
   * Client ID this deployment is registered under with the payer. Required by
   * "smart-backend", which cannot register dynamically. Ignored by the other
   * modes.
   */
  clientId?: string;
  headers?: CustomHeader[];
}

export function resolvePayerAuthMode(server: PayerServer): PayerAuthMode {
  if (server.authMode) {
    return server.authMode;
  }
  if (server.requiresAuth === false) {
    return "open";
  }
  if (server.requiresAuth === true) {
    return "udap-b2b";
  }
  return "auto";
}

interface AppConfig {
  fhirServers?: FhirServer[];
  cdsServers?: CdsServer[];
  payerServers?: PayerServer[];
  /**
   * Base URL of this app's own backend (BFF): /auth, /api, the CDS relay, and the local OAuth
   * IdP. NOT a FHIR endpoint; the active FHIR server may live on a different domain.
   */
  apiBaseUrl?: string;
  /** Provider rest-hook URL the payer posts PAS notifications to; defaults to the provider origin. */
  pasNotificationUrl?: string;
  authEnabled?: boolean;
  providerOrgIdentifier?: string;
  providerOrgIdentifierSystem?: string;
  payerOrgIdentifier?: string;
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
const CUSTOM_OPEN_SERVER_STORAGE_KEY = "fhir-custom-open-server";

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
    const headers = sanitizeCustomHeaders(parsed.headers);
    const authMode =
      parsed.authMode === "udap" || parsed.authMode === "smart"
        ? parsed.authMode
        : undefined;
    const clientId =
      typeof parsed.clientId === "string" && parsed.clientId.length > 0
        ? parsed.clientId
        : undefined;

    return {
      serverUrl,
      ...(idp ? { idp } : {}),
      ...(headers ? { headers } : {}),
      ...(authMode ? { authMode } : {}),
      ...(clientId ? { clientId } : {}),
    };
  } catch {
    return null;
  }
}

export function setStoredCustomAuthTarget(
  serverUrl: string,
  idp?: string,
  headers?: CustomHeader[],
  authMode?: "udap" | "smart",
  clientId?: string,
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
      ...(headers?.length ? { headers } : {}),
      ...(authMode ? { authMode } : {}),
      ...(clientId ? { clientId } : {}),
    }),
  );
}

export function clearStoredCustomAuthTarget(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(CUSTOM_AUTH_TARGET_STORAGE_KEY);
  }
}

export function setStoredCustomOpenServer(
  url: string,
  headers?: CustomHeader[],
): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(
    CUSTOM_OPEN_SERVER_STORAGE_KEY,
    JSON.stringify({
      url: normalizeServerUrl(url),
      ...(headers?.length ? { headers } : {}),
    }),
  );
}

export function clearStoredCustomOpenServer(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(CUSTOM_OPEN_SERVER_STORAGE_KEY);
  }
}

export function getStoredCustomOpenServer(): {
  url: string;
  headers?: CustomHeader[];
} | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = localStorage.getItem(CUSTOM_OPEN_SERVER_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.url !== "string" ||
      parsed.url.length === 0
    ) {
      return null;
    }
    const headers = sanitizeCustomHeaders(parsed.headers);
    return {
      url: normalizeServerUrl(parsed.url),
      ...(headers ? { headers } : {}),
    };
  } catch {
    return null;
  }
}

export function isStoredCustomOpenServer(url: string): boolean {
  return getStoredCustomOpenServer()?.url === normalizeServerUrl(url);
}

const SERVER_HEADERS_STORAGE_KEY = "fhir-server-headers";

function readStoredServerHeadersRecord(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SERVER_HEADERS_STORAGE_KEY) ?? "{}",
    );
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt blob reads as empty
  }
  return {};
}

/**
 * Custom headers keyed by server base URL. Applies to preset and custom
 * provider servers alike, so every configuration can carry headers.
 */
export function getStoredServerHeaders(url: string): CustomHeader[] {
  if (typeof window === "undefined") {
    return [];
  }
  const record = readStoredServerHeadersRecord();
  return sanitizeCustomHeaders(record[normalizeServerUrl(url)]) ?? [];
}

export function setStoredServerHeaders(
  url: string,
  headers?: CustomHeader[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const record = readStoredServerHeadersRecord();
  const key = normalizeServerUrl(url);
  if (headers?.length) {
    record[key] = headers;
  } else {
    delete record[key];
  }
  localStorage.setItem(SERVER_HEADERS_STORAGE_KEY, JSON.stringify(record));
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

  const authTarget = getStoredCustomAuthTarget();
  const openServer = getStoredCustomOpenServer();
  const headers =
    authTarget?.serverUrl === currentServerUrl
      ? authTarget.headers
      : openServer?.url === currentServerUrl
        ? openServer.headers
        : undefined;

  return (
    getServerByUrl(currentServerUrl) ?? {
      name: CUSTOM_SERVER_NAME,
      url: currentServerUrl,
      ...(openServer?.url === currentServerUrl ? { requiresAuth: false } : {}),
      ...(headers ? { headers } : {}),
    }
  );
}

export function getAppConfig(): AppConfig {
  return window?.APP_CONFIG ?? {};
}

/** Base URL of this app's own backend (BFF). */
export function getApiBaseUrl(): string | undefined {
  return getAppConfig().apiBaseUrl;
}

/**
 * Provider rest-hook URL the payer posts PAS notifications to: the `pasNotificationUrl` config if
 * set, otherwise derived from this app's own API base URL (never the active provider FHIR base,
 * which may point at an external EHR that can't receive the webhook). Always carries an `ehr`
 * query param (the active provider FHIR base) so the backend knows which server to write the
 * decision to.
 */
export function getPasNotificationUrl(providerFhirBaseUrl: string): string {
  const configured = getAppConfig().pasNotificationUrl;
  const base = configured
    ? normalizeServerUrl(configured)
    : `${normalizeServerUrl(getApiBaseUrl() ?? window.location.origin)}/api/pas/notification`;
  const separator = base.includes("?") ? "&" : "?";
  const ehr = encodeURIComponent(normalizeServerUrl(providerFhirBaseUrl));
  return `${base}${separator}ehr=${ehr}`;
}
