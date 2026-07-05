import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Bundle,
  BundleEntry,
  ClaimResponse,
  Condition,
  Encounter,
  MedicationRequest,
  Organization,
  Patient,
  QuestionnaireResponse,
  Task,
} from "fhir/r4";
import { useMemo } from "react";
import { fhirSend } from "@/lib/api";
import {
  type buildDraftSaveTransactionBundle,
  type buildSignedOrdersTransactionBundle,
  extractTransactionOrderIds,
} from "@/lib/draft-orders";
import {
  ENCOUNTER_ORDER_TYPES,
  isOrderResourceType,
  ORDER_TYPES,
  type OrderEntry,
  type OrderResource,
} from "@/lib/order-types";
import { isPendedClaimResponse } from "@/lib/pas-pend-status";
import type { AnyQrStatus } from "@/lib/qr-status";
import { fhirFetch } from "./use-fhir-api";
import { useFhirServer } from "./use-fhir-server";

interface PatientSearchParams {
  family?: string;
  given?: string;
  birthdate?: string;
  identifier?: string;
}

export function usePatientSearch(
  params: PatientSearchParams,
  pageUrl?: string,
) {
  const { serverUrl } = useFhirServer();

  const searchParams = new URLSearchParams();
  searchParams.set("_count", "50");
  searchParams.set("_sort", "-_lastUpdated");

  if (params.family) searchParams.set("family", params.family);
  if (params.given) searchParams.set("given", params.given);
  if (params.birthdate) searchParams.set("birthdate", params.birthdate);
  if (params.identifier) searchParams.set("identifier", params.identifier);

  const hasSearchParams = !!(
    params.family ||
    params.given ||
    params.birthdate ||
    params.identifier
  );
  const url = pageUrl || `${serverUrl}/Patient?${searchParams.toString()}`;

  return useQuery({
    queryKey: ["fhir", "Patient", "search", serverUrl, params, url],
    queryFn: () => fhirFetch<Bundle<Patient>>(url),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && (hasSearchParams || !!pageUrl),
  });
}

export function usePatientList(pageUrl?: string) {
  const { serverUrl } = useFhirServer();
  const url =
    pageUrl ||
    `${serverUrl}/Patient?_count=20&_sort=-_lastUpdated&_total=accurate`;

  return useQuery({
    queryKey: ["fhir", "Patient", "list", url],
    queryFn: () => fhirFetch<Bundle<Patient>>(url),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl,
  });
}

export function usePatient(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Patient", patientId, serverUrl],
    queryFn: () => fhirFetch<Patient>(`${serverUrl}/Patient/${patientId}`),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useCoverage(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Coverage", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/Coverage?beneficiary=Patient/${patientId}&_count=10`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useOrganization(orgId: string | undefined) {
  const { serverUrl } = useFhirServer();
  return useQuery({
    queryKey: ["fhir", "Organization", orgId, serverUrl],
    queryFn: () =>
      orgId
        ? fhirFetch<Organization>(`${serverUrl}/Organization/${orgId}`)
        : Promise.resolve(undefined),
    enabled: !!serverUrl && !!orgId,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useConditions(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Condition", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Condition>>(
        `${serverUrl}/Condition?patient=${patientId}&_sort=-recorded-date&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useMedicationRequests(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "MedicationRequest", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<MedicationRequest>>(
        `${serverUrl}/MedicationRequest?patient=${patientId}&_sort=-authoredon&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useConditionCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Condition", "count", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/Condition?patient=${patientId}&clinical-status=active&_summary=count`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useMedicationRequestCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "MedicationRequest", "count", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/MedicationRequest?patient=${patientId}&status=active&_summary=count`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

/**
 * Gets total orders count (ServiceRequest, MedicationRequest, DeviceRequest, NutritionOrder) for a patient via FHIR batch.
 */
export function useOrderCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "OrderCount", patientId, serverUrl],
    queryFn: () => {
      const batchBundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: [
          {
            request: {
              method: "GET",
              url: `ServiceRequest?patient=${patientId}&_summary=count`,
            },
          },
          {
            request: {
              method: "GET",
              url: `MedicationRequest?patient=${patientId}&_summary=count`,
            },
          },
          {
            request: {
              method: "GET",
              url: `DeviceRequest?patient=${patientId}&_summary=count`,
            },
          },
          {
            request: {
              method: "GET",
              url: `NutritionOrder?patient=${patientId}&_summary=count`,
            },
          },
        ],
      };
      return fhirSend(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(batchBundle),
      })
        .then((response) => response.json())
        .then((bundle) => {
          const total = (bundle.entry || []).reduce(
            (sum: number, entry: BundleEntry) => {
              const entryBundle = entry.resource as Bundle;
              return sum + (entryBundle.total ?? 0);
            },
            0,
          );
          return { total };
        });
    },
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

function extractOrdersFromBatchResponse(bundle: Bundle): OrderEntry[] {
  const orders: OrderEntry[] = [];
  for (const entry of bundle.entry || []) {
    const innerBundle = entry.resource as Bundle;
    for (const innerEntry of innerBundle?.entry || []) {
      const resource = innerEntry.resource;
      if (resource && isOrderResourceType(resource.resourceType)) {
        orders.push({
          resource: resource as OrderResource,
          resourceType: resource.resourceType,
        });
      }
    }
  }
  return orders;
}

/**
 * Batch-fetches all 6 CRD order resource types for a patient,
 * returning a unified list with type metadata.
 */
export function useOrders(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Orders", patientId, serverUrl],
    queryFn: async () => {
      const batchBundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: ORDER_TYPES.map((type) => ({
          request: {
            method: "GET",
            url: `${type}?patient=${patientId}&_sort=-_lastUpdated&_count=50`,
          },
        })),
      };
      const response = await fhirSend(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(batchBundle),
      });
      const bundle = (await response.json()) as Bundle;
      return extractOrdersFromBatchResponse(bundle);
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function invalidateOrderQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["fhir", "Orders"] });
  queryClient.invalidateQueries({ queryKey: ["fhir", "DraftOrders"] });
  queryClient.invalidateQueries({ queryKey: ["fhir", "OrderCount"] });
}

