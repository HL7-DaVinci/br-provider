import { beforeEach, describe, expect, it, vi } from "vitest";

const PROVIDER_SERVER_URL = "http://localhost:8080";
const PROVIDER_FHIR_BASE = `${PROVIDER_SERVER_URL}/fhir`;
const EXTERNAL_FHIR_BASE = "http://example.org/fhir";

function findProxyCall(
  fetchMock: ReturnType<typeof vi.fn>,
): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls.find(
    ([u]) => typeof u === "string" && u.includes("/api/fhir-proxy"),
  );
  if (!call) {
    throw new Error(
      `expected a /api/fhir-proxy call; got: ${fetchMock.mock.calls
        .map((c) => c[0])
        .join(", ")}`,
    );
  }
  return call as [string, RequestInit | undefined];
}

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

    const [url] = findProxyCall(fetchMock);
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

    const [, options] = findProxyCall(fetchMock);
    expect(options?.credentials).toBe("include");
  });

  it("does not send an Authorization header from the SPA", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${PROVIDER_FHIR_BASE}/Patient`);

    const [, options] = findProxyCall(fetchMock);
    expect(options?.headers).not.toHaveProperty("Authorization");
  });

  it("routes a custom (non-configured) server through the proxy too", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    const customUrl = "https://hapi.fhir.org/baseR4/Patient";
    await fhirFetch(customUrl);

    const [url, options] = findProxyCall(fetchMock);
    expect(url).toContain(encodeURIComponent(customUrl));
    expect(options?.credentials).toBe("include");

    const directCall = fetchMock.mock.calls.find(([u]) => u === customUrl);
    expect(directCall).toBeUndefined();
  });

  it("waits for the active-server boot sync before issuing the FHIR request", async () => {
    const order: string[] = [];

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const isBootSync =
        url.includes("/auth/active-server") ||
        url.includes("/auth/active-payer");
      const isFhirProxy = url.includes("/api/fhir-proxy");

      if (isBootSync) {
        return new Promise((resolve) => {
          setTimeout(() => {
            order.push(
              url.includes("server") ? "active-server" : "active-payer",
            );
            resolve({
              ok: true,
              json: vi.fn().mockResolvedValue({}),
            });
          }, 10);
        });
      }
      if (isFhirProxy) {
        order.push("fhir-proxy");
      }
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({ resourceType: "Bundle" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fhirFetch } = await import("./use-fhir-api");

    await fhirFetch(`${PROVIDER_FHIR_BASE}/Patient`);

    expect(order).toContain("active-server");
    expect(order.indexOf("fhir-proxy")).toBeGreaterThan(
      order.indexOf("active-server"),
    );
  });
});
