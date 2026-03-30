import { networkLogStore } from "./network-log-store";
import { getPayerByUrl } from "./payer-config";

export interface LoggedFetchMeta {
  /** Payer URL (CDS or FHIR) used to resolve payer name for display */
  payerUrl: string;
  /** Human-readable operation label shown in the dev tools drawer */
  operationName: string;
}

/**
 * Wraps fetch() with network log capture for payer-bound proxy requests.
 * Logs timing, status, request body, and response body to the dev tools
 * network drawer. Returns the raw Response so callers can parse as needed.
 */
export async function loggedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  meta: LoggedFetchMeta,
): Promise<Response> {
  const startTime = Date.now();
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";
  const payer = getPayerByUrl(meta.payerUrl);

  let requestBody: unknown = null;
  if (init?.body && typeof init.body === "string") {
    try {
      requestBody = JSON.parse(init.body);
    } catch {
      requestBody = init.body;
    }
  }

  const baseEntry = {
    id: crypto.randomUUID(),
    timestamp: startTime,
    method,
    url,
    serverUrl: payer?.fhirUrl ?? "",
    serverName: payer?.name ?? "Unknown Payer",
    resourceType: null,
    operationName: meta.operationName,
    requestBody,
  };

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    networkLogStore.addEntry({
      ...baseEntry,
      status: null,
      duration: Date.now() - startTime,
      responseBody:
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { message: "Network error" },
      error: true,
    });
    throw error;
  }

  const cloned = response.clone();
  let responseBody: unknown = null;
  try {
    responseBody = await cloned.json();
  } catch {
    // Response wasn't JSON
  }

  networkLogStore.addEntry({
    ...baseEntry,
    status: response.status,
    duration: Date.now() - startTime,
    responseBody,
    error: !response.ok,
  });

  return response;
}
