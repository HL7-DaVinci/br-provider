import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { Bundle } from "fhir/r4";
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
      headers: new Headers(),
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
      headers: new Headers(),
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

describe("changedsince package fetch", () => {
  const SINCE = "2026-11-01T10:00:00.000Z";
  const EMPTY_RESPONSE = { resourceType: "Parameters", parameter: [] };

  function packageResponse(body: unknown, date?: string): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers(date ? { Date: date } : {}),
      json: async () => body,
    } as Response;
  }

  function sentChangedSince(callIdx: number): string | undefined {
    const init = loggedFetchMock.mock.calls[callIdx]?.[1];
    const body = JSON.parse(init?.body as string);
    return body.parameter.find(
      (p: { name: string }) => p.name === "changedsince",
    )?.valueInstant;
  }

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

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
  });

  it("re-fetches in full when the payer reports nothing changed", async () => {
    loggedFetchMock
      .mockResolvedValueOnce(packageResponse(EMPTY_RESPONSE))
      .mockResolvedValueOnce(
        packageResponse(PACKAGE_RESPONSE, "Fri, 20 Nov 2026 12:00:00 GMT"),
      );

    const { result } = renderHook(
      () => useQuestionnairePackageEntries({ ...PARAMS, changedSince: SINCE }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]?.questionnaire).not.toBeNull(),
    );

    expect(loggedFetchMock).toHaveBeenCalledTimes(2);
    expect(sentChangedSince(0)).toBe(SINCE);
    expect(sentChangedSince(1)).toBeUndefined();
    expect(result.current[0]?.changedSinceOutcome).toBe("unchanged");
    // Never later than the response's Date header.
    expect(
      (result.current[0]?.retrievedAt ?? "") <= "2026-11-20T12:00:00.000Z",
    ).toBe(true);
  });

  it("uses the returned package when the payer reports a change", async () => {
    loggedFetchMock.mockResolvedValue(packageResponse(PACKAGE_RESPONSE));

    const { result } = renderHook(
      () => useQuestionnairePackageEntries({ ...PARAMS, changedSince: SINCE }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]?.questionnaire).not.toBeNull(),
    );

    expect(loggedFetchMock).toHaveBeenCalledTimes(1);
    expect(result.current[0]?.changedSinceOutcome).toBe("changed");
    expect(result.current[0]?.retrievedAt).toEqual(expect.any(String));
  });

  it("uses an adaptive draft's own package when nothing changed", async () => {
    loggedFetchMock.mockResolvedValue(packageResponse(EMPTY_RESPONSE));
    const unchangedBundle = PACKAGE_RESPONSE.parameter[0]?.resource as Bundle;

    const { result } = renderHook(
      () =>
        useQuestionnairePackageEntries({
          ...PARAMS,
          changedSince: SINCE,
          unchangedBundle,
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]?.questionnaire).not.toBeNull(),
    );

    expect(loggedFetchMock).toHaveBeenCalledTimes(1);
    expect(result.current[0]?.changedSinceOutcome).toBe("unchanged");
    expect(result.current[0]?.retrievedAt).toBe(SINCE);
  });

  it("retries without changedsince when the payer returns an error outcome", async () => {
    loggedFetchMock
      .mockResolvedValueOnce(
        packageResponse({
          resourceType: "Parameters",
          parameter: [
            {
              name: "outcome",
              resource: {
                resourceType: "OperationOutcome",
                issue: [{ severity: "error", code: "processing" }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(packageResponse(PACKAGE_RESPONSE));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unchangedBundle = PACKAGE_RESPONSE.parameter[0]?.resource as Bundle;

    const { result } = renderHook(
      () =>
        useQuestionnairePackageEntries({
          ...PARAMS,
          changedSince: SINCE,
          unchangedBundle,
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]?.questionnaire).not.toBeNull(),
    );

    // The draft's package is not used: an error is not "nothing changed".
    expect(loggedFetchMock).toHaveBeenCalledTimes(2);
    expect(sentChangedSince(1)).toBeUndefined();
    expect(result.current[0]?.changedSinceOutcome).toBeNull();
    expect(result.current[0]?.retrievedAt).not.toBe(SINCE);
    warn.mockRestore();
  });

  it("omits changedsince on multi-context fan-out calls", async () => {
    loggedFetchMock.mockResolvedValue(packageResponse(PACKAGE_RESPONSE));

    const { result } = renderHook(
      () =>
        useQuestionnairePackageEntries({
          ...PARAMS,
          questionnaire: undefined,
          coverageAssertionId: "ctx-1,ctx-2",
          changedSince: SINCE,
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current[0]?.questionnaire).not.toBeNull(),
    );

    expect(sentChangedSince(0)).toBeUndefined();
    expect(sentChangedSince(1)).toBeUndefined();
  });
});
