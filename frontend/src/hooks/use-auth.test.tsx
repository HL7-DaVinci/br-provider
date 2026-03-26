import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
