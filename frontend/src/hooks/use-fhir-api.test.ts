import { beforeEach, describe, expect, it, vi } from "vitest";

const PROVIDER_SERVER_URL = "http://localhost:8080";
const PROVIDER_FHIR_BASE = `${PROVIDER_SERVER_URL}/fhir`;
const EXTERNAL_FHIR_BASE = "http://example.org/fhir";

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

  it("routes FHIR requests through the proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${PROVIDER_FHIR_BASE}/Patient`);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/fhir-proxy?");
    expect(url).toContain(encodeURIComponent(`${PROVIDER_FHIR_BASE}/Patient`));
  });

  it("sends credentials: include with proxy requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${PROVIDER_FHIR_BASE}/Patient`);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe("include");
  });

  it("does not send an Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${PROVIDER_FHIR_BASE}/Patient`);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("routes external configured server requests through the proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${EXTERNAL_FHIR_BASE}/Patient`);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/fhir-proxy?");
    expect(url).toContain(encodeURIComponent(`${EXTERNAL_FHIR_BASE}/Patient`));
    expect(options.credentials).toBe("include");
  });

  it("routes custom (non-configured) server requests directly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "CapabilityStatement" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    const customUrl = "https://hapi.fhir.org/baseR4/metadata";
    await fhirFetch(customUrl);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(customUrl);
    expect(options?.credentials).toBeUndefined();
  });

  it("does not use proxy for custom server requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch("https://hapi.fhir.org/baseR4/Patient");

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain("/api/fhir-proxy");
  });

  it("routes authenticated custom server through proxy", async () => {
    sessionStorage.setItem(
      "spa_session_server",
      "https://custom.fhir.org/fhir",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch("https://custom.fhir.org/fhir/Patient");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/fhir-proxy?");
    expect(url).toContain(
      encodeURIComponent("https://custom.fhir.org/fhir/Patient"),
    );
    expect(options.credentials).toBe("include");
  });
});
