import { useMutation, useQuery } from "@tanstack/react-query";
import type { Bundle, ClaimResponse, Task } from "fhir/r4";
import { ACTIVE_PROVIDER_FHIR_BASE_HEADER } from "@/lib/api";
import { loggedFetch } from "@/lib/logged-fetch";
import { fhirFetch } from "./use-fhir-api";

export interface PasSubmitParams {
  patientId: string;
  orderId: string;
  orderType: string;
  coverageId: string;
  questionnaireResponseIds: string[];
  payerFhirUrl: string;
  providerFhirUrl: string;
}

/** Parsed PAS response containing the ClaimResponse and any documentation request Tasks. */
export interface PasSubmitResult {
  claimResponse: ClaimResponse;
  /** PAS Tasks with code "attachment-request-questionnaire" requesting DTR completion */
  documentationTasks: Task[];
}

/**
 * Mutation hook for submitting a prior authorization request via the PAS proxy.
 * Sends patient/order/coverage context to the backend, which assembles the PAS
 * bundle and relays it to the payer's Claim/$submit endpoint.
 */
export function usePasSubmit() {
  return useMutation({
    mutationFn: async (params: PasSubmitParams): Promise<PasSubmitResult> => {
      const response = await loggedFetch(
        "/api/pas/submit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [ACTIVE_PROVIDER_FHIR_BASE_HEADER]: params.providerFhirUrl,
          },
          body: JSON.stringify(params),
          credentials: "same-origin",
        },
        { payerUrl: params.payerFhirUrl, operationName: "Claim/$submit" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `PAS submit failed: ${response.status}`);
      }
      const body = await response.json();
      return extractPasResult(body);
    },
  });
}

export interface PasUpdateParams extends PasSubmitParams {
  priorClaimId: string;
}

/**
 * Mutation hook for submitting a PAS update after additional documentation.
 * Builds a Claim with related referencing the prior Claim.
 */
export function usePasUpdate() {
  return useMutation({
    mutationFn: async (params: PasUpdateParams): Promise<PasSubmitResult> => {
      const response = await loggedFetch(
        "/api/pas/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [ACTIVE_PROVIDER_FHIR_BASE_HEADER]: params.providerFhirUrl,
          },
          body: JSON.stringify(params),
          credentials: "same-origin",
        },
        {
          payerUrl: params.payerFhirUrl,
          operationName: "Claim/$submit (update)",
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `PAS update failed: ${response.status}`);
      }
      const body = await response.json();
      return extractPasResult(body);
    },
  });
}

const TASK_CODE_QUESTIONNAIRE_REQUEST = "attachment-request-questionnaire";

/** Extract the ClaimResponse and documentation Tasks from a PAS response Bundle. */
function extractPasResult(data: unknown): PasSubmitResult {
  const bundle = data as Bundle;
  if (bundle.resourceType === "Bundle" && bundle.entry?.length) {
    const cr = bundle.entry.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse | undefined;

    const tasks = bundle.entry
      .filter((e) => e.resource?.resourceType === "Task")
      .map((e) => e.resource as Task)
      .filter((t) =>
        t.code?.coding?.some((c) => c.code === TASK_CODE_QUESTIONNAIRE_REQUEST),
      );

    if (cr) return { claimResponse: cr, documentationTasks: tasks };
  }
  // If the server already unwrapped it, use as-is
  if ((data as ClaimResponse).resourceType === "ClaimResponse") {
    return { claimResponse: data as ClaimResponse, documentationTasks: [] };
  }
  throw new Error("No ClaimResponse found in PAS response");
}

export interface PasInquiryParams {
  claimResponseId: string;
  payerFhirUrl: string;
  patientId?: string;
  orderId?: string;
  orderType?: string;
  coverageId?: string;
  providerFhirUrl?: string;
}

export interface PasDocumentationTaskParams {
  patientId: string;
  providerFhirUrl: string;
  claimId?: string;
  claimResponseId?: string;
  orderRef?: string;
}

