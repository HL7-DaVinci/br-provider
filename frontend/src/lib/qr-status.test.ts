import type { Bundle, QuestionnaireResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { selectNewCompletedQrs } from "./qr-status";

function entry(
  id: string,
  status: QuestionnaireResponse["status"],
  authored?: string,
): NonNullable<Bundle<QuestionnaireResponse>["entry"]>[number] {
  return {
    resource: { resourceType: "QuestionnaireResponse", id, status, authored },
  };
}

describe("selectNewCompletedQrs", () => {
  it("keeps terminal responses authored at or after the anchor", () => {
    const entries = [
      entry("old", "completed", "2026-06-01T00:00:00Z"),
      entry("new", "completed", "2026-07-02T00:00:00Z"),
      entry("amended", "amended", "2026-07-03T00:00:00Z"),
      entry("draft", "in-progress", "2026-07-03T00:00:00Z"),
    ];
    const result = selectNewCompletedQrs(entries, "2026-07-01T00:00:00Z");
    expect(result.map((qr) => qr.id)).toEqual(["new", "amended"]);
  });

  it("is permissive when the anchor or authored date is missing", () => {
    const entries = [
      entry("no-date", "completed"),
      entry("dated", "completed", "2026-06-01T00:00:00Z"),
    ];
    expect(
      selectNewCompletedQrs(entries, undefined).map((qr) => qr.id),
    ).toEqual(["no-date", "dated"]);
    expect(
      selectNewCompletedQrs(entries, "2026-07-01T00:00:00Z").map((qr) => qr.id),
    ).toEqual(["no-date"]);
  });

  it("handles missing entries", () => {
    expect(selectNewCompletedQrs(undefined, undefined)).toEqual([]);
  });
});
