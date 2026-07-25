import { beforeEach, describe, expect, it, vi } from "vitest";
import { loggedFetch } from "./logged-fetch";

vi.mock("./api", () => ({ credentialsFor: () => "omit" as const }));
vi.mock("./payer-config", () => ({
  getPayerByUrl: (url: string) =>
    url.includes("bypass-payer")
      ? {
          name: "Bypass Payer",
          cdsUrl: "http://bypass-payer/cds-services",
          fhirUrl: "http://bypass-payer/fhir",
          bypassPayorCheck: true,
        }
      : {
          name: "Plain Payer",
          cdsUrl: "http://plain-payer/cds-services",
          fhirUrl: "http://plain-payer/fhir",
        },
}));

describe("loggedFetch payor check bypass header", () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  it("adds X-Bypass-Payor-Check when the payer has bypassPayorCheck enabled", async () => {
    await loggedFetch(
      "http://bypass-payer/fhir/Claim/$submit",
      { method: "POST", headers: { "Content-Type": "application/fhir+json" } },
      { payerUrl: "http://bypass-payer/fhir", operationName: "PAS submit" },
    );

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "Content-Type": "application/fhir+json",
      "X-Bypass-Payor-Check": "true",
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
