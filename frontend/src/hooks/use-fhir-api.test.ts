import { beforeEach, describe, expect, it, vi } from "vitest";

const PROVIDER_SERVER_URL = "http://localhost:8080";
const PROVIDER_FHIR_BASE = `${PROVIDER_SERVER_URL}/fhir`;
const EXTERNAL_FHIR_BASE = "http://example.org/fhir";
const CUSTOM_FHIR_BASE = "http://custom.example/fhir";
const TOKEN_KEY = "spa_access_token";
const STORAGE_KEY = "fhir-server-url";

describe("fhirFetch", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();

    window.APP_CONFIG = {
      providerServerUrl: PROVIDER_SERVER_URL,
      fhirServers: [
        { name: "Provider", url: PROVIDER_FHIR_BASE },
        { name: "External", url: EXTERNAL_FHIR_BASE },
      ],
    };
  });

  it("attaches the bearer token to provider FHIR requests", async () => {
    sessionStorage.setItem(TOKEN_KEY, "provider-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${PROVIDER_FHIR_BASE}/Patient`);

    const [, options] = fetchMock.mock.calls[0];
    expect(options?.headers).toMatchObject({
      Accept: "application/fhir+json",
      Authorization: "Bearer provider-token",
    });
  });

  it("does not attach the bearer token to preset non-provider FHIR servers", async () => {
    sessionStorage.setItem(TOKEN_KEY, "provider-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${EXTERNAL_FHIR_BASE}/Patient`);

    const [, options] = fetchMock.mock.calls[0];
    expect(options?.headers).toMatchObject({
      Accept: "application/fhir+json",
    });
    expect(options?.headers).not.toHaveProperty("Authorization");
  });

  it("does not attach the bearer token to custom non-provider FHIR servers", async () => {
    sessionStorage.setItem(TOKEN_KEY, "provider-token");
    localStorage.setItem(STORAGE_KEY, CUSTOM_FHIR_BASE);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${CUSTOM_FHIR_BASE}/Patient`);

    const [, options] = fetchMock.mock.calls[0];
    expect(options?.headers).toMatchObject({
      Accept: "application/fhir+json",
    });
    expect(options?.headers).not.toHaveProperty("Authorization");
  });
});
