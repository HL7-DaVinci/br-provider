import { getServerByRequestUrl, matchesRequestUrl } from "./fhir-config";
import { getPayerServers } from "./payer-config";

/**
 * Whether a FHIR request must carry auth, and therefore route through the BFF proxy for token
 * injection. A server (provider or payer) explicitly configured with `requiresAuth: false` is
 * treated as open; any unrecognized or unflagged target defaults to requiring auth.
 */
export function targetRequiresAuth(requestUrl: string): boolean {
  const provider = getServerByRequestUrl(requestUrl);
  if (provider?.requiresAuth === false) {
    return false;
  }
  const openPayer = getPayerServers().some(
    (payer) =>
      payer.requiresAuth === false &&
      (matchesRequestUrl(requestUrl, payer.fhirUrl) ||
        matchesRequestUrl(requestUrl, payer.cdsUrl)),
  );
  return !openPayer;
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
  if (options?.payer) params.set("payer", "true");
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

/**
 * Sends a conformant FHIR request to a target, routing through the BFF proxy (auth injected) when
 * the server requires auth, or directly when it is open, and setting credentials to match the
 * transport. The single network chokepoint for SPA-built FHIR requests: the request body, method,
 * and headers are identical regardless of transport.
 */
export async function fhirSend(
  fhirUrl: string,
  init?: RequestInit,
  proxyOptions?: { payer?: boolean; op?: string },
): Promise<Response> {
  const url = fhirProxyUrl(fhirUrl, proxyOptions);
  return fetch(url, { ...init, credentials: credentialsFor(url) });
}
