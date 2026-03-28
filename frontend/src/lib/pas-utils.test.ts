import type { Claim, ClaimResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { resolvePasOrderLink } from "./pas-utils";

describe("resolvePasOrderLink", () => {
  it("uses the referenced claim to recover the originating order", () => {
    const claim: Claim = {
      resourceType: "Claim",
      id: "claim-1",
      status: "active",
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/claim-type",
            code: "professional",
          },
        ],
      },
      use: "preauthorization",
      patient: { reference: "Patient/pat-1" },
      created: "2026-03-27",
      provider: { reference: "Practitioner/prac-1" },
      insurer: { reference: "Organization/org-1" },
      priority: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/processpriority",
            code: "normal",
          },
        ],
      },
      insurance: [
        {
          sequence: 1,
          focal: true,
          coverage: { reference: "Coverage/coverage-1" },
        },
      ],
      item: [
        {
          sequence: 1,
          productOrService: {
            coding: [{ system: "http://example.org", code: "order-code" }],
          },
          extension: [
            {
              url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-requestedService",
              valueReference: {
                reference:
                  "https://provider.example/fhir/ServiceRequest/order-123",
              },
            },
          ],
        },
      ],
    };
    const claimResponse: ClaimResponse = {
      resourceType: "ClaimResponse",
      status: "active",
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/claim-type",
            code: "professional",
          },
        ],
      },
      use: "preauthorization",
      patient: { reference: "Patient/pat-1" },
      created: "2026-03-27",
      insurer: { reference: "Organization/org-1" },
      outcome: "complete",
      request: {
        reference: "https://provider.example/fhir/Claim/claim-1",
      },
    };

    expect(
      resolvePasOrderLink(claimResponse, new Map([["claim-1", claim]])),
    ).toEqual({
      orderId: "order-123",
      orderType: "ServiceRequest",
      coverageId: "coverage-1",
    });
  });

  it("does not fall back to the claim reference when the claim is missing", () => {
    const claimResponse: ClaimResponse = {
      resourceType: "ClaimResponse",
      status: "active",
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/claim-type",
            code: "professional",
          },
        ],
      },
      use: "preauthorization",
      patient: { reference: "Patient/pat-1" },
      created: "2026-03-27",
      insurer: { reference: "Organization/org-1" },
      outcome: "complete",
      request: { reference: "Claim/claim-1" },
    };

    expect(resolvePasOrderLink(claimResponse, new Map())).toBeNull();
  });
});
