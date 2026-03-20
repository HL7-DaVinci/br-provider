import { beforeEach, describe, expect, it, vi } from "vitest";

describe("handleCallback", () => {
  beforeEach(() => {
    sessionStorage.clear();
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
});
