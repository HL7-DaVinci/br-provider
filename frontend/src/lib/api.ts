export const ACTIVE_PROVIDER_FHIR_BASE_HEADER = "X-Provider-Fhir-Base";

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