function onEncounterMutationSuccess(
  queryClient: QueryClient,
  serverUrl: string | null,
  updated: Encounter,
) {
  queryClient.setQueryData(
    ["fhir", "Encounter", updated.id, serverUrl],
    updated,
  );
  const patientId = updated.subject?.reference?.replace(/^Patient\//, "");
  if (patientId) {
    queryClient.invalidateQueries({
      queryKey: ["fhir", "Encounter", "list", patientId, serverUrl],
    });
  }
}

export function useSaveOrders() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      bundle: ReturnType<typeof buildSignedOrdersTransactionBundle>,
    ) => {
      if (!serverUrl) {
        throw new Error("No provider FHIR server selected.");
      }

      const response = await fhirSend(serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(bundle),
      });

      if (!response.ok) {
        throw new Error(`Failed to save orders: ${response.status}`);
      }

      const transactionResponse = (await response.json()) as Bundle;
      return extractTransactionOrderIds(transactionResponse.entry);
    },
    onSuccess: () => invalidateOrderQueries(queryClient),
  });
}

/**
 * Marks an encounter as finished by setting status and period.end.
 */
export function useFinishEncounter() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (encounter: Encounter) => {
      const finished: Encounter = {
        ...encounter,
        status: "finished",
        period: {
          ...encounter.period,
          end: encounter.period?.end ?? new Date().toISOString(),
        },
      };

      const response = await fhirSend(
        `${serverUrl}/Encounter/${encounter.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(finished),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to finish encounter: ${response.status}`);
      }

      return (await response.json()) as Encounter;
    },
    onSuccess: (updated) =>
      onEncounterMutationSuccess(queryClient, serverUrl, updated),
  });
}

export function useEncounter(encounterId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Encounter", encounterId, serverUrl],
    queryFn: () =>
      fhirFetch<Encounter>(`${serverUrl}/Encounter/${encounterId}`),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId,
  });
}

export function useUpdateEncounter() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (encounter: Encounter) => {
      const response = await fhirSend(
        `${serverUrl}/Encounter/${encounter.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(encounter),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to update encounter: ${response.status}`);
      }
      return (await response.json()) as Encounter;
    },
    onSuccess: (updated) =>
      onEncounterMutationSuccess(queryClient, serverUrl, updated),
  });
}

async function fetchOrderBatch(
  serverUrl: string,
  types: readonly string[],
  queryParams: string,
): Promise<OrderEntry[]> {
  const batchBundle = {
    resourceType: "Bundle",
    type: "batch",
    entry: types.map((type) => ({
      request: { method: "GET", url: `${type}?${queryParams}&_count=50` },
    })),
  };
  const response = await fhirSend(serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/fhir+json" },
    body: JSON.stringify(batchBundle),
  });
  return extractOrdersFromBatchResponse((await response.json()) as Bundle);
}

export function useEncounterOrders(encounterId: string, patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Orders", "encounter", encounterId, serverUrl],
    queryFn: () =>
      fetchOrderBatch(
        serverUrl,
        ENCOUNTER_ORDER_TYPES,
        `patient=${patientId}&encounter=Encounter/${encounterId}`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId && !!patientId,
  });
}

export function useDraftOrders(encounterId: string, patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "DraftOrders", encounterId, serverUrl],
    queryFn: () =>
      fetchOrderBatch(
        serverUrl,
        ENCOUNTER_ORDER_TYPES,
        `patient=${patientId}&encounter=Encounter/${encounterId}&status=draft`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId && !!patientId,
  });
}

