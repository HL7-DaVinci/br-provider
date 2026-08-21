import type { ClaimResponse } from "fhir/r4";

const REVIEW_ACTION_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction";
const REVIEW_ACTION_CODE_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode";
const X12_306_SYSTEM = "https://codesystem.x12.org/005010/306";

export type PasDecision =
  | "approved"
  | "partial"
  | "denied"
  | "pended"
  | "unknown";

/**
 * Collects the X12 306 review action codes from
 * item.adjudication[].extension(reviewAction).extension(reviewActionCode). Codings with the X12 306
 * system or no system are accepted.
 */
export function getReviewActionCodes(cr: ClaimResponse): string[] {
  const codes: string[] = [];
  for (const item of cr.item ?? []) {
    for (const adjudication of item.adjudication ?? []) {
      for (const extension of adjudication.extension ?? []) {
        if (extension.url !== REVIEW_ACTION_EXT) continue;
        for (const subExtension of extension.extension ?? []) {
          if (subExtension.url !== REVIEW_ACTION_CODE_EXT) continue;
          for (const coding of subExtension.valueCodeableConcept?.coding ??
            []) {
            if (
              coding.code &&
              (!coding.system || coding.system === X12_306_SYSTEM)
            ) {
              codes.push(coding.code);
            }
          }
        }
      }
    }
  }
  return codes;
}

/**
 * Derives the prior authorization decision from the item review action codes (X12 306: A1 certified
 * in total, A2 certified partial, A3 not certified, A4 pended, A6 modified, C cancelled). PAS
 * denials arrive as outcome=complete plus A3 items, so ClaimResponse.outcome is only a fallback
 * when no review action codes are present.
 */
export function derivePasDecision(cr: ClaimResponse): PasDecision {
  const codes = getReviewActionCodes(cr);
  if (codes.includes("A4")) return "pended";
  if (codes.length > 0) {
    const denied = codes.filter((c) => c === "A3" || c === "C");
    if (denied.length === codes.length) return "denied";
    if (denied.length > 0 || codes.includes("A6")) return "partial";
    return "approved";
  }
  switch (cr.outcome) {
    case "complete":
      return "approved";
    case "error":
      return "denied";
    case "partial":
    case "queued":
      return "pended";
    default:
      return "unknown";
  }
}

/**
 * True when a ClaimResponse represents a pended prior authorization: the profile-valid signal is
 * item review action code A4; outcome=queued is tolerated as a legacy/transitional signal.
 */
export function isPendedClaimResponse(cr: ClaimResponse): boolean {
  if (cr.outcome === "queued") return true;
  return getReviewActionCodes(cr).includes("A4");
}
