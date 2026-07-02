import { describe, expect, it } from "vitest";
import { buildPackageParameterList } from "./use-questionnaire";

const coverage = { resourceType: "Coverage", id: "cov014" };
const order = { resourceType: "DeviceRequest", id: "1716" };
const OXYGEN =
  "http://example.org/fhir/Questionnaire/home-o2-std-questionnaire";

describe("buildPackageParameterList", () => {
  it("sends only the explicit questionnaire canonical, omitting order and context", () => {
    const params = buildPackageParameterList(coverage, order, {
      questionnaire: [OXYGEN],
      coverageAssertionId: "assert-1",
    });
    expect(params.map((p) => p.name)).toEqual(["coverage", "questionnaire"]);
    expect(params).toContainEqual({
      name: "questionnaire",
      valueCanonical: OXYGEN,
    });
  });

  it("falls back to a context-only request when no questionnaire is given", () => {
    const params = buildPackageParameterList(coverage, order, {
      coverageAssertionId: "assert-1",
    });
    expect(params.map((p) => p.name)).toEqual(["coverage", "context"]);
  });

  it("uses order-based discovery when neither questionnaire nor context is given", () => {
    const params = buildPackageParameterList(coverage, order, {});
    expect(params.map((p) => p.name)).toEqual(["coverage", "order"]);
  });

  it("includes every canonical when multiple questionnaires are requested", () => {
    const params = buildPackageParameterList(coverage, null, {
      questionnaire: ["urn:a", "urn:b"],
    });
    expect(
      params
        .filter((p) => p.name === "questionnaire")
        .map((p) => p.valueCanonical),
    ).toEqual(["urn:a", "urn:b"]);
  });
});
