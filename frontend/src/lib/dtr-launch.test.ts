import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dtrSearchFromSmartContext,
  startExternalDtrLaunch,
} from "./dtr-launch";

describe("startExternalDtrLaunch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts iss and launch, then returns the authorizeUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        authorizeUrl: "https://ehr.example.org/authorize?state=abc",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const authorizeUrl = await startExternalDtrLaunch(
      "https://ehr.example.org/fhir",
      "launch-token",
    );

    expect(authorizeUrl).toBe("https://ehr.example.org/authorize?state=abc");
    expect(fetchMock).toHaveBeenCalledWith("/auth/smart-ehr-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iss: "https://ehr.example.org/fhir",
        launch: "launch-token",
      }),
      credentials: "include",
    });
  });

  it("throws the server's error_description on a failed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: "invalid_request",
        error_description: "Missing iss or launch",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startExternalDtrLaunch("https://ehr.example.org/fhir", "launch-token"),
    ).rejects.toThrow("Missing iss or launch");
  });

  it("falls back to the error code, then a generic message, when description is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ error: "smart_discovery_failed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startExternalDtrLaunch("https://ehr.example.org/fhir", "launch-token"),
    ).rejects.toThrow("smart_discovery_failed");
  });
});

describe("dtrSearchFromSmartContext", () => {
  it("joins fhirContext references and includes patient/encounter", () => {
    expect(
      dtrSearchFromSmartContext("https://ehr.example.org/fhir", {
        patient: "123",
        encounter: "456",
        fhirContext: ["Coverage/789", "ServiceRequest/101"],
      }),
    ).toEqual({
      iss: "https://ehr.example.org/fhir",
      patientId: "123",
      encounterId: "456",
      fhirContext: "Coverage/789,ServiceRequest/101",
    });
  });

  it("omits encounterId and fhirContext when absent, but always includes patientId", () => {
    expect(
      dtrSearchFromSmartContext("https://ehr.example.org/fhir", {}),
    ).toEqual({
      iss: "https://ehr.example.org/fhir",
      patientId: "",
    });
  });

  it("passes appContext through and lifts its DTR launch values", () => {
    expect(
      dtrSearchFromSmartContext("https://ehr.example.org/fhir", {
        patient: "123",
        appContext:
          '{"coverageAssertionId":"ca-1","questionnaire":"http://example.org/q"}',
      }),
    ).toEqual({
      iss: "https://ehr.example.org/fhir",
      patientId: "123",
      appContext:
        '{"coverageAssertionId":"ca-1","questionnaire":"http://example.org/q"}',
      coverageAssertionId: "ca-1",
      questionnaire: "http://example.org/q",
    });
  });

  it("keeps a non-JSON appContext opaque", () => {
    expect(
      dtrSearchFromSmartContext("https://ehr.example.org/fhir", {
        patient: "123",
        appContext: "opaque-string",
      }),
    ).toEqual({
      iss: "https://ehr.example.org/fhir",
      patientId: "123",
      appContext: "opaque-string",
    });
  });
});
