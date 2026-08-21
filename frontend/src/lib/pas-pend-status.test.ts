import type { ClaimResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { derivePasDecision, isPendedClaimResponse } from "./pas-pend-status";

const REVIEW_ACTION_CODE =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode";
const X12_306 = "https://codesystem.x12.org/005010/306";

function crWithReviewActions(
  codes: string[],
  system: string | undefined = X12_306,
): ClaimResponse {
  return {
    resourceType: "ClaimResponse",
    status: "active",
    outcome: "complete",
    item: codes.map((code, index) => ({
      itemSequence: index + 1,
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
                    coding: [{ system, code }],
                  },
                },
              ],
            },
          ],
        },
      ],
    })),
  } as ClaimResponse;
}

function crWithReviewAction(code: string): ClaimResponse {
  return crWithReviewActions([code]);
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

describe("derivePasDecision", () => {
  it("derives denied from A3 despite outcome=complete", () => {
    expect(derivePasDecision(crWithReviewAction("A3"))).toBe("denied");
  });

  it("derives denied from cancelled items", () => {
    expect(derivePasDecision(crWithReviewAction("C"))).toBe("denied");
  });

  it("derives approved from A1", () => {
    expect(derivePasDecision(crWithReviewAction("A1"))).toBe("approved");
  });

  it("lets A4 win over A3", () => {
    expect(derivePasDecision(crWithReviewActions(["A3", "A4"]))).toBe("pended");
  });

  it("derives partial from a mix of approved and denied items", () => {
    expect(derivePasDecision(crWithReviewActions(["A1", "A3"]))).toBe(
      "partial",
    );
  });

  it("derives partial when an item was modified", () => {
    expect(derivePasDecision(crWithReviewActions(["A1", "A6"]))).toBe(
      "partial",
    );
  });

  it("accepts system-less review action codings", () => {
    expect(derivePasDecision(crWithReviewActions(["A3"], undefined))).toBe(
      "denied",
    );
  });

  it("falls back to outcome when no review action codes exist", () => {
    const bare = (outcome: string) =>
      ({ resourceType: "ClaimResponse", outcome }) as ClaimResponse;
    expect(derivePasDecision(bare("complete"))).toBe("approved");
    expect(derivePasDecision(bare("error"))).toBe("denied");
    expect(derivePasDecision(bare("partial"))).toBe("pended");
    expect(derivePasDecision(bare("queued"))).toBe("pended");
    expect(
      derivePasDecision({ resourceType: "ClaimResponse" } as ClaimResponse),
    ).toBe("unknown");
  });

  it("ignores codings from other code systems", () => {
    expect(
      derivePasDecision(crWithReviewActions(["A3"], "http://example.com/sys")),
    ).toBe("approved");
  });
});
