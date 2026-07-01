import { useAuth } from "@/hooks/use-auth";
import { getUserInfo } from "@/lib/auth";

const PRACTITIONER_REF_RE = /(Practitioner(?:Role)?\/[^/?#]+)/;

function refFromFhirUser(fhirUser: string | undefined): string | undefined {
  return fhirUser?.match(PRACTITIONER_REF_RE)?.[1];
}

/**
 * Returns the launching user's resource as a relative reference
 * ("Practitioner/<id>" or "PractitionerRole/<id>"), derived from the SMART
 * fhirUser claim. Returns undefined when the claim is absent (e.g. non-SMART
 * dev launches) or references a resource type that isn't Practitioner /
 * PractitionerRole.
 */
export function usePractitionerRef(): string | undefined {
  return refFromFhirUser(useAuth().fhirUser);
}

/** Non-hook accessor for the launching user's Practitioner/PractitionerRole reference. */
export function getStoredPractitionerRef(): string | undefined {
  return refFromFhirUser(getUserInfo()?.fhirUser);
}
