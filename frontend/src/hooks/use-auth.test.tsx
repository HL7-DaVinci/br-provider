import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./use-auth";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// FHIR_SERVERS is resolved once at fhir-config.ts module load, so tests that
// need a custom server list must reset the module registry and re-import
// use-auth after setting window.APP_CONFIG.
async function renderUseAuth() {
  vi.resetModules();
  const { useAuth: dynamicUseAuth } = await import("./use-auth");
  return renderHook(() => dynamicUseAuth(), { wrapper: createWrapper() });
}

describe("useAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        { name: "Local Provider Server", url: "http://localhost:8080/fhir" },
      ],
    };
    navigateMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports session restoration while the initial session check is pending", async () => {
    let resolveFetch:
      | ((value: {
          ok: true;
          json: () => Promise<{ authenticated: boolean }>;
        }) => void)
      | undefined;
    const fetchPromise = new Promise<{
      ok: true;
      json: () => Promise<{ authenticated: boolean }>;
    }>((resolve) => {
      resolveFetch = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchPromise),
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isRestoringSession).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);

    resolveFetch?.({
      ok: true,
      json: async () => ({ authenticated: false }),
    });

    await waitFor(() => {
      expect(result.current.isRestoringSession).toBe(false);
    });
  });

  it("treats a restored server session as authenticated before local storage is backfilled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: true,
          userinfo: {
            name: "Dr. Test",
            fhirUser: "Practitioner/123",
            fhirUserType: "Practitioner",
          },
        }),
      }),
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.isRestoringSession).toBe(false);
    expect(result.current.displayName).toBe("Dr. Test");
    expect(result.current.fhirUserType).toBe("Practitioner");
  });
});

describe("local identity mode", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.APP_CONFIG = undefined;
  });

  it("activates for an open active server and skips session polling", async () => {
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        {
          name: "Open EHR",
          url: "http://open.example.com/fhir",
          requiresAuth: false,
        },
      ],
    };
    localStorage.setItem("fhir-server-url", "http://open.example.com/fhir");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { result } = await renderUseAuth();

    expect(result.current.localIdentityMode).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/auth/session",
      expect.anything(),
    );
  });

  it("treats a stored local identity as authenticated", async () => {
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        {
          name: "Open EHR",
          url: "http://open.example.com/fhir",
          requiresAuth: false,
        },
      ],
    };
    localStorage.setItem("fhir-server-url", "http://open.example.com/fhir");
    sessionStorage.setItem(
      "spa_userinfo",
      JSON.stringify({
        name: "Jane Doe",
        fhirUser: "Practitioner/prac-1",
        fhirUserType: "Practitioner",
      }),
    );

    const { result } = await renderUseAuth();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.fhirUser).toBe("Practitioner/prac-1");
  });

  it("activates for an unconfigured custom server with a matching custom-open record", async () => {
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        { name: "Local Provider Server", url: "http://localhost:8080/fhir" },
      ],
    };
    localStorage.setItem("fhir-server-url", "https://custom.example.com/fhir");
    localStorage.setItem(
      "fhir-custom-open-server",
      JSON.stringify({ url: "https://custom.example.com/fhir" }),
    );

    const { result } = await renderUseAuth();

    expect(result.current.localIdentityMode).toBe(true);
  });

  it("ignores stale unauthenticated session data after switching to an open server", async () => {
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        {
          name: "Open EHR",
          url: "http://open.example.com/fhir",
          requiresAuth: false,
        },
      ],
    };
    localStorage.setItem("fhir-server-url", "http://open.example.com/fhir");
    sessionStorage.setItem(
      "spa_userinfo",
      JSON.stringify({
        name: "Jane Doe",
        fhirUser: "Practitioner/prac-1",
        fhirUserType: "Practitioner",
      }),
    );

    vi.resetModules();
    const { useAuth: dynamicUseAuth } = await import("./use-auth");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Simulate the session query cache left over from the previous
    // auth-required server, before the SPA was reloaded.
    queryClient.setQueryData(["auth", "session"], { authenticated: false });
    const { result } = renderHook(() => dynamicUseAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    expect(result.current.localIdentityMode).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(sessionStorage.getItem("spa_userinfo")).not.toBeNull();
  });

  it("does not activate for the same custom server without a custom-open record", async () => {
    window.APP_CONFIG = {
      authEnabled: true,
      fhirServers: [
        { name: "Local Provider Server", url: "http://localhost:8080/fhir" },
      ],
    };
    localStorage.setItem("fhir-server-url", "https://custom.example.com/fhir");

    const { result } = await renderUseAuth();

    expect(result.current.localIdentityMode).toBe(false);
  });
});
