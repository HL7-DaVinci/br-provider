import { afterEach, describe, expect, it, vi } from "vitest";

describe("org identifiers from APP_CONFIG", () => {
  afterEach(() => {
    window.APP_CONFIG = undefined;
    vi.resetModules();
  });

  it("uses configured values when present", async () => {
    vi.resetModules();
    window.APP_CONFIG = {
      providerOrgIdentifier: "9999999999",
      providerOrgIdentifierSystem: "http://example.com/org",
      payerOrgIdentifier: "8888888888",
    };
    const mod = await import("./pas-bundle-builder");
    expect(mod.providerOrgIdentifier()).toBe("9999999999");
    expect(mod.PROVIDER_ORG_IDENTIFIER_SYSTEM).toBe("http://example.com/org");
  });

  it("derives a per-EHR identifier when none is configured", async () => {
    vi.resetModules();
    window.APP_CONFIG = undefined;
    const mod = await import("./pas-bundle-builder");
    const { getStoredServerUrl } = await import("./fhir-config");
    expect(mod.providerOrgIdentifier()).toBe(
      mod.deriveOrgIdentifier(getStoredServerUrl()),
    );
  });

  it("derivation is stable, url-normalized, and distinct across servers", async () => {
    const { deriveOrgIdentifier } = await import("./pas-bundle-builder");
    const a = deriveOrgIdentifier("http://localhost:5826/fhir/r4");
    expect(a).toMatch(/^\d{10}$/);
    expect(deriveOrgIdentifier("http://localhost:5826/fhir/r4/")).toBe(a);
    expect(deriveOrgIdentifier("http://localhost:8080/fhir")).not.toBe(a);
  });
});
