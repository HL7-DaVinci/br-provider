import type { ClaimResponse } from "fhir/r4";

const REVIEW_ACTION_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction";
const REVIEW_ACTION_CODE_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode";
const X12_306_SYSTEM = "https://codesystem.x12.org/005010/306";
const REVIEW_ACTION_CODE_PEND = "A4";

/**
 * True when a ClaimResponse represents a pended prior authorization: the profile-valid signal is
 * item.adjudication[].extension(reviewAction).extension(reviewActionCode) coding A4 from the X12
 * 306 codesystem; outcome=queued is tolerated as a legacy/transitional signal.
 */
export function isPendedClaimResponse(cr: ClaimResponse): boolean {
  if (cr.outcome === "queued") return true;
  return (cr.item ?? []).some((item) =>
    (item.adjudication ?? []).some((adjudication) =>
      (adjudication.extension ?? [])
        .filter((extension) => extension.url === REVIEW_ACTION_EXT)
        .some((reviewAction) =>
          (reviewAction.extension ?? []).some(
            (subExtension) =>
              subExtension.url === REVIEW_ACTION_CODE_EXT &&
              subExtension.valueCodeableConcept?.coding?.some(
                (coding) =>
                  coding.system === X12_306_SYSTEM &&
                  coding.code === REVIEW_ACTION_CODE_PEND,
              ),
          ),
        ),
    ),
  );
}
