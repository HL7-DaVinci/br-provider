import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useServerDiscovery } from "./use-fhir-server";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("forwards pending custom headers during server discovery", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ fhirServer: true, udapEnabled: false }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  renderHook(
    () =>
      useServerDiscovery("https://provider.example/fhir", true, [
        { name: "X-Api-Key", value: "secret" },
      ]),
    { wrapper },
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
  expect(headers.get("X-Fwd-X-Api-Key")).toBe("secret");
});
