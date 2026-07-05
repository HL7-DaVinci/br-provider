import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fhirSend } from "@/lib/api";
import { loggedFetch } from "@/lib/logged-fetch";
import {
  useQuestionnairePackageEntries,
  useQuestionnairePackages,
} from "./use-questionnaire";

vi.mock("@/lib/logged-fetch", () => ({
  loggedFetch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  fhirSend: vi.fn(),
  fhirProxyUrl: (url: string) => url,
}));

vi.mock("./use-fhir-server", () => ({
  useFhirServer: () => ({ serverUrl: "http://provider.example/fhir" }),
}));

const loggedFetchMock = vi.mocked(loggedFetch);
const fhirSendMock = vi.mocked(fhirSend);

const CANONICAL = "http://example.org/fhir/Questionnaire/home-o2";

const PACKAGE_RESPONSE = {
  resourceType: "Parameters",
  parameter: [
    {
      name: "packagebundle",
      resource: {
        resourceType: "Bundle",
        type: "collection",
        entry: [
          {
            resource: {
              resourceType: "Questionnaire",
              id: "home-o2",
              url: CANONICAL,
              status: "active",
            },
          },
        ],
      },
    },
  ],
};

const PARAMS = {
  payerFhirUrl: "http://payer.example/fhir",
  providerFhirUrl: "http://provider.example/fhir",
  coverageRef: "Coverage/cov-1",
  questionnaire: [CANONICAL],
};

describe("questionnaire package query cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fhirSendMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        resourceType: "Coverage",
        id: "cov-1",
        status: "active",
      }),
    } as Response);
    loggedFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PACKAGE_RESPONSE,
    } as Response);
  });

  it("both package hooks share the query key without corrupting each other's shape", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    // The per-canonical hook fetches first and seeds the shared cache entry.
    const packages = renderHook(
      () =>
        useQuestionnairePackages([CANONICAL], {
          payerFhirUrl: PARAMS.payerFhirUrl,
          providerFhirUrl: PARAMS.providerFhirUrl,
          coverageRef: PARAMS.coverageRef,
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(packages.result.current[0]?.questionnaire).not.toBeNull(),
    );

    // The entries hook then reads the same cache entry; with mismatched
    // shapes this threw "results.map is not a function".
    const entries = renderHook(() => useQuestionnairePackageEntries(PARAMS), {
      wrapper,
    });
    await waitFor(() =>
      expect(entries.result.current[0]?.questionnaire).not.toBeNull(),
    );

    expect(entries.result.current[0]?.canonical).toBe(CANONICAL);
    expect(packages.result.current[0]?.canonical).toBe(CANONICAL);
  });
});

describe("multi-context package fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fhirSendMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        resourceType: "Coverage",
        id: "cov-1",
        status: "active",
      }),
    } as Response);
    loggedFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PACKAGE_RESPONSE,
    } as Response);
  });

  it("fans out one $questionnaire-package call per context id, each with a single context parameter", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useQuestionnairePackageEntries({
          payerFhirUrl: "http://payer.example/fhir",
          providerFhirUrl: "http://provider.example/fhir",
          coverageRef: "Coverage/cov-1",
          coverageAssertionId: "ctx-1,ctx-2",
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]?.questionnaire).not.toBeNull(),
    );

    expect(loggedFetchMock).toHaveBeenCalledTimes(2);
    const contextValues = loggedFetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(init?.body as string);
      const contexts = body.parameter.filter(
        (p: { name: string }) => p.name === "context",
      );
      expect(contexts).toHaveLength(1);
      return contexts[0].valueString;
    });
    expect(contextValues.sort()).toEqual(["ctx-1", "ctx-2"]);

    // Both contexts resolved the same questionnaire: deduplicated to one entry.
    expect(result.current).toHaveLength(1);
  });
});
