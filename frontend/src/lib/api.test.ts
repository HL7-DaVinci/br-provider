import { afterEach, describe, expect, it } from "vitest";
import {
  applyCustomHeaders,
  customHeadersFor,
  fhirProxyUrl,
  providerHeadersFor,
  targetRequiresAuth,
} from "./api";

describe("customHeadersFor", () => {
  afterEach(() => {
    window.APP_CONFIG = undefined;
    localStorage.clear();
  });

  it("prefers stored per-server headers for a preset provider server", () => {
    localStorage.setItem(
      "fhir-server-headers",
      JSON.stringify({
        "http://localhost:8080/fhir": [{ name: "X-Api-Key", value: "stored" }],
      }),
    );
    expect(customHeadersFor("http://localhost:8080/fhir/Patient/1")).toEqual([
      { name: "X-Api-Key", value: "stored" },
    ]);
  });

  it("payer headers win over provider stored headers", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "P",
          cdsUrl: "http://p.example/cds-services",
          fhirUrl: "http://p.example/fhir",
          headers: [{ name: "X-Payer", value: "1" }],
        },
      ],
    };
    localStorage.setItem(
      "fhir-server-headers",
      JSON.stringify({
        "http://p.example/fhir": [{ name: "X-Provider", value: "2" }],
      }),
    );
    expect(customHeadersFor("http://p.example/fhir/Claim/$submit")).toEqual([
      { name: "X-Payer", value: "1" },
    ]);
  });

  it("can select provider headers when payer and provider URLs overlap", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "P",
          cdsUrl: "http://localhost:8080/cds-services",
          fhirUrl: "http://localhost:8080/fhir",
          headers: [{ name: "X-Payer", value: "1" }],
        },
      ],
    };
    localStorage.setItem(
      "fhir-server-headers",
      JSON.stringify({
        "http://localhost:8080/fhir": [{ name: "X-Provider", value: "2" }],
      }),
    );

    expect(providerHeadersFor("http://localhost:8080/fhir/Patient/1")).toEqual([
      { name: "X-Provider", value: "2" },
    ]);
  });
});

describe("fhirProxyUrl", () => {
  afterEach(() => {
    window.APP_CONFIG = undefined;
  });

  it("bypasses the proxy for the default (unauthenticated) payer server", () => {
    const target = "http://localhost:8081/fhir/Claim/$submit";
    expect(fhirProxyUrl(target, { payer: true, op: "pas-submit" })).toBe(
      target,
    );
    expect(targetRequiresAuth(target)).toBe(false);
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

describe("authMode routing", () => {
  afterEach(() => {
    window.APP_CONFIG = undefined;
  });

  it("treats a stored payer with authMode open as direct", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "Open Mode Payer",
          cdsUrl: "http://payer.test/cds",
          fhirUrl: "http://payer.test/fhir",
          authMode: "open",
        },
      ],
    };
    expect(
      fhirProxyUrl("http://payer.test/fhir/Claim/$submit", { payer: true }),
    ).toBe("http://payer.test/fhir/Claim/$submit");
  });

  it("adds auth=b2b for a payer with authMode udap-b2b", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "B2B Payer",
          cdsUrl: "http://payer.test/cds",
          fhirUrl: "http://payer.test/fhir",
          authMode: "udap-b2b",
        },
      ],
    };
    const url = fhirProxyUrl("http://payer.test/fhir/Claim/$submit", {
      payer: true,
      op: "submit",
    });
    expect(url).toContain("/api/fhir-proxy?");
    expect(url).toContain("auth=b2b");
  });

  it("adds auth=smart-backend for a payer with authMode smart-backend", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "SMART Backend Payer",
          cdsUrl: "http://payer.test/cds",
          fhirUrl: "http://payer.test/fhir",
          authMode: "smart-backend",
        },
      ],
    };
    const url = fhirProxyUrl("http://payer.test/fhir/Claim/$submit", {
      payer: true,
      op: "submit",
    });
    expect(url).toContain("/api/fhir-proxy?");
    expect(url).toContain("auth=smart-backend");
  });

  it("omits auth for auto payers", () => {
    window.APP_CONFIG = {
      payerServers: [
        {
          name: "Auto Payer",
          cdsUrl: "http://payer.test/cds",
          fhirUrl: "http://payer.test/fhir",
        },
      ],
    };
    const url = fhirProxyUrl("http://payer.test/fhir/Claim/$submit", {
      payer: true,
    });
    expect(url).not.toContain("auth=b2b");
  });
});

describe("applyCustomHeaders", () => {
  const custom = [{ name: "X-Api-Key", value: "abc" }];

  it("prefixes X-Fwd- for proxied requests", () => {
    const init = applyCustomHeaders({}, custom, true);
    expect(new Headers(init?.headers).get("X-Fwd-X-Api-Key")).toBe("abc");
  });

  it("sends plain names for direct requests", () => {
    const init = applyCustomHeaders({}, custom, false);
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe("abc");
  });

  it("preserves existing headers and returns init unchanged when empty", () => {
    const init = applyCustomHeaders(
      { headers: { Accept: "application/fhir+json" } },
      custom,
      true,
    );
    expect(new Headers(init?.headers).get("Accept")).toBe(
      "application/fhir+json",
    );
    const untouched = { headers: { Accept: "a" } };
    expect(applyCustomHeaders(untouched, [], true)).toBe(untouched);
  });
});
