import { beforeEach, describe, expect, it, vi } from "vitest";

describe("handleCallback", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        { name: "Local Provider Server", url: "http://localhost:8080/fhir" },
      ],
    };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("deduplicates concurrent callback exchanges for the same code and state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        authenticated: true,
        userinfo: { name: "Test User", fhirUser: "Practitioner/1" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleCallback, getUserInfo } = await import("./auth");

    await Promise.all([
      handleCallback("auth-code", "auth-state"),
      handleCallback("auth-code", "auth-state"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getUserInfo()).toEqual({
      name: "Test User",
      fhirUser: "Practitioner/1",
    });
  });

  it("stores only userinfo, not tokens, after callback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        authenticated: true,
        userinfo: { name: "Test User" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleCallback } = await import("./auth");

    await handleCallback("auth-code", "auth-state");

    expect(sessionStorage.getItem("spa_access_token")).toBeNull();
    expect(sessionStorage.getItem("spa_id_token")).toBeNull();
    expect(sessionStorage.getItem("spa_userinfo")).not.toBeNull();
  });

  it("sends credentials: include on token exchange", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ authenticated: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleCallback } = await import("./auth");

    await handleCallback("auth-code", "auth-state");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe("include");
  });
});

describe("checkSession", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        { name: "Local Provider Server", url: "http://localhost:8080/fhir" },
      ],
    };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("calls /auth/session with credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ authenticated: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { checkSession } = await import("./auth");

    const result = await checkSession();

    expect(fetchMock).toHaveBeenCalledWith("/auth/session", {
      credentials: "include",
    });
    expect(result.authenticated).toBe(true);
  });

  it("clears saved auth storage when the server session has expired", async () => {
    sessionStorage.setItem(
      "spa_userinfo",
      JSON.stringify({ name: "Test User" }),
    );
    sessionStorage.setItem(
      "spa_session_server",
      "https://custom.fhir.org/fhir",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ authenticated: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { checkSession, getSessionServerUrl, getUserInfo } = await import(
      "./auth"
    );

    const result = await checkSession();

    expect(result.authenticated).toBe(false);
    expect(getUserInfo()).toBeNull();
    expect(getSessionServerUrl()).toBeNull();
  });
});

describe("buildLoginPath", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        { name: "Local Provider Server", url: "http://localhost:8080/fhir" },
      ],
    };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("defaults to the primary login flow for configured servers", async () => {
    localStorage.setItem("fhir-server-url", "http://localhost:8080/fhir");

    const { buildLoginPath } = await import("./auth");

    expect(buildLoginPath()).toBe("/auth/login");
  });

  it("reuses the stored custom auth target for the selected custom server", async () => {
    localStorage.setItem("fhir-server-url", "https://custom.fhir.org/fhir");
    localStorage.setItem(
      "fhir-custom-auth-target",
      JSON.stringify({
        serverUrl: "https://custom.fhir.org/fhir",
        idp: "https://idp.example.org",
      }),
    );

    const { buildLoginPath } = await import("./auth");

    expect(buildLoginPath()).toBe(
      "/auth/login?server=https%3A%2F%2Fcustom.fhir.org%2Ffhir&idp=https%3A%2F%2Fidp.example.org",
    );
  });

  it("ignores a stored custom auth target when it does not match the selected server", async () => {
    localStorage.setItem("fhir-server-url", "https://other.fhir.org/fhir");
    localStorage.setItem(
      "fhir-custom-auth-target",
      JSON.stringify({
        serverUrl: "https://custom.fhir.org/fhir",
        idp: "https://idp.example.org",
      }),
    );

    const { buildLoginPath } = await import("./auth");

    expect(buildLoginPath()).toBe("/auth/login");
  });
});
