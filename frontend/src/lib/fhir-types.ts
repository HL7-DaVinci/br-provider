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
