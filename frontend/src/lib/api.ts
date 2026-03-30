export const ACTIVE_PROVIDER_FHIR_BASE_HEADER = "X-Provider-Fhir-Base";

export const DTR_COMPLETION_CHANNEL = "dtr-completion";

/**
 * Constructs the BFF FHIR proxy URL for a given FHIR server URL.
 * All FHIR requests to authenticated servers should route through this proxy
 * so the BFF can inject auth tokens.
 */
export function fhirProxyUrl(
  fhirUrl: string,
  options?: { payer?: boolean },
): string {
  const params = new URLSearchParams({ url: fhirUrl });
  if (options?.payer) params.set("payer", "true");
  return `/api/fhir-proxy?${params}`;
}

/**
 * Creates a SMART launch context via the BFF and opens the resulting URL.
 * Centralizes the POST /api/smart/launch + window.open pattern.
 */
export async function launchSmartApp(
  params: Record<string, unknown>,
): Promise<void> {
  const response = await fetch("/api/smart/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error("Failed to create SMART launch context");
  }

  const { launchUrl } = await response.json();
  window.open(
    new URL(launchUrl, window.location.origin).toString(),
    "_blank",
    "noopener",
  );
}
