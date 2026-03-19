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
        access_token: "access-token",
        id_token: "id-token",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getAccessToken, handleCallback } = await import("./auth");

    await Promise.all([
      handleCallback("auth-code", "auth-state"),
      handleCallback("auth-code", "auth-state"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("access-token");
  });

  it("reuses the completed callback exchange for repeated calls with the same payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: "access-token",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleCallback } = await import("./auth");

    await handleCallback("auth-code", "auth-state");
    await handleCallback("auth-code", "auth-state");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
