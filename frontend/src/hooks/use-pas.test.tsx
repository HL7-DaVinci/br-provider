import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { Bundle, ClaimResponse, Task } from "fhir/r4";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fhirFetch } from "./use-fhir-api";
import {
  extractClaimResponseFromInquiry,
  extractTaskQuestionnaireContexts,
  usePasDocumentationTasks,
  usePasSubmit,
} from "./use-pas";

vi.mock("./use-fhir-api", () => ({
  fhirFetch: vi.fn(),
}));

const fhirFetchMock = vi.mocked(fhirFetch);

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

function buildClaimResponse(id: string, created: string): ClaimResponse {
  return {
    resourceType: "ClaimResponse",
    id,
    status: "active",
    type: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/claim-type",
          code: "professional",
        },
      ],
    },
    use: "preauthorization",
    patient: { reference: "Patient/pat-1" },
    created,
    insurer: { reference: "Organization/org-1" },
    outcome: "queued",
  };
}

function buildTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    resourceType: "Task",
    id,
    status: "requested",
    intent: "order",
    code: {
      coding: [{ code: "attachment-request-questionnaire" }],
    },
    input: [
      {
        type: {
          coding: [{ code: "questionnaire-context" }],
        },
        valueCanonical: `http://example.org/Questionnaire/${id}`,
      },
    ],
    ...overrides,
  };
}

describe("usePas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the requested ClaimResponse from multi-bundle $inquire results", () => {
    const requestedClaimResponse = buildClaimResponse(
      "cr-requested",
      "2026-03-28T10:00:00Z",
    );
    const newerClaimResponse = buildClaimResponse(
      "cr-newer",
      "2026-03-28T12:00:00Z",
    );

    const response = {
      resourceType: "Parameters",
      parameter: [
        {
          name: "responseBundle",
          resource: {
            resourceType: "Bundle",
            entry: [{ resource: requestedClaimResponse }],
            type: "collection",
          },
        },
        {
          name: "responseBundle",
          resource: {
            resourceType: "Bundle",
            entry: [{ resource: newerClaimResponse }],
            type: "collection",
          },
        },
      ],
    } satisfies {
      resourceType: "Parameters";
      parameter: Array<{ name: string; resource: Bundle }>;
    };

    expect(extractClaimResponseFromInquiry(response, "cr-requested")).toEqual(
      requestedClaimResponse,
    );
  });

  it("matches the requested ClaimResponse by tracking identifier", () => {
    const claimResponse: ClaimResponse = {
      ...buildClaimResponse("1826", "2026-06-05T10:00:00Z"),
      identifier: [
        {
          system: "http://example.org/PATIENT_EVENT_TRACE_NUMBER",
          value: "trace-abc",
        },
      ],
    };

    const response = {
      resourceType: "Parameters",
      parameter: [
        {
          name: "responseBundle",
          resource: {
            resourceType: "Bundle",
            type: "collection",
            entry: [{ resource: claimResponse }],
          },
        },
      ],
    } satisfies {
      resourceType: "Parameters";
      parameter: Array<{ name: string; resource: Bundle }>;
    };

    // The provider copy is keyed by the tracking identifier, so rehydration passes that value.
    expect(extractClaimResponseFromInquiry(response, "trace-abc")).toEqual(
      claimResponse,
    );
  });

  it("rehydrates PAS documentation tasks by claim and order context", async () => {
    fhirFetchMock.mockResolvedValue({
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        {
          resource: buildTask("task-match", {
            reasonReference: { reference: "Claim/claim-1" },
            basedOn: [{ reference: "ServiceRequest/order-1" }],
          }),
        },
        {
          resource: buildTask("task-other-claim", {
            reasonReference: { reference: "Claim/claim-2" },
            basedOn: [{ reference: "ServiceRequest/order-1" }],
          }),
        },
        {
          resource: buildTask("task-other-order", {
            reasonReference: { reference: "Claim/claim-1" },
            basedOn: [{ reference: "ServiceRequest/order-2" }],
          }),
        },
      ],
    } satisfies Bundle<Task>);

    const { result } = renderHook(
      () =>
        usePasDocumentationTasks({
          patientId: "pat-1",
          providerFhirUrl: "http://provider.example/fhir",
          claimId: "claim-1",
          orderRef: "ServiceRequest/order-1",
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fhirFetchMock).toHaveBeenCalledWith(
      "http://provider.example/fhir/Task?patient=pat-1&_sort=-_lastUpdated&_count=50",
    );
    expect(result.current.data?.map((task) => task.id)).toEqual(["task-match"]);
  });

  it("rehydrates PAS documentation tasks by claim tracking identifier", async () => {
    fhirFetchMock.mockResolvedValue({
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        {
          resource: buildTask("task-tracked", {
            reasonReference: {
              type: "ClaimResponse",
              identifier: { system: "http://example.org/acn", value: "ACN-9" },
            },
          }),
        },
        {
          resource: buildTask("task-other-tracking", {
            reasonReference: {
              type: "ClaimResponse",
              identifier: {
                system: "http://example.org/acn",
                value: "ACN-OTHER",
              },
            },
          }),
        },
      ],
    } satisfies Bundle<Task>);

    const { result } = renderHook(
      () =>
        usePasDocumentationTasks({
          patientId: "pat-1",
          providerFhirUrl: "http://provider.example/fhir",
          claimTrackingId: "ACN-9",
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.map((task) => task.id)).toEqual([
      "task-tracked",
    ]);
  });

  it("rejects a PAS submit when no practitioner is available", async () => {
    fhirFetchMock.mockImplementation((url: string) => {
      if (url.includes("/Patient/")) {
        return Promise.resolve({ resourceType: "Patient", id: "pat-1" });
      }
      if (url.includes("/Coverage/")) {
        return Promise.resolve({
          resourceType: "Coverage",
          id: "cov-1",
          status: "active",
        });
      }
      if (url.includes("/ServiceRequest/")) {
        return Promise.resolve({
          resourceType: "ServiceRequest",
          id: "order-1",
          status: "active",
          intent: "order",
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const { result } = renderHook(() => usePasSubmit(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      patientId: "pat-1",
      orderId: "order-1",
      orderType: "ServiceRequest",
      coverageId: "cov-1",
      questionnaireResponseIds: [],
      payerFhirUrl: "http://payer.example/fhir",
      providerFhirUrl: "http://provider.example/fhir",
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(
      new Error("No practitioner available for PAS submission"),
    );
  });
});

describe("extractTaskQuestionnaireContexts", () => {
  function taskWithContexts(...contextIds: string[]): Task {
    return {
      resourceType: "Task",
      id: "task-1",
      status: "requested",
      intent: "order",
      input: contextIds.map((contextId) => ({
        type: {
          coding: [
            {
              system:
                "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes",
              code: "questionnaire-context",
            },
          ],
        },
        valueString: contextId,
      })),
    };
  }

  it("yields two launchable entries from a Task with two questionnaire-context inputs", () => {
    const task = taskWithContexts("assert-1", "assert-2");
    expect(extractTaskQuestionnaireContexts([task])).toEqual([
      "assert-1",
      "assert-2",
    ]);
  });
});
