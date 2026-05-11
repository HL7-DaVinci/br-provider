import type { Bundle, Parameters, Questionnaire } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { extractPackageBundle } from "./dtr-ingestion";

describe("extractPackageBundle", () => {
  function bundleWithQ(canonical: string, version?: string): Bundle {
    const q: Questionnaire = {
      resourceType: "Questionnaire",
      url: canonical,
      status: "active",
      ...(version ? { version } : {}),
    };
    return {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: q }],
    };
  }

  function paramsWith(...bundles: Bundle[]): Parameters {
    return {
      resourceType: "Parameters",
      parameter: bundles.map((resource) => ({
        name: "packagebundle",
        resource,
      })),
    };
  }

  it("returns null for null/non-object input", () => {
    expect(extractPackageBundle(null)).toBeNull();
    expect(extractPackageBundle(undefined)).toBeNull();
    expect(extractPackageBundle("nope")).toBeNull();
  });

  it("returns the input unchanged when given a Bundle directly", () => {
    const b = bundleWithQ("http://example.org/Q/A");
    expect(extractPackageBundle(b)).toBe(b);
  });

  it("unwraps a single packagebundle from a Parameters response", () => {
    const inner = bundleWithQ("http://example.org/Q/A");
    expect(extractPackageBundle(paramsWith(inner))).toBe(inner);
  });

  it("returns null when Parameters has no packagebundle parameter", () => {
    const params: Parameters = {
      resourceType: "Parameters",
      parameter: [{ name: "outcome" }],
    };
    expect(extractPackageBundle(params)).toBeNull();
  });

  it("filters by canonical URL when multiple packagebundles are present", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(
      extractPackageBundle(paramsWith(a, b), "http://example.org/Q/B"),
    ).toBe(b);
    expect(
      extractPackageBundle(paramsWith(a, b), "http://example.org/Q/A"),
    ).toBe(a);
  });

  it("matches a versioned canonical request to an unversioned Questionnaire url", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(
      extractPackageBundle(paramsWith(a, b), "http://example.org/Q/B|1.0.0"),
    ).toBe(b);
  });

  it("matches a versioned canonical request to a versioned Questionnaire url when version matches", () => {
    const a = bundleWithQ("http://example.org/Q/A", "1.0.0");
    const b = bundleWithQ("http://example.org/Q/B", "1.0.0");
    expect(
      extractPackageBundle(paramsWith(a, b), "http://example.org/Q/B|1.0.0"),
    ).toBe(b);
  });

  it("falls back to the first packagebundle when no canonical matches", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(
      extractPackageBundle(paramsWith(a, b), "http://example.org/Q/Missing"),
    ).toBe(a);
  });

  it("returns the only packagebundle without applying canonical filter", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    expect(
      extractPackageBundle(paramsWith(a), "http://example.org/Q/Other"),
    ).toBe(a);
  });
});
