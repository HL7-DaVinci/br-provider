import { beforeEach, describe, expect, it, vi } from "vitest";
import { loggedFetch } from "./logged-fetch";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    credentialsFor: () => "omit" as const,
    providerHeadersFor: (url: string) =>
      url.includes("provider")
        ? [{ name: "X-Provider-Key", value: "provider-token" }]
        : actual.providerHeadersFor(url),
  };
});
vi.mock("./payer-config", () => ({
  getPayerByUrl: (url: string) => {
    if (url.includes("bypass-payer")) {
      return {
        name: "Bypass Payer",
        cdsUrl: "http://bypass-payer/cds-services",
        fhirUrl: "http://bypass-payer/fhir",
        bypassPayorCheck: true,
      };
    }
    if (url.includes("trace-payer")) {
      return {
        name: "Trace Payer",
        cdsUrl: "http://trace-payer/cds-services",
        fhirUrl: "http://trace-payer/fhir",
        headers: [{ name: "X-Trace", value: "t1" }],
      };
    }
    return {
      name: "Plain Payer",
      cdsUrl: "http://plain-payer/cds-services",
      fhirUrl: "http://plain-payer/fhir",
    };
  },
}));

describe("loggedFetch payor check bypass header", () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  it("prefixes the bypass header for a proxied (relative URL) request", async () => {
    await loggedFetch(
      "/api/fhir-proxy?server=http://bypass-payer/fhir",
      { method: "POST" },
      { payerUrl: "http://bypass-payer/fhir", operationName: "PAS submit" },
    );

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Fwd-X-Bypass-Payor-Check")).toBe("true");
    expect(headers.get("X-Bypass-Payor-Check")).toBeNull();
  });

  it("adds X-Bypass-Payor-Check for a direct request when the payer has bypassPayorCheck enabled", async () => {
    await loggedFetch(
      "http://bypass-payer/fhir/Claim/$submit",
      { method: "POST", headers: { "Content-Type": "application/fhir+json" } },
      { payerUrl: "http://bypass-payer/fhir", operationName: "PAS submit" },
    );

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(Object.fromEntries(headers.entries())).toEqual({
      "content-type": "application/fhir+json",
      "x-bypass-payor-check": "true",
    });
  });

  it("leaves headers untouched for payers without bypassPayorCheck", async () => {
    await loggedFetch(
      "http://plain-payer/fhir/Claim/$submit",
      { method: "POST", headers: { "Content-Type": "application/fhir+json" } },
      { payerUrl: "http://plain-payer/fhir", operationName: "PAS submit" },
    );

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "Content-Type": "application/fhir+json",
    });
  });
});

describe("loggedFetch custom headers", () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  it("prefixes X-Fwd- for a proxied (relative URL) request", async () => {
    await loggedFetch(
      "/api/cds-services?server=http://trace-payer/cds-services",
      undefined,
      { payerUrl: "http://trace-payer/fhir", operationName: "CDS Discovery" },
    );

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Fwd-X-Trace")).toBe("t1");
  });

  it("sends the plain header name for a direct (absolute URL) request", async () => {
    await loggedFetch("http://trace-payer/fhir/Claim/$submit", undefined, {
      payerUrl: "http://trace-payer/fhir",
      operationName: "CDS Discovery",
    });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Trace")).toBe("t1");
  });

  it("prefixes provider headers for a provider-bound BFF call", async () => {
    await loggedFetch("/api/dtr/populate", undefined, {
      payerUrl: "",
      providerUrl: "http://provider/fhir",
      operationName: "$populate",
    });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Fwd-X-Provider-Key")).toBe("provider-token");
  });
});
