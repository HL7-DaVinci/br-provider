import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Bundle,
  Claim,
  ClaimResponse,
  Coverage,
  FhirResource,
  Identifier,
  Organization,
  Patient,
  Practitioner,
  QuestionnaireResponse,
  Task,
} from "fhir/r4";
import { fhirProxyUrl, fhirSend } from "@/lib/api";
import { getPasNotificationUrl } from "@/lib/fhir-config";
import { extractFhirError } from "@/lib/fhir-types";
import { loggedFetch } from "@/lib/logged-fetch";
import {
  buildPasInquiryBundle,
  buildPasRequestBundle,
  type PasInquiryResources,
  type PasSubmitResources,
  PROVIDER_ORG_IDENTIFIER,
} from "@/lib/pas-bundle-builder";
import { buildPasSubscription } from "@/lib/pas-subscription-builder";
import { ensurePasTasks } from "@/lib/pas-task-builder";
import { fhirFetch } from "./use-fhir-api";
import { useFhirServer } from "./use-fhir-server";
import { getStoredPractitionerRef } from "./use-practitioner-ref";

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

async function readPractitionerFromOrder(
  base: string,
  order: FhirResource,
): Promise<Practitioner> {
  const orderRef = (order as { requester?: { reference?: string } }).requester
    ?.reference;
  const ref = orderRef?.startsWith("Practitioner/")
    ? orderRef
    : getStoredPractitionerRef();
  if (ref?.startsWith("Practitioner/")) {
    return fhirFetch<Practitioner>(`${base}/${ref}`);
  }
  throw new Error("No practitioner available for PAS submission");
}

async function readInsurerFromCoverage(
  base: string,
  coverage: Coverage,
): Promise<Organization> {
  const ref = coverage.payor?.[0]?.reference;
  if (ref?.startsWith("Organization/")) {
    return fhirFetch<Organization>(`${base}/${ref}`);
  }
  throw new Error("No insurer Organization resolvable from Coverage.payor");
}

/** Reads the provider resources a PAS Claim/$submit Bundle references. */
async function readPasSubmitResources(
  params: PasSubmitParams,
): Promise<PasSubmitResources> {
  const base = params.providerFhirUrl;
  const [patient, order, coverage] = await Promise.all([
    fhirFetch<Patient>(`${base}/Patient/${params.patientId}`),
    fhirFetch<FhirResource>(`${base}/${params.orderType}/${params.orderId}`),
    fhirFetch<Coverage>(`${base}/Coverage/${params.coverageId}`),
  ]);
  const [practitioner, insurer, questionnaireResponses] = await Promise.all([
    readPractitionerFromOrder(base, order),
    readInsurerFromCoverage(base, coverage),
    Promise.all(
      params.questionnaireResponseIds.map((id) =>
        fhirFetch<QuestionnaireResponse>(`${base}/QuestionnaireResponse/${id}`),
      ),
    ),
  ]);
  return {
    patient,
    practitioner,
    insurer,
    coverage,
    order,
    orderType: params.orderType,
    questionnaireResponses,
  };
}

/**
 * Mutation hook for submitting a prior authorization request.
 * Sends patient/order/coverage context to the backend, which assembles the PAS
 * bundle and relays it to the payer's Claim/$submit endpoint.
 */
export function usePasSubmit() {
  return useMutation({
    mutationFn: async (params: PasSubmitParams): Promise<PasSubmitResult> => {
      const bundle = buildPasRequestBundle(
        await readPasSubmitResources(params),
        params.providerFhirUrl,
      );
      const response = await loggedFetch(
        fhirProxyUrl(`${params.payerFhirUrl}/Claim/$submit`, {
          payer: true,
          op: "pas-submit",
        }),
        {
          method: "POST",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(bundle),
        },
        { payerUrl: params.payerFhirUrl, operationName: "Claim/$submit" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          extractFhirError(body) ?? `PAS submit failed: ${response.status}`,
        );
      }
      const claim = bundle.entry?.find(
        (e) => e.resource?.resourceType === "Claim",
      )?.resource as Claim | undefined;
      return extractPasResult(
        await response.json(),
        params.payerFhirUrl,
        `${params.orderType}/${params.orderId}`,
        `Patient/${params.patientId}`,
        claim?.identifier?.[0],
      );
    },
  });
}

