import type { ClaimResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { isPendedClaimResponse } from "./pas-pend-status";

const REVIEW_ACTION_CODE =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode";
const X12_306 = "https://codesystem.x12.org/005010/306";

function crWithReviewAction(code: string): ClaimResponse {
  return {
    resourceType: "ClaimResponse",
    status: "active",
    outcome: "complete",
    item: [
      {
        itemSequence: 1,
        adjudication: [
          {
            category: { coding: [{ code: "submitted" }] },
            extension: [
              {
                url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction",
                extension: [
                  {
                    url: REVIEW_ACTION_CODE,
                    valueCodeableConcept: {
                      coding: [{ system: X12_306, code }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as ClaimResponse;
}

describe("isPendedClaimResponse", () => {
  it("detects a pend from outcome complete plus item reviewAction A4", () => {
    expect(isPendedClaimResponse(crWithReviewAction("A4"))).toBe(true);
  });

  it("does not flag approved items as pended", () => {
    expect(isPendedClaimResponse(crWithReviewAction("A1"))).toBe(false);
  });

  it("still detects legacy outcome=queued during the transition", () => {
    expect(
      isPendedClaimResponse({
        resourceType: "ClaimResponse",
        outcome: "queued",
      } as ClaimResponse),
    ).toBe(true);
  });
});
