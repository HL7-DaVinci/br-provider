import {
  type CustomHeader,
  getServerByRequestUrl,
  getStoredServerHeaders,
  matchesRequestUrl,
  type PayerServer,
  resolvePayerAuthMode,
} from "./fhir-config";
import { getPayerServers, getStoredPayerServer } from "./payer-config";

/**
 * Finds the payer server config matching a request URL by its FHIR or CDS base, preferring the
 * stored payer over the static preset list when both match.
 */
export function payerForRequestUrl(
  requestUrl: string,
): PayerServer | undefined {
  const matches = (payer: PayerServer) =>
    matchesRequestUrl(requestUrl, payer.fhirUrl) ||
    matchesRequestUrl(requestUrl, payer.cdsUrl);
  const stored = getStoredPayerServer();
  if (matches(stored)) {
    return stored;
  }
  return getPayerServers().find(matches);
}

/**
 * Whether a FHIR request must carry auth, and therefore route through the BFF proxy for token
 * injection. A provider server explicitly configured with `requiresAuth: false` is treated as
 * open. A payer server is open only when its resolved auth mode ({@link resolvePayerAuthMode}) is
 * "open"; any unrecognized or unflagged target defaults to requiring auth.
 */
export function targetRequiresAuth(requestUrl: string): boolean {
  const provider = getServerByRequestUrl(requestUrl);
  if (provider?.requiresAuth === false) {
    return false;
  }
  const payer = payerForRequestUrl(requestUrl);
  return !(payer && resolvePayerAuthMode(payer) === "open");
}

/**
 * Constructs the URL a conformant FHIR request should be sent to. Requests to servers that
 * require auth route through the BFF proxy so it can inject the credential the browser cannot
 * hold (session token, or a payer B2B token scoped by `op`). Requests to open servers
 * (`requiresAuth: false`) are returned verbatim, so the request goes directly to the server and
 * fully bypasses the proxy. The request body/method/headers are identical either way; only the
 * URL changes.
 */
export function fhirProxyUrl(
  fhirUrl: string,
  options?: { payer?: boolean; op?: string },
): string {
  if (!targetRequiresAuth(fhirUrl)) {
    return fhirUrl;
  }
  const params = new URLSearchParams({ url: fhirUrl });
  if (options?.payer) {
    params.set("payer", "true");
    const payer = payerForRequestUrl(fhirUrl);
    if (payer && resolvePayerAuthMode(payer) === "udap-b2b") {
      params.set("auth", "b2b");
    }
  }
  if (options?.op) params.set("op", options.op);
  return `/api/fhir-proxy?${params}`;
}

/**
 * Credentials mode for a URL produced by {@link fhirProxyUrl}. The same-origin BFF (a relative
 * `/api/...` URL) needs the session cookie (`include`); a direct bypass call to an open server (an
 * absolute `http(s)` URL) must omit credentials so it is compatible with a wildcard CORS policy.
 */
export function credentialsFor(url: string): RequestCredentials {
  return /^https?:\/\//.test(url) ? "omit" : "include";
}

/** Prefix applied to custom header names when a request is proxied through the BFF. */
export const FORWARD_PREFIX = "X-Fwd-";

/**
 * Provider custom headers configured for a request's target.
 */
export function providerHeadersFor(requestUrl: string): CustomHeader[] {
  const provider = getServerByRequestUrl(requestUrl);
  if (!provider) {
    return [];
  }
  const stored = getStoredServerHeaders(provider.url);
  if (stored.length) {
    return stored;
  }
  return provider.headers ?? [];
}

/**
 * Custom headers configured for a request's target, preferring a matching payer server over a
 * matching provider server.
 */
export function customHeadersFor(requestUrl: string): CustomHeader[] {
  const payer = payerForRequestUrl(requestUrl);
  return payer?.headers?.length
    ? payer.headers
    : providerHeadersFor(requestUrl);
}

/**
 * Merges custom headers into a request init, prefixing names with {@link FORWARD_PREFIX} when the
 * request is proxied so the BFF knows to forward them. Returns `init` unchanged when there are no
 * custom headers to apply.
 */
export function applyCustomHeaders(
  init: RequestInit | undefined,
  custom: CustomHeader[],
  proxied: boolean,
): RequestInit | undefined {
  if (custom.length === 0) {
    return init;
  }
  const headers = new Headers(init?.headers);
  for (const header of custom) {
    headers.set(
      proxied ? `${FORWARD_PREFIX}${header.name}` : header.name,
      header.value,
    );
  }
  return { ...init, headers };
}

/**
 * Sends a conformant FHIR request to a target, routing through the BFF proxy (auth injected) when
 * the server requires auth, or directly when it is open, and setting credentials to match the
 * transport. The single network chokepoint for SPA-built FHIR requests: the request body and
 * method are identical regardless of transport, and any per-server custom headers are attached
 * here, prefixed `X-Fwd-` when the request is proxied.
 */
export async function fhirSend(
  fhirUrl: string,
  init?: RequestInit,
  proxyOptions?: { payer?: boolean; op?: string },
): Promise<Response> {
  const url = fhirProxyUrl(fhirUrl, proxyOptions);
  const proxied = url !== fhirUrl;
  const withCustom = applyCustomHeaders(
    init,
    customHeadersFor(fhirUrl),
    proxied,
  );
  return fetch(url, { ...withCustom, credentials: credentialsFor(url) });
}