/**
 * Query hook that polls the payer for an updated ClaimResponse status.
 * When patientId + coverageId are provided, the backend uses a proper
 * Claim/$inquire operation per the PAS IG. Otherwise falls back to
 * GET /ClaimResponse/{id}.
 */
export function usePasInquiry(params: PasInquiryParams | undefined) {
  return useQuery({
    queryKey: ["pas", "inquiry", params?.claimResponseId],
    queryFn: async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (params?.providerFhirUrl) {
        headers[ACTIVE_PROVIDER_FHIR_BASE_HEADER] = params.providerFhirUrl;
      }
      const response = await loggedFetch(
        "/api/pas/inquiry",
        {
          method: "POST",
          headers,
          body: JSON.stringify(params),
          credentials: "same-origin",
        },
        {
          payerUrl: params?.payerFhirUrl ?? "",
          operationName: "Claim/$inquire",
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ?? `PAS inquiry failed: ${response.status}`,
        );
      }
      const data = await response.json();
      return extractClaimResponseFromInquiry(data, params?.claimResponseId);
    },
    enabled: !!params?.claimResponseId,
    refetchInterval: (query) => {
      const latest = query.state.data as ClaimResponse | undefined;
      if (
        latest &&
        latest.outcome !== "queued" &&
        latest.outcome !== "partial"
      ) {
        return false;
      }
      return params?.claimResponseId ? 30_000 : false;
    },
  });
}

/**
 * Rehydrates PAS documentation-request tasks from the provider FHIR server when
 * the page is reopened from an existing ClaimResponse link.
 */
