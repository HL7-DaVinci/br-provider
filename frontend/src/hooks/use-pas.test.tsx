import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { Bundle, ClaimResponse, Task } from "fhir/r4";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fhirFetch } from "./use-fhir-api";
import {
  extractClaimResponseFromInquiry,
  usePasDocumentationTasks,
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
          coding: [{ code: "questionnaires-needed" }],
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
});