export function useSaveDraftOrders() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      bundle: ReturnType<typeof buildDraftSaveTransactionBundle>,
    ) => {
      if (!serverUrl) {
        throw new Error("No provider FHIR server selected.");
      }
      const response = await fhirSend(serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(bundle),
      });
      if (!response.ok) {
        throw new Error(`Failed to save draft orders: ${response.status}`);
      }
      const txResponse = (await response.json()) as Bundle;
      return extractTransactionOrderIds(txResponse.entry);
    },
    onSuccess: () => invalidateOrderQueries(queryClient),
  });
}

export function useDeleteDraftOrder() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      resourceType,
      id,
    }: {
      resourceType: string;
      id: string;
    }) => {
      const response = await fhirSend(`${serverUrl}/${resourceType}/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete draft order: ${response.status}`);
      }
    },
    onSuccess: () => invalidateOrderQueries(queryClient),
  });
}

const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";

/** Whether a QuestionnaireResponse is linked to the order via qr-context. */
function qrLinkedToOrder(qr: QuestionnaireResponse, orderRef: string): boolean {
  if (!orderRef) return false;
  return (qr.extension ?? []).some(
    (ext) =>
      ext.url === QR_CONTEXT_EXT_URL &&
      ext.valueReference?.reference === orderRef,
  );
}

/**
 * Query QuestionnaireResponses linked to a specific order. The DTR IG defines a
 * `context` SearchParameter over the `qr-context` extension, but it is not guaranteed
 * to be active on every server, so this queries by `patient` (always supported) and
 * links to the order client-side via the `qr-context` extension.
 *
 * https://build.fhir.org/ig/HL7/davinci-dtr/en/SearchParameter-qr-context.html
 */
export function useOrderQuestionnaireResponses(
  orderRef: string | undefined,
  patientId: string | undefined,
) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: [
      "fhir",
      "QuestionnaireResponse",
      "order",
      orderRef,
      patientId,
      serverUrl,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        patient: patientId ?? "",
        _sort: "-_lastUpdated",
        _count: "100",
      });
      const bundle = await fhirFetch<Bundle<QuestionnaireResponse>>(
        `${serverUrl}/QuestionnaireResponse?${params.toString()}`,
      );
      const entry = (bundle.entry ?? []).filter(
        (e) => e.resource && qrLinkedToOrder(e.resource, orderRef ?? ""),
      );
      return { ...bundle, entry };
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!orderRef && !!patientId,
  });
}

export function useEncounterQuestionnaireResponses(encounterId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: [
      "fhir",
      "QuestionnaireResponse",
      "encounter",
      encounterId,
      serverUrl,
    ],
    queryFn: () =>
      fhirFetch<Bundle<QuestionnaireResponse>>(
        `${serverUrl}/QuestionnaireResponse?encounter=Encounter/${encounterId}&_sort=-_lastUpdated&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!encounterId,
  });
}

export function useDeleteQuestionnaireResponse() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fhirSend(
        `${serverUrl}/QuestionnaireResponse/${id}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to delete QuestionnaireResponse: ${response.status}`,
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["fhir", "QuestionnaireResponse"],
      });
    },
  });
}

export function useDeleteTask() {
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fhirSend(`${serverUrl}/Task/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete Task: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fhir", "Task"] });
      queryClient.invalidateQueries({
        queryKey: ["pas", "patient-documentation-tasks"],
      });
      queryClient.invalidateQueries({
        queryKey: ["pas", "documentation-tasks"],
      });
    },
  });
}

