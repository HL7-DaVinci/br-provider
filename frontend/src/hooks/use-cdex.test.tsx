import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { Task } from "fhir/r4";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loggedFetch } from "@/lib/logged-fetch";
import { useSubmitAttachment } from "./use-cdex";
import { fhirFetch } from "./use-fhir-api";

vi.mock("@/lib/logged-fetch", () => ({
  loggedFetch: vi.fn(),
}));

vi.mock("./use-fhir-api", () => ({
  fhirFetch: vi.fn(),
}));

const loggedFetchMock = vi.mocked(loggedFetch);
const fhirFetchMock = vi.mocked(fhirFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const TASK: Task = {
  resourceType: "Task",
  status: "requested",
  intent: "order",
  identifier: [{ system: "http://example.org/acn", value: "ACN-1" }],
  for: { reference: "Patient/pat-1" },
  input: [
    {
      type: { coding: [{ code: "payer-url" }] },
      valueUrl: "http://payer.example/fhir",
    },
  ],
};

const PARAMS = {
  task: TASK,
  payerFhirUrl: "http://payer.example/fhir",
  providerFhirUrl: "http://provider.example/fhir",
  questionnaireResponseIds: ["qr-1"],
};

describe("useSubmitAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fhirFetchMock.mockImplementation(((url: string) => {
      if (url.includes("/Patient/")) {
        return Promise.resolve({ resourceType: "Patient", id: "pat-1" });
      }
      return Promise.resolve({
        resourceType: "QuestionnaireResponse",
        id: "qr-1",
        status: "completed",
      });
    }) as typeof fhirFetch);
  });

  it("builds the Parameters client-side and POSTs through the thin payer proxy", async () => {
    loggedFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        resourceType: "OperationOutcome",
        issue: [
          {
            severity: "information",
            code: "informational",
            diagnostics: "accepted",
          },
        ],
      }),
    } as Response);

    const { result } = renderHook(() => useSubmitAttachment(), {
      wrapper: createWrapper(),
    });

    const outcome = await result.current.mutateAsync(PARAMS);

    expect(outcome?.resourceType).toBe("OperationOutcome");

    const [url, init, meta] = loggedFetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/fhir-proxy");
    expect(String(url)).toContain("payer=true");
    expect(String(url)).toContain("op=submit-attachment");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    expect(body.resourceType).toBe("Parameters");
    const trackingId = body.parameter.find(
      (p: { name: string }) => p.name === "TrackingId",
    );
    expect(trackingId.valueIdentifier.value).toBe("ACN-1");
    expect(meta.operationName).toBe("$submit-attachment");
  });

  it("throws the OperationOutcome diagnostics on a 4xx response", async () => {
    loggedFetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        resourceType: "OperationOutcome",
        issue: [
          {
            severity: "error",
            code: "invalid",
            diagnostics: "AttachTo must be 'claim' or 'preauthorization'.",
          },
        ],
      }),
    } as Response);

    const { result } = renderHook(() => useSubmitAttachment(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync(PARAMS)).rejects.toThrow(
      "AttachTo must be",
    );
  });
});
