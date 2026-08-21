import { describe, expect, it } from "vitest";
import {
  buildPackageParameterList,
  stripVolatileMeta,
  withContainedPayorOrgs,
} from "./use-questionnaire";

const coverage = { resourceType: "Coverage", id: "cov014" };
const order = { resourceType: "DeviceRequest", id: "1716" };
const OXYGEN =
  "http://example.org/fhir/Questionnaire/home-o2-std-questionnaire";

function paramNames(params: Record<string, unknown>[]): string[] {
  return params.map((p) => p.name as string);
}

describe("buildPackageParameterList", () => {
  it("sends context alongside questionnaire canonicals for CRD launches", () => {
    const params = buildPackageParameterList(coverage, order, {
      questionnaire: [OXYGEN],
      coverageAssertionId: "CRD-abc-123",
    });
    expect(paramNames(params)).toEqual(
      expect.arrayContaining(["questionnaire", "context", "order", "coverage"]),
    );
  });

  it("sends every available selector additively alongside coverage", () => {
    const params = buildPackageParameterList(coverage, order, {
      questionnaire: ["urn:a", "urn:b"],
      coverageAssertionId: "assert-1",
    });
    expect(paramNames(params)).toEqual([
      "coverage",
      "questionnaire",
      "questionnaire",
      "context",
      "order",
    ]);
    expect(
      params
        .filter((p) => p.name === "questionnaire")
        .map((p) => p.valueCanonical),
    ).toEqual(["urn:a", "urn:b"]);
  });

  it("emits at most one context parameter (0..1 per DTR) even for a comma-joined coverageAssertionId", () => {
    const params = buildPackageParameterList(coverage, null, {
      coverageAssertionId: "assert-1,assert-2",
    });
    const contextParams = params.filter((p) => p.name === "context");
    expect(contextParams).toHaveLength(1);
    expect(contextParams[0].valueString).toBe("assert-1");
  });

  it("sends context only when no questionnaire canonical or order is known", () => {
    const params = buildPackageParameterList(coverage, null, {
      coverageAssertionId: "assert-1",
    });
    expect(paramNames(params)).toEqual(["coverage", "context"]);
  });

  it("sends order only when neither questionnaire nor context is known", () => {
    const params = buildPackageParameterList(coverage, order, {});
    expect(paramNames(params)).toEqual(["coverage", "order"]);
  });

  it("throws when coverage cannot be resolved", () => {
    expect(() =>
      buildPackageParameterList(null, order, { questionnaire: [OXYGEN] }),
    ).toThrow(/coverage/i);
  });
});

describe("withContainedPayorOrgs", () => {
  const payorCoverage = {
    resourceType: "Coverage",
    id: "cov014",
    payor: [{ reference: "Organization/org1234" }],
  };
  const payorOrg = {
    resourceType: "Organization",
    id: "org1234",
    identifier: [{ system: "urn:oid:2.16.840.1.113883.6.300", value: "00001" }],
  };

  it("contains fetched payor Organizations and rewrites payor to local references", async () => {
    const result = (await withContainedPayorOrgs(
      payorCoverage,
      async () => payorOrg,
    )) as {
      contained?: { id?: string; identifier?: unknown[] }[];
      payor?: { reference?: string }[];
    };

    expect(result.payor?.[0]?.reference).toBe("#payor-org-org1234");
    expect(result.contained).toHaveLength(1);
    expect(result.contained?.[0]?.id).toBe("payor-org-org1234");
    expect(result.contained?.[0]?.identifier).toEqual(payorOrg.identifier);
  });

  it("leaves the coverage untouched when the payor Organization cannot be fetched", async () => {
    const result = await withContainedPayorOrgs(
      payorCoverage,
      async () => null,
    );
    expect(result).toBe(payorCoverage);
  });

  it("ignores non-Organization payor references", async () => {
    const selfPay = {
      resourceType: "Coverage",
      payor: [{ reference: "Patient/pat013" }],
    };
    const result = await withContainedPayorOrgs(selfPay, async () => {
      throw new Error("should not fetch");
    });
    expect(result).toBe(selfPay);
  });

  it("strips versionId and lastUpdated from contained payor Organizations", async () => {
    const orgWithMeta = {
      ...payorOrg,
      meta: {
        versionId: "3",
        lastUpdated: "2026-08-07T00:00:00Z",
        profile: ["http://example.org/StructureDefinition/org"],
      },
    };
    const result = (await withContainedPayorOrgs(
      payorCoverage,
      async () => orgWithMeta,
    )) as { contained?: { meta?: Record<string, unknown> }[] };
    expect(result.contained?.[0]?.meta).toEqual({
      profile: ["http://example.org/StructureDefinition/org"],
    });
  });
});

describe("stripVolatileMeta", () => {
  it("removes versionId and lastUpdated but keeps other meta fields", () => {
    const stripped = stripVolatileMeta({
      resourceType: "Coverage",
      meta: {
        versionId: "1",
        lastUpdated: "2026-08-07T00:00:00Z",
        source: "#abc",
      },
    });
    expect(stripped.meta).toEqual({ source: "#abc" });
  });

  it("drops meta entirely when nothing else remains", () => {
    const stripped = stripVolatileMeta({
      resourceType: "Coverage",
      meta: { versionId: "1", lastUpdated: "2026-08-07T00:00:00Z" },
    });
    expect("meta" in stripped).toBe(false);
  });

  it("returns resources without meta unchanged", () => {
    const coverage = { resourceType: "Coverage" as const };
    expect(stripVolatileMeta(coverage)).toBe(coverage);
  });
});

describe("stripLformsMetaStamps", () => {
  it("removes the FHIR version pseudo-profile and system-less tags", async () => {
    const { stripLformsMetaStamps } = await import("./use-questionnaire");
    const qr = {
      resourceType: "QuestionnaireResponse",
      status: "completed",
      meta: {
        profile: [
          "http://hl7.org/fhir/4.0/StructureDefinition/QuestionnaireResponse",
          "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaireresponse",
        ],
        tag: [
          { code: "lformsVersion: 40.1.3" },
          { system: "http://example.org/tags", code: "keep" },
        ],
      },
    } as import("fhir/r4").QuestionnaireResponse;
    stripLformsMetaStamps(qr);
    expect(qr.meta?.profile).toEqual([
      "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaireresponse",
    ]);
    expect(qr.meta?.tag).toEqual([
      { system: "http://example.org/tags", code: "keep" },
    ]);
  });

  it("drops meta entirely when nothing remains", async () => {
    const { stripLformsMetaStamps } = await import("./use-questionnaire");
    const qr = {
      resourceType: "QuestionnaireResponse",
      status: "completed",
      meta: {
        profile: [
          "http://hl7.org/fhir/4.0/StructureDefinition/QuestionnaireResponse",
        ],
        tag: [{ code: "lformsVersion: 40.1.3" }],
      },
    } as import("fhir/r4").QuestionnaireResponse;
    stripLformsMetaStamps(qr);
    expect(qr.meta).toBeUndefined();
  });
});