export function usePatientQuestionnaireResponses(
  patientId: string,
  status?: AnyQrStatus | AnyQrStatus[],
) {
  const { serverUrl } = useFhirServer();
  const statusParam = Array.isArray(status) ? status.join(",") : status;

  return useQuery({
    queryKey: [
      "fhir",
      "QuestionnaireResponse",
      "patient",
      patientId,
      statusParam ?? "any",
      serverUrl,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        patient: patientId,
        _sort: "-_lastUpdated",
        _count: "50",
      });
      if (statusParam) params.set("status", statusParam);
      return fhirFetch<Bundle<QuestionnaireResponse>>(
        `${serverUrl}/QuestionnaireResponse?${params.toString()}`,
      );
    },
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useEncounters(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Encounter", "list", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Encounter>>(
        `${serverUrl}/Encounter?patient=${patientId}&_sort=-date&_count=20`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export interface OrderPaStatus {
  outcome: string;
  pended: boolean;
  disposition?: string;
  preAuthRef?: string;
  claimResponseId: string;
  orderId: string;
  orderType: string;
  coverageId?: string;
  created?: string;
}

function useOrderClaimResponses(patientId: string) {
  const { serverUrl } = useFhirServer();
  return useQuery({
    queryKey: ["fhir", "ClaimResponse", "patient", serverUrl, patientId],
    queryFn: () =>
      fhirFetch<Bundle<ClaimResponse>>(
        `${serverUrl}/ClaimResponse?patient=${patientId}&_count=50`,
      ),
    enabled: !!serverUrl && !!patientId,
  });
}

function useOrderPaTasks(patientId: string) {
  const { serverUrl } = useFhirServer();
  return useQuery({
    queryKey: ["fhir", "Task", "pa", serverUrl, patientId],
    queryFn: () =>
      fhirFetch<Bundle<Task>>(
        `${serverUrl}/Task?patient=${patientId}&_sort=-_lastUpdated&_count=50`,
      ),
    enabled: !!serverUrl && !!patientId,
  });
}

function taskTimestamp(task: Task): string {
  return task.meta?.lastUpdated ?? task.authoredOn ?? "";
}

/**
 * Joins PA-tracking Tasks (Task.focus = the order) with their ClaimResponses (matched by tracking
 * identifier) into one OrderPaStatus per order. The ClaimResponse is the source of the decision; the
 * Task supplies only the order join. Pure, for testability.
 */
export function deriveOrderPaStatuses(
  tasks: Task[],
  claimResponses: ClaimResponse[],
): Map<string, OrderPaStatus> {
  const crByTracking = new Map<string, ClaimResponse>();
  for (const cr of claimResponses) {
    const value = cr.identifier?.[0]?.value;
    if (value) crByTracking.set(value, cr);
  }

  const latestByOrder = new Map<string, Task>();
  for (const task of tasks) {
    const orderRef = task.focus?.reference;
    if (!orderRef) continue;
    const existing = latestByOrder.get(orderRef);
    if (!existing || taskTimestamp(task) >= taskTimestamp(existing)) {
      latestByOrder.set(orderRef, task);
    }
  }

  const statusMap = new Map<string, OrderPaStatus>();
  for (const [orderRef, task] of latestByOrder) {
    const [orderType, orderId] = orderRef.split("/");
    if (!orderType || !orderId) continue;
    const trackingId =
      task.identifier?.[0]?.value ?? task.reasonReference?.identifier?.value;
    const cr = trackingId ? crByTracking.get(trackingId) : undefined;
    statusMap.set(orderRef, {
      outcome: cr?.outcome ?? "queued",
      pended: cr ? isPendedClaimResponse(cr) || cr.outcome === "partial" : true,
      disposition: cr?.disposition,
      preAuthRef: cr?.preAuthRef,
      claimResponseId: trackingId ?? "",
      orderId,
      orderType,
      coverageId: cr?.insurance?.[0]?.coverage?.reference?.replace(
        /^Coverage\//,
        "",
      ),
      created: cr?.created ?? task.authoredOn,
    });
  }
  return statusMap;
}

/**
 * Returns a Map<resourceType/id, OrderPaStatus> for all of a patient's orders that have a PA Task,
 * joined to the persisted ClaimResponse for the decision.
 */
export function useOrderPaStatusMap(patientId: string) {
  const { data: taskBundle } = useOrderPaTasks(patientId);
  const { data: crBundle } = useOrderClaimResponses(patientId);

  return useMemo(() => {
    const tasks = (taskBundle?.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Task => r?.resourceType === "Task")
      .filter((t) =>
        isOrderResourceType(t.focus?.reference?.split("/")[0] ?? ""),
      );
    const claimResponses = (crBundle?.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is ClaimResponse => r?.resourceType === "ClaimResponse");
    return deriveOrderPaStatuses(tasks, claimResponses);
  }, [taskBundle, crBundle]);
}

/**
 * Polls one order's persisted ClaimResponse (updated by the PAS subscription notification), in place
 * of payer Claim/$inquire polling which the PAS IG (spec-9) says SHOULD NOT be used while waiting.
 * Stops once the ClaimResponse reaches a final outcome.
 */
export function useOrderPaStatus(
  trackingId: string | undefined,
  providerFhirUrl: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["pas", "order-claimresponse", providerFhirUrl, trackingId],
    queryFn: async (): Promise<ClaimResponse | null> => {
      const bundle = await fhirFetch<Bundle<ClaimResponse>>(
        `${providerFhirUrl}/ClaimResponse?identifier=${encodeURIComponent(
          trackingId ?? "",
        )}&_sort=-_lastUpdated`,
      );
      return (bundle.entry?.[0]?.resource as ClaimResponse) ?? null;
    },
    enabled: enabled && !!trackingId && !!providerFhirUrl,
    refetchInterval: (q) => {
      const cr = q.state.data as ClaimResponse | null | undefined;
      return !cr || isPendedClaimResponse(cr) || cr.outcome === "partial"
        ? 5_000
        : false;
    },
  });
}
