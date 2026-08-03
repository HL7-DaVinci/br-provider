import {
  type CustomHeader,
  normalizeServerUrl,
  type PayerAuthMode,
  sanitizeCustomHeaders,
  sanitizePayerAuthMode,
} from "./fhir-config";

/**
 * Auto-saved recent server configurations. Entries only prefill the settings
 * forms. They never feed auth logic directly. Parsing is lenient so future
 * fields (for example authMode "smart") appear without migration.
 */

export interface ProviderRecent {
  url: string;
  idp?: string;
  authMode?: "open" | "udap" | "smart";
  clientId?: string;
  headers?: CustomHeader[];
}

export interface PayerRecent {
  name: string;
  cdsUrl: string;
  fhirUrl: string;
  authMode?: PayerAuthMode;
  clientId?: string;
  bypassPayorCheck?: boolean;
  headers?: CustomHeader[];
}

const PROVIDER_RECENTS_KEY = "fhir-server-recents";
const PAYER_RECENTS_KEY = "payer-server-recents";
const MAX_RECENTS = 10;

function readList(key: string): unknown[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(list.slice(0, MAX_RECENTS)));
  }
}

function parseProviderRecent(entry: unknown): ProviderRecent | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  if (typeof raw.url !== "string" || raw.url.length === 0) {
    return null;
  }
  const headers = sanitizeCustomHeaders(raw.headers);
  return {
    url: normalizeServerUrl(raw.url),
    ...(typeof raw.idp === "string" && raw.idp ? { idp: raw.idp } : {}),
    ...(raw.authMode === "open" ||
    raw.authMode === "udap" ||
    raw.authMode === "smart"
      ? { authMode: raw.authMode }
      : {}),
    ...(typeof raw.clientId === "string" && raw.clientId
      ? { clientId: raw.clientId }
      : {}),
    ...(headers ? { headers } : {}),
  };
}

function parsePayerRecent(entry: unknown): PayerRecent | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  if (
    typeof raw.name !== "string" ||
    typeof raw.cdsUrl !== "string" ||
    typeof raw.fhirUrl !== "string"
  ) {
    return null;
  }
  const headers = sanitizeCustomHeaders(raw.headers);
  const authMode = sanitizePayerAuthMode(raw.authMode);
  return {
    name: raw.name,
    cdsUrl: normalizeServerUrl(raw.cdsUrl),
    fhirUrl: normalizeServerUrl(raw.fhirUrl),
    ...(authMode ? { authMode } : {}),
    ...(typeof raw.clientId === "string" && raw.clientId
      ? { clientId: raw.clientId }
      : {}),
    ...(raw.bypassPayorCheck === true ? { bypassPayorCheck: true } : {}),
    ...(headers ? { headers } : {}),
  };
}

export function getProviderRecents(): ProviderRecent[] {
  return readList(PROVIDER_RECENTS_KEY)
    .map(parseProviderRecent)
    .filter((entry): entry is ProviderRecent => entry !== null);
}

export function addProviderRecent(entry: ProviderRecent): void {
  const normalized = { ...entry, url: normalizeServerUrl(entry.url) };
  const rest = getProviderRecents().filter(
    (recent) => recent.url !== normalized.url,
  );
  writeList(PROVIDER_RECENTS_KEY, [normalized, ...rest]);
}

export function removeProviderRecent(url: string): void {
  const normalized = normalizeServerUrl(url);
  writeList(
    PROVIDER_RECENTS_KEY,
    getProviderRecents().filter((recent) => recent.url !== normalized),
  );
}

export function getPayerRecents(): PayerRecent[] {
  return readList(PAYER_RECENTS_KEY)
    .map(parsePayerRecent)
    .filter((entry): entry is PayerRecent => entry !== null);
}

export function addPayerRecent(entry: PayerRecent): void {
  const normalized = {
    ...entry,
    cdsUrl: normalizeServerUrl(entry.cdsUrl),
    fhirUrl: normalizeServerUrl(entry.fhirUrl),
  };
  const rest = getPayerRecents().filter(
    (recent) =>
      recent.fhirUrl !== normalized.fhirUrl ||
      recent.cdsUrl !== normalized.cdsUrl,
  );
  writeList(PAYER_RECENTS_KEY, [normalized, ...rest]);
}

export function removePayerRecent(fhirUrl: string, cdsUrl: string): void {
  const fhir = normalizeServerUrl(fhirUrl);
  const cds = normalizeServerUrl(cdsUrl);
  writeList(
    PAYER_RECENTS_KEY,
    getPayerRecents().filter(
      (recent) => recent.fhirUrl !== fhir || recent.cdsUrl !== cds,
    ),
  );
}