async function putTaskToProvider(serverUrl: string, task: Task): Promise<Task> {
  const response = await fhirSend(`${serverUrl}/Task/${task.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/fhir+json" },
    body: JSON.stringify(task),
  });
  if (!response.ok) {
    throw new Error(`Failed to persist Task/${task.id}: ${response.status}`);
  }
  return (await response.json()) as Task;
}

/**
 * Persists a ClaimResponse to the active provider FHIR server, upserting by its tracking identifier so
 * resubmitting a given response is idempotent. Lets the UI read PA status from the stored ClaimResponse
 * without re-querying the payer.
 */
export async function persistClaimResponseToProvider(
  serverUrl: string,
  claimResponse: ClaimResponse,
  patientRef: string,
): Promise<void> {
  const trackingId = claimResponse.identifier?.[0]?.value;
  if (!trackingId) return;
  const response = await fhirSend(
    `${serverUrl}/ClaimResponse?identifier=${encodeURIComponent(trackingId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json" },
      // Conditional update by identifier (drop id). Every reference on the payer's
      // ClaimResponse points at payer-side resources that do not exist here: request,
      // requestor, insurer, and communicationRequest are dropped, and patient is
      // rewritten to this provider's Patient so local patient-scoped queries work.
      body: JSON.stringify({
        ...claimResponse,
        id: undefined,
        request: undefined,
        requestor: undefined,
        insurer: undefined,
        communicationRequest: undefined,
        patient: { reference: patientRef },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to persist ClaimResponse: ${response.status}`);
  }
}

function invalidateDocumentationTaskQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["fhir", "Task"] });
  queryClient.invalidateQueries({
    queryKey: ["pas", "patient-documentation-tasks"],
  });
  queryClient.invalidateQueries({ queryKey: ["pas", "documentation-tasks"] });
  queryClient.invalidateQueries({ queryKey: ["pas", "all-tasks"] });
}

/**
 * Persists provider-built PAS documentation Tasks to the active provider FHIR server.
 */
export function usePersistDocumentationTasks() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tasks: Task[]): Promise<Task[]> => {
      const persisted: Task[] = [];
      for (const task of tasks) {
        if (!task.id) continue;
        persisted.push(await putTaskToProvider(serverUrl, task));
      }
      return persisted;
    },
    onSuccess: () => invalidateDocumentationTaskQueries(queryClient),
  });
}

export interface CompleteDocumentationTaskParams {
  task: Task;
  questionnaireResponseIds: string[];
}

/**
 * Marks a persisted documentation Task as completed and records the submitted
 * QuestionnaireResponse(s) in Task.output. Called after a successful $submit-attachment so the
 * provider's own Task reflects that the requested documentation was sent.
 */
export function useCompleteDocumentationTask() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      task,
      questionnaireResponseIds,
    }: CompleteDocumentationTaskParams): Promise<Task | null> => {
      if (!task.id) return null;
      const completed: Task = {
        ...task,
        status: "completed",
        output: [
          ...(task.output ?? []),
          ...questionnaireResponseIds.map((id) => ({
            type: { text: "Submitted attachment" },
            valueReference: { reference: `QuestionnaireResponse/${id}` },
          })),
        ],
      };
      return putTaskToProvider(serverUrl, completed);
    },
    onSuccess: () => invalidateDocumentationTaskQueries(queryClient),
  });
}

/**
 * Creates a PAS rest-hook Subscription on the payer so it notifies the provider when a pended prior
 * authorization is finalized. Best-effort: a failure here does not block the PA flow.
 */
export function useEnsurePasSubscription() {
  const { serverUrl } = useFhirServer();
  return useMutation({
    mutationFn: async (payerFhirUrl: string): Promise<void> => {
      const subscription = buildPasSubscription({
        orgIdentifier: PROVIDER_ORG_IDENTIFIER,
        notificationUrl: getPasNotificationUrl(serverUrl),
      });
      const response = await loggedFetch(
        fhirProxyUrl(`${payerFhirUrl}/Subscription`, {
          payer: true,
          op: "subscription",
        }),
        {
          method: "POST",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(subscription),
        },
        { payerUrl: payerFhirUrl, operationName: "Subscription create" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          extractFhirError(body) ?? `PAS subscribe failed: ${response.status}`,
        );
      }
    },
  });
}

const TASK_CODE_QUESTIONNAIRE_REQUEST = "attachment-request-questionnaire";

/** Whether a Task is a PAS documentation request (code attachment-request-questionnaire). */
function isDocumentationTask(task: Task): boolean {
  return !!task.code?.coding?.some(
    (c) => c.code === TASK_CODE_QUESTIONNAIRE_REQUEST,
  );
}

/** Extract the ClaimResponse and build documentation Tasks from a PAS response Bundle. */
function extractPasResult(
  data: unknown,
  payerFhirUrl: string,
  orderRef: string,
  patientRef: string,
  claimIdentifier?: Identifier,
): PasSubmitResult {
  const bundle = data as Bundle;
  if (bundle.resourceType === "Bundle" && bundle.entry?.length) {
    const cr = bundle.entry.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse | undefined;

    if (cr) {
      return {
        claimResponse: cr,
        documentationTasks: ensurePasTasks(
          bundle,
          payerFhirUrl,
          orderRef,
          patientRef,
          claimIdentifier,
        ),
      };
    }
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
  claimTrackingId?: string;
  orderRef?: string;
}

/**
 * Queries the payer for an updated ClaimResponse. With full context (patient + coverage + provider)
 * it issues a Claim/$inquire query-by-example; otherwise it reads the ClaimResponse directly.
 */
export function usePasInquiry(params: PasInquiryParams | undefined) {
  return useQuery({
    queryKey: ["pas", "inquiry", params?.claimResponseId],
    queryFn: async () => {
      if (!params) throw new Error("inquiry params are required");
      const data = await runPasInquiry(params);
      return extractClaimResponseFromInquiry(data, params.claimResponseId);
    },
    enabled: !!params?.claimResponseId,
  });
}

/** Runs a one-shot PAS inquiry and returns the resolved ClaimResponse. */
export async function fetchPasInquiry(
  params: PasInquiryParams,
): Promise<ClaimResponse> {
  return extractClaimResponseFromInquiry(
    await runPasInquiry(params),
    params.claimResponseId,
  );
}

async function runPasInquiry(params: PasInquiryParams): Promise<unknown> {
  if (params.patientId && params.coverageId && params.providerFhirUrl) {
    const bundle = buildPasInquiryBundle(
      await readPasInquiryResources(
        params.providerFhirUrl,
        params.patientId,
        params.coverageId,
        params.orderId,
        params.orderType,
      ),
      params.providerFhirUrl,
    );
    return relayInquiry(
      fhirProxyUrl(`${params.payerFhirUrl}/Claim/$inquire`, {
        payer: true,
        op: "pas-submit",
      }),
      {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(bundle),
      },
      params.payerFhirUrl,
      "Claim/$inquire",
    );
  }
  return relayInquiry(
    fhirProxyUrl(
      `${params.payerFhirUrl}/ClaimResponse/${params.claimResponseId}`,
      { payer: true, op: "read" },
    ),
    { method: "GET" },
    params.payerFhirUrl,
    "ClaimResponse read",
  );
}

async function relayInquiry(
  url: string,
  init: RequestInit,
  payerUrl: string,
  operationName: string,
): Promise<unknown> {
  const response = await loggedFetch(url, init, { payerUrl, operationName });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      extractFhirError(body) ?? `PAS inquiry failed: ${response.status}`,
    );
  }
  return response.json();
}

async function readPasInquiryResources(
  base: string,
  patientId: string,
  coverageId: string,
  orderId?: string,
  orderType?: string,
): Promise<PasInquiryResources> {
  const [patient, coverage] = await Promise.all([
    fhirFetch<Patient>(`${base}/Patient/${patientId}`),
    fhirFetch<Coverage>(`${base}/Coverage/${coverageId}`),
  ]);
  const insurer = await readInsurerFromCoverage(base, coverage);
  let practitioner: Practitioner | undefined;
  if (orderId && orderType) {
    const order = await fhirFetch<FhirResource>(
      `${base}/${orderType}/${orderId}`,
    );
    practitioner = await readPractitionerFromOrder(base, order).catch(
      () => undefined,
    );
  }
  return { patient, practitioner, insurer, coverage };
}

/**
 * Lists all DTR documentation-request tasks for a patient across every order.
 * Used by the patient-facing Documentation page; returns all Tasks whose code
 * is `attachment-request-questionnaire` without requiring a specific claim/
 * order filter.
 */
export function usePatientDocumentationTasks(
  patientId: string,
  providerFhirUrl: string,
) {
  return useQuery({
    queryKey: [
      "pas",
      "patient-documentation-tasks",
      providerFhirUrl,
      patientId,
    ],
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        patient: patientId,
        _sort: "-_lastUpdated",
        _count: "50",
      });

      try {
        const bundle = await fhirFetch<Bundle<Task>>(
          `${providerFhirUrl}/Task?${searchParams.toString()}`,
        );
        return (bundle.entry ?? [])
          .map((entry) => entry.resource)
          .filter(
            (resource): resource is Task => resource?.resourceType === "Task",
          )
          .filter(isDocumentationTask);
      } catch {
        return [];
      }
    },
    enabled: !!patientId && !!providerFhirUrl,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Org-wide Task worklist: every PAS/CDex Task on the provider server, newest
 * first. Polled so PAS-subscription-driven status changes surface without a
 * manual refresh.
 */
export function useAllTasks() {
  const { serverUrl } = useFhirServer();
  return useQuery({
    queryKey: ["pas", "all-tasks", serverUrl],
    queryFn: async () => {
      const bundle = await fhirFetch<Bundle<Task>>(
        `${serverUrl}/Task?_sort=-_lastUpdated&_count=50`,
      );
      return (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter(
          (resource): resource is Task => resource?.resourceType === "Task",
        );
    },
    enabled: !!serverUrl,
    refetchInterval: 30_000,
    retry: 1,
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
      params?.claimTrackingId,
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
          claimTrackingId: params.claimTrackingId,
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
      (!!params?.claimId ||
        !!params?.claimResponseId ||
        !!params?.claimTrackingId ||
        !!params?.orderRef),
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

export function extractTaskQuestionnaireContexts(tasks: Task[]): string[] {
  return [
    ...new Set(
      tasks.flatMap(
        (task) =>
          task.input
            ?.filter((input) =>
              input.type?.coding?.some(
                (coding) =>
                  coding.code === TASK_INPUT_CODE_QUESTIONNAIRE_CONTEXT,
              ),
            )
            .map((input) => input.valueString as string)
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
    claimTrackingId?: string;
    orderRef?: string;
  },
): Task[] {
  const hasCriteria =
    !!criteria.claimId ||
    !!criteria.claimResponseId ||
    !!criteria.claimTrackingId ||
    !!criteria.orderRef;

  return tasks.filter((task) => {
    if (!isDocumentationTask(task)) {
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
        )) ||
      (criteria.claimTrackingId &&
        task.reasonReference?.identifier?.value === criteria.claimTrackingId);
    const hasClaimLink =
      !!task.reasonReference?.reference ||
      !!task.reasonReference?.identifier?.value;

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
      (criteria.claimId ||
        criteria.claimResponseId ||
        criteria.claimTrackingId) &&
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
    // Match on the logical id (in-memory path, payer id) or the tracking identifier
    // (rehydrated path, where the provider copy is keyed by the identifier value).
    const match = claimResponses.find(
      (claimResponse) =>
        claimResponse.id === claimResponseId ||
        claimResponse.identifier?.some((id) => id.value === claimResponseId),
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

const TASK_INPUT_CODE_QUESTIONNAIRE_CONTEXT = "questionnaire-context";
