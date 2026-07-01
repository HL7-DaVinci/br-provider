import type { Bundle, OperationOutcome } from "fhir/r4";

export function bundleResources<T>(bundle?: Bundle<T>): T[] {
  return bundle?.entry?.map((e) => e.resource).filter((r): r is T => !!r) ?? [];
}

export function isOperationOutcome(
  resource: unknown,
): resource is OperationOutcome {
  return (
    typeof resource === "object" &&
    resource !== null &&
    "resourceType" in resource &&
    resource.resourceType === "OperationOutcome"
  );
}

/**
 * Extracts a human-readable error message from a proxy or payer error body: the BFF `{ error }`
 * envelope, or an OperationOutcome's diagnostics. Returns undefined when neither is present, so
 * callers can fall back to a generic message.
 */
export function extractFhirError(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (isOperationOutcome(body)) {
    const diagnostics = body.issue
      ?.map((issue) => issue.diagnostics)
      .filter((d): d is string => !!d);
    if (diagnostics && diagnostics.length > 0) return diagnostics.join("; ");
  }
  return undefined;
}
