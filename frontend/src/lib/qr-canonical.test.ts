import type { QuestionnaireResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { qrCanonical, stripCanonicalVersion } from "./qr-canonical";

const Q_URL = "https://example.org/Questionnaire/Q";

function adaptiveQr(
  contained: QuestionnaireResponse["contained"],
  ref = "#aq",
): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    status: "in-progress",
    questionnaire: ref,
    contained,
  };
}

describe("qrCanonical", () => {
  it("returns a canonical questionnaire reference unchanged", () => {
    expect(
      qrCanonical({ questionnaire: `${Q_URL}|1.0.0`, contained: undefined }),
    ).toBe(`${Q_URL}|1.0.0`);
  });

  it("returns undefined when the QR has no questionnaire", () => {
    expect(qrCanonical({ questionnaire: undefined })).toBeUndefined();
  });

  it("resolves a contained reference through derivedFrom", () => {
    const qr = adaptiveQr([
      {
        resourceType: "Questionnaire",
        id: "aq",
        status: "active",
        url: "https://payer.example.org/Questionnaire/adaptive-instance",
        derivedFrom: [Q_URL],
      },
    ]);
    expect(qrCanonical(qr)).toBe(Q_URL);
  });

  it("falls back to the contained Questionnaire's url", () => {
    const qr = adaptiveQr([
      { resourceType: "Questionnaire", id: "aq", status: "active", url: Q_URL },
    ]);
    expect(qrCanonical(qr)).toBe(Q_URL);
  });

  it("ignores contained resources that are not the referenced Questionnaire", () => {
    const qr = adaptiveQr([
      { resourceType: "Library", id: "aq", status: "active", type: {} },
      {
        resourceType: "Questionnaire",
        id: "other",
        status: "active",
        derivedFrom: ["https://example.org/Questionnaire/Other"],
      },
    ]);
    expect(qrCanonical(qr)).toBeUndefined();
  });
});

describe("stripCanonicalVersion", () => {
  it("drops the version suffix", () => {
    expect(stripCanonicalVersion(`${Q_URL}|2.0`)).toBe(Q_URL);
    expect(stripCanonicalVersion(Q_URL)).toBe(Q_URL);
  });
});
