import type { QuestionnaireResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { findReusableQr, indexQrsByCanonical } from "./use-patient-qr-index";

const Q_BARE = "https://example.org/Questionnaire/Q";
const Q_VERSIONED = `${Q_BARE}|1.0.0`;

function qr(
  id: string,
  questionnaire: string | undefined,
  status: QuestionnaireResponse["status"],
): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    id,
    questionnaire,
    status,
  };
}

describe("indexQrsByCanonical", () => {
  it("buckets completed and in-progress QRs by canonical", () => {
    const completed = [qr("c1", Q_BARE, "completed")];
    const inProgress = [qr("p1", Q_BARE, "in-progress")];

    const map = indexQrsByCanonical(completed, inProgress);

    expect(map.get(Q_BARE)?.completed.map((q) => q.id)).toEqual(["c1"]);
    expect(map.get(Q_BARE)?.inProgress.map((q) => q.id)).toEqual(["p1"]);
  });

  it("treats amended QRs as completed (caller is responsible for status filter)", () => {
    const completed = [
      qr("c1", Q_BARE, "completed"),
      qr("c2", Q_BARE, "amended"),
    ];
    const map = indexQrsByCanonical(completed, []);
    expect(map.get(Q_BARE)?.completed).toHaveLength(2);
  });

  it("ignores QRs without a questionnaire reference", () => {
    const map = indexQrsByCanonical([qr("c1", undefined, "completed")], []);
    expect(map.size).toBe(0);
  });
});

describe("findReusableQr", () => {
  it("returns first completed QR for an exact canonical match", () => {
    const map = indexQrsByCanonical(
      [qr("c1", Q_BARE, "completed"), qr("c2", Q_BARE, "completed")],
      [],
    );
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_BARE,
    );
    expect(result?.id).toBe("c1");
  });

  it("falls back to stripped canonical when versioned lookup misses", () => {
    const map = indexQrsByCanonical([qr("c1", Q_BARE, "completed")], []);
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_VERSIONED,
    );
    expect(result?.id).toBe("c1");
  });

  it("returns undefined when no completed QR exists", () => {
    const map = indexQrsByCanonical([], [qr("p1", Q_BARE, "in-progress")]);
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_BARE,
    );
    expect(result).toBeUndefined();
  });
});