export function usePasDocumentationTasks(
  params: PasDocumentationTaskParams | undefined,
) {
  return useQuery({
    queryKey: [
      "pas",
      "documentation-tasks",
      params?.providerFhirUrl,
      params?.patientId,
      params?.claimId,
      params?.claimResponseId,
      params?.orderRef,
    ],
    queryFn: async () => {
      if (!params?.patientId || !params.providerFhirUrl) return [];

      const searchParams = new URLSearchParams({
        patient: params.patientId,
        _sort: "-_lastUpdated",
        _count: "50",
      });

      try {
        const bundle = await fhirFetch<Bundle<Task>>(
          `${params.providerFhirUrl}/Task?${searchParams.toString()}`,
        );
        const tasks = (bundle.entry ?? [])
          .map((entry) => entry.resource)
          .filter(
            (resource): resource is Task => resource?.resourceType === "Task",
          );

        return filterPasDocumentationTasks(tasks, {
          claimId: params.claimId,
          claimResponseId: params.claimResponseId,
          orderRef: params.orderRef,
        });
      } catch {
        // Some servers may not support Task search parameters consistently.
        return [];
      }
    },
    enabled:
      !!params?.patientId &&
      !!params?.providerFhirUrl &&
      (!!params?.claimId || !!params?.claimResponseId || !!params?.orderRef),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Extracts a ClaimResponse from an inquiry response. The proper $inquire
 * endpoint returns a Parameters resource with responseBundle entries;
 * the fallback GET returns a raw ClaimResponse.
 */
export function extractClaimResponseFromInquiry(
  data: unknown,
  claimResponseId?: string,
): ClaimResponse {
  const resource = data as {
    resourceType?: string;
    parameter?: Array<{ name?: string; resource?: Bundle }>;
  };

  if (resource.resourceType === "Parameters" && resource.parameter) {
    const claimResponses = resource.parameter.flatMap((param) =>
      param.name === "responseBundle"
        ? extractClaimResponsesFromBundle(param.resource)
        : [],
    );
    if (claimResponses.length > 0) {
      return selectClaimResponse(claimResponses, claimResponseId);
    }
  }

  if (resource.resourceType === "ClaimResponse") {
    return selectClaimResponse([data as ClaimResponse], claimResponseId);
  }

  // Bundle wrapping a single ClaimResponse (some payers return this)
  const bundle = data as Bundle;
  if (bundle.resourceType === "Bundle" && bundle.entry) {
    const claimResponses = extractClaimResponsesFromBundle(bundle);
    if (claimResponses.length > 0) {
      return selectClaimResponse(claimResponses, claimResponseId);
    }
  }

  throw new Error("No ClaimResponse found in inquiry response");
}

export function extractTaskQuestionnaireUrls(tasks: Task[]): string[] {
  return [
    ...new Set(
      tasks.flatMap(
        (task) =>
          task.input
            ?.filter((input) =>
              input.type?.coding?.some(
                (coding) =>
                  coding.code === TASK_INPUT_CODE_QUESTIONNAIRES_NEEDED,
              ),
            )
            .map((input) => (input.valueCanonical ?? input.valueUrl) as string)
            .filter(Boolean) ?? [],
      ),
    ),
  ];
}

export function filterPasDocumentationTasks(
  tasks: Task[],
  criteria: {
    claimId?: string;
    claimResponseId?: string;
    orderRef?: string;
  },
): Task[] {
  const hasCriteria =
    !!criteria.claimId || !!criteria.claimResponseId || !!criteria.orderRef;

  return tasks.filter((task) => {
    if (
      !task.code?.coding?.some(
        (coding) => coding.code === TASK_CODE_QUESTIONNAIRE_REQUEST,
      )
    ) {
      return false;
    }

    if (!hasCriteria) return true;

    const claimMatches =
      (criteria.claimId &&
        referenceMatches(
          task.reasonReference?.reference,
          `Claim/${criteria.claimId}`,
        )) ||
      (criteria.claimResponseId &&
        referenceMatches(
          task.reasonReference?.reference,
          `ClaimResponse/${criteria.claimResponseId}`,
        ));
    const hasClaimLink = !!task.reasonReference?.reference;

    const orderMatches =
      (criteria.orderRef &&
        (task.basedOn?.some((ref) =>
          referenceMatches(ref.reference, criteria.orderRef),
        ) ??
          false)) ||
      (criteria.orderRef &&
        referenceMatches(task.focus?.reference, criteria.orderRef));
    const hasOrderLink = !!task.focus?.reference || !!task.basedOn?.length;

    if (
      (criteria.claimId || criteria.claimResponseId) &&
      hasClaimLink &&
      !claimMatches
    ) {
      return false;
    }
    if (criteria.orderRef && hasOrderLink && !orderMatches) {
      return false;
    }

    return !!claimMatches || !!orderMatches;
  });
}

function extractClaimResponsesFromBundle(
  bundle: Bundle | undefined,
): ClaimResponse[] {
  return (bundle?.entry ?? [])
    .map((entry) => entry.resource)
    .filter(
      (resource): resource is ClaimResponse =>
        resource?.resourceType === "ClaimResponse",
    );
}

function selectClaimResponse(
  claimResponses: ClaimResponse[],
  claimResponseId?: string,
): ClaimResponse {
  if (claimResponses.length === 0) {
    throw new Error("No ClaimResponse found in inquiry response");
  }

  if (claimResponseId) {
    const match = claimResponses.find(
      (claimResponse) => claimResponse.id === claimResponseId,
    );
    if (match) return match;

    if (claimResponses.length === 1 && !claimResponses[0].id) {
      return claimResponses[0];
    }

    throw new Error(
      `No matching ClaimResponse found in inquiry response for ${claimResponseId}`,
    );
  }

  return claimResponses.reduce((best, current) => {
    const bestDate = best.created ?? best.meta?.lastUpdated ?? "";
    const currentDate = current.created ?? current.meta?.lastUpdated ?? "";
    return currentDate > bestDate ? current : best;
  });
}

function referenceMatches(
  reference: string | undefined,
  expectedReference: string | undefined,
): boolean {
  if (!reference || !expectedReference) return false;

  const normalizedReference = normalizeReference(reference);
  const normalizedExpected = normalizeReference(expectedReference);
  if (!normalizedReference || !normalizedExpected) return false;

  return (
    normalizedReference === normalizedExpected ||
    normalizedReference.endsWith(`/${normalizedExpected}`)
  );
}

function normalizeReference(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  return reference.split("?")[0]?.replace(/\/+$/, "");
}

const TASK_INPUT_CODE_QUESTIONNAIRES_NEEDED = "questionnaires-needed";
