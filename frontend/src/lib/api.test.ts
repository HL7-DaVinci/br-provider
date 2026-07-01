import { afterEach, describe, expect, it } from "vitest";
import { fhirProxyUrl, targetRequiresAuth } from "./api";

describe("fhirProxyUrl", () => {
  afterEach(() => {
    window.APP_CONFIG = undefined;
  });

  it("wraps requests through the BFF proxy by default", () => {
    const url = fhirProxyUrl("http://localhost:8081/fhir/Claim/$submit", {
      payer: true,
      op: "pas-submit",
    });
    expect(url).toContain("/api/fhir-proxy");
    expect(url).toContain("payer=true");
    expect(url).toContain("op=pas-submit");
  });

  it("bypasses the proxy for a payer server flagged requiresAuth:false", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "Open Payer",
          cdsUrl: "http://open.example/cds-services",
          fhirUrl: "http://open.example/fhir",
          requiresAuth: false,
        },
      ],
    };
    const target = "http://open.example/fhir/Claim/$submit";
    expect(fhirProxyUrl(target, { payer: true, op: "pas-submit" })).toBe(
      target,
    );
    expect(targetRequiresAuth(target)).toBe(false);
  });

  it("still proxies a payer server that requires auth", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "Auth Payer",
          cdsUrl: "http://payer.example/cds-services",
          fhirUrl: "http://payer.example/fhir",
        },
      ],
    };
    expect(
      fhirProxyUrl("http://payer.example/fhir/metadata", { payer: true }),
    ).toContain("/api/fhir-proxy");
    expect(targetRequiresAuth("http://payer.example/fhir/metadata")).toBe(true);
  });
});
